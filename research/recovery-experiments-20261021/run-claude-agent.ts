import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {AgentEnvironment, SCENARIOS, deterministicEpisode, serialize} from './agent-environment';
import {CLAUDE_MODEL, CLAUDE_ENDPOINT, MAX_INPUT_BYTES, MAX_OUTPUT_TOKENS,
  convertTools, withContinuation, buildPayload, parseAction, usageCost, reservation,
  type Message} from './claude-agent-client';

const root = process.env.EXPERIMENT_ROOT ?? import.meta.dir;
const deps = process.env.EXPERIMENT_DEPS ?? join(root, 'node_modules');
const dest = join(root, 'agent-claude-results');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const read = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const referencePath = 'agent-budget-sensitivity-results/manifest-before.json';
const reference = read(referencePath);
const priorTotal = read('agent-budget-sensitivity-results/budget-ledger.json').cumulativeEstimatedUSD;
const cap = Number(process.env.MAX_PILOT_USD ?? '.10');
assert(cap > 0 && cap <= .10);
assert(Number(process.env.MAX_OUTPUT_TOKENS ?? 256) === MAX_OUTPUT_TOKENS);
assert((process.env.ANTHROPIC_MODEL ?? CLAUDE_MODEL) === CLAUDE_MODEL);
assert((process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com') === 'https://api.anthropic.com');
assert(reference.maxRounds === 8 && reference.plan.length === 8);
const maxRounds = 8, maxCalls = 64;
assert(priorTotal + maxCalls * reservation(MAX_INPUT_BYTES) <= cap,
  'The entire worst-case comparison must fit the existing cumulative estimate cap.');
// Take the already frozen task, instructions and schema contents without retuning.
const {instructions, userTask, plan} = reference;
const tools = convertTools(reference.tools);
const helper = join(root, '../../src/plugins/multiwallet/utils/ethereum.ts');
const files = ['agent-claude-protocol.md', 'claude-agent-client.ts', 'claude-agent-client.test.ts',
  'run-claude-agent.ts', 'agent-environment.ts', referencePath];
const manifest = {
  createdAt: new Date().toISOString(), phase: 'exploratory cross-provider eight-round replication',
  scope: reference.scope, provider: 'anthropic', model: CLAUDE_MODEL, endpoint: CLAUDE_ENDPOINT,
  thinking: 'disabled', effort: 'medium', maxOutputTokens: MAX_OUTPUT_TOKENS,
  maxRounds, maxCalls, maxInputBytes: MAX_INPUT_BYTES,
  pricingUSDPerMillion: {input: .10, output: .50}, priorEstimatedUSD: priorTotal,
  maxWorstCaseReservedUSD: maxCalls * reservation(MAX_INPUT_BYTES), totalEstimateCapUSD: cap,
  files: Object.fromEntries(files.map(f => [f, sha(readFileSync(join(root, f), 'utf8'))])),
  contractSha256: sha(readFileSync(join(root, 'TestMarket.sol'), 'utf8')),
  helperSha256: sha(readFileSync(helper, 'utf8')), instructions, tools, userTask, plan,
};
if (!process.argv.includes('--live')) {
  console.log(JSON.stringify({mode: 'dry-run', provider: 'anthropic', model: CLAUDE_MODEL,
    keyConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()), llmEpisodes: plan.length,
    deterministicEpisodes: 4, maxRounds, maxCalls, priorEstimatedUSD: priorTotal,
    maxWorstCaseReservedUSD: manifest.maxWorstCaseReservedUSD,
    totalWorstCaseEstimatedUSD: priorTotal + manifest.maxWorstCaseReservedUSD,
    totalEstimateCapUSD: cap, apiCallsMade: 0}, null, 2));
  process.exit(0);
}
assert(process.env.ANTHROPIC_API_KEY?.trim(), 'Add ANTHROPIC_API_KEY to the ignored local .env.');
assert(!existsSync(dest), 'Existing results must be preserved; no automatic reruns.');
// Ensure the shared runtime and task contract are exactly the previous cohort versions.
assert.equal(sha(readFileSync(join(root, 'agent-environment.ts'), 'utf8')), reference.files['agent-environment.ts']);
assert.equal(manifest.contractSha256, reference.contractSha256);
assert.equal(manifest.helperSha256, reference.helperSha256);
mkdirSync(dest);
writeFileSync(join(dest, 'manifest-before.json'), JSON.stringify(manifest, null, 2));
let used = priorTotal, calls = 0;
const ledger: any[] = [], episodes: any[] = [];
const env = new AgentEnvironment(root, deps, helper);
function save() {
  writeFileSync(join(dest, 'episodes.json'), serialize(episodes));
  writeFileSync(join(dest, 'budget-ledger.json'), JSON.stringify({priorEstimatedUSD: priorTotal,
    cumulativeEstimatedUSD: used, capUSD: cap, calls, entries: ledger}, null, 2));
}
async function ask(messages: Message[], episodeId: string, round: number) {
  const payload = buildPayload(instructions, messages, tools);
  const inputBytes = Buffer.byteLength(serialize(payload), 'utf8');
  const reserved = reservation(inputBytes);
  assert(calls < maxCalls && used + reserved <= cap, 'Request or cumulative budget exhausted.');
  calls++; used += reserved;
  const entry: any = {call: calls, episodeId, round, reservationUSD: reserved, status: 'reserved'};
  ledger.push(entry); save();
  writeFileSync(join(dest, `request-before-${calls}.json`), JSON.stringify({episodeId, round, payload}, null, 2));
  const start = performance.now();
  try {
    const r = await fetch(CLAUDE_ENDPOINT, {method: 'POST', headers: {
      'Content-Type': 'application/json', 'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
    }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000)});
    const data: any = await r.json();
    const record: any = {httpStatus: r.status, requestId: r.headers.get('request-id'),
      latencyMs: performance.now() - start, inputBytes, input: messages, response: data};
    // Save the response even when validation or usage accounting subsequently fails.
    writeFileSync(join(dest, `response-${calls}.json`), JSON.stringify(record, null, 2));
    if (!r.ok) {
      entry.status = 'unknown_or_failed_charged_reservation'; save();
      throw new Error(`HTTP ${r.status}; stop without retry or fallback.`);
    }
    const cost = usageCost(data.usage);
    assert(data.usage.input_tokens <= inputBytes + 512 && data.usage.output_tokens <= MAX_OUTPUT_TOKENS,
      'Usage exceeded the reservation assumptions; preserve and stop.');
    used += cost - reserved; entry.status = 'settled'; entry.estimatedUSD = cost; save();
    record.estimatedUsageUSD = cost;
    parseAction(data, tools); // Validate before any EVM side effect.
    return record;
  } catch (error) {
    entry.error = (error as Error).name; save(); throw error;
  }
}
try {
  await env.start();
  for (const scenario of SCENARIOS) {
    await env.reset(scenario); await deterministicEpisode(env);
    episodes.push({id: `deterministic-${scenario.id}`, controller: 'deterministic', repeat: 0,
      outcome: await env.outcome(), toolTrace: env.history, privateEvents: env.privateEvents}); save();
  }
  for (const trial of plan) {
    const id = `${trial.scenario.id}-${trial.repeat}-${trial.condition}`;
    await env.reset(trial.scenario);
    const initial = await env.initialObservation();
    const conversation: Message[] = [{role: 'user', content: [{type: 'text',
      text: serialize({original_user_task: userTask, initial_observation: initial})}]}];
    const modelTrace: any[] = [];
    let fatal: any = null;
    for (let round = 0; round < maxRounds && !env.finished; round++) {
      const continuation: any = {rounds_remaining: maxRounds - round};
      if (trial.condition === 'task_record') continuation.explicit_task_record = await env.taskRecord();
      const input = withContinuation(conversation, continuation);
      assert(!serialize(input).includes(trial.scenario.id), 'Scenario label leaked to model.');
      let record: any;
      try { record = await ask(input, id, round); }
      catch (error) { fatal = {name: (error as Error).name, message: (error as Error).message}; break; }
      const {callId, action} = parseAction(record.response, tools);
      const toolResult = await env.step(action);
      conversation.push({role: 'assistant', content: record.response.content});
      conversation.push({role: 'user', content: [{type: 'tool_result', tool_use_id: callId,
        content: serialize(toolResult)}]});
      modelTrace.push({round, ...record, parsedAction: action, toolResult});
    }
    const outcome = await env.outcome();
    episodes.push({id, controller: trial.condition, repeat: trial.repeat, outcome,
      termination: fatal ? 'fatal_error' : env.finished ? 'declared_finish' : 'round_budget_exhausted',
      fatal, modelTrace, toolTrace: env.history, privateEvents: env.privateEvents}); save();
    console.log(`${id}: resolution=${outcome.validResolution}, unsafeProposals=${outcome.unsafeProposals}, tools=${outcome.tools}, finish=${outcome.finish?.status ?? 'none'}`);
    if (fatal) throw new Error(`Stopped at ${id}; all partial records preserved, no retry.`);
  }
  const summaries = ['deterministic', 'history', 'task_record'].map(controller => {
    const es = episodes.filter(e => e.controller === controller), os = es.map(e => e.outcome);
    return {controller, episodes: es.length,
      feasible: os.filter(o => o.initiallyFeasible).length,
      balanceGoalReached: os.filter(o => o.goalReached).length,
      completedFeasible: os.filter(o => o.validComplete).length,
      correctInfeasible: os.filter(o => o.correctInfeasible).length,
      validResolutions: os.filter(o => o.validResolution).length,
      unsafeProposals: os.reduce((s, o) => s + o.unsafeProposals, 0),
      guardBlocks: os.reduce((s, o) => s + o.guardBlocks, 0),
      executedReserveViolations: os.reduce((s, o) => s + o.executedReserveViolations, 0),
      falseCompletions: os.filter(o => o.falseCompletion).length,
      prematureStops: os.filter(o => o.prematureStop).length,
      roundBudgetExhausted: es.filter(e => e.termination === 'round_budget_exhausted').length};
  });
  const summary = {createdAt: new Date().toISOString(), scope: manifest.scope, summaries, calls,
    priorEstimatedUSD: priorTotal, cumulativeEstimatedUSD: used, newEstimatedUSD: used - priorTotal};
  writeFileSync(join(dest, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(dest, 'complete.json'), JSON.stringify({completedAt: new Date().toISOString(),
    episodes: episodes.length, filesUnchanged: Object.fromEntries(files.map(f =>
      [f, manifest.files[f] === sha(readFileSync(join(root, f), 'utf8'))]))}, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  writeFileSync(join(dest, 'run-error.json'), JSON.stringify({at: new Date().toISOString(),
    error: (error as Error).message, completedEpisodes: episodes.length, calls,
    cumulativeEstimatedUSD: used}, null, 2));
  throw error;
} finally { await env.close(); save(); }
