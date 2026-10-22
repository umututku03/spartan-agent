import {readFileSync, writeFileSync, mkdirSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseUnits, formatUnits} from 'viem';
import {AgentEnvironment, SCENARIOS, deterministicEpisode, serialize, inverseCent, U} from './agent-environment';
import {MODELS, MAX_ROUNDS, MAX_OUTPUT_TOKENS, INPUT_OVERHEAD_TOKENS, type ModelKey, anthropicTools, opusPayload,
  solPayload, visibleBytes, reservation, settleUsage, parseResponse, blindingViolations, isAppendOnly,
  inputTokenBound} from './api-replication-client';

// Usage: bun --env-file=.env run-api-replication.ts --model=opus|sol [--live]
// Default is an offline dry run: local EVM plus mock planner responses, zero network requests.
const root = process.env.EXPERIMENT_ROOT ?? import.meta.dir;
const deps = process.env.EXPERIMENT_DEPS ?? join(root, 'node_modules');
const key = (process.argv.find(a => a.startsWith('--model='))?.slice(8) ?? '') as ModelKey;
assert(key in MODELS, 'Pass --model=opus or --model=sol.');
const cfg = MODELS[key];
const live = process.argv.includes('--live');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const read = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const referencePath = 'agent-budget-sensitivity-results/manifest-before.json';
const reference = read(referencePath);
const {instructions, userTask, plan} = reference;
assert(reference.maxRounds === MAX_ROUNDS && plan.length === 8);
const tools = cfg.provider === 'anthropic' ? anthropicTools(reference.tools) : reference.tools;
const helper = join(root, '../../src/plugins/multiwallet/utils/ethereum.ts');
// Predeclared cohort order: Opus first, then Sol, sharing one cumulative estimate ledger.
const priorLedgerPath = key === 'opus' ? 'agent-claude-results/budget-ledger.json' : `${MODELS.opus.resultsFolder}/budget-ledger.json`;
const files = ['agent-api-replication-protocol.md', 'api-replication-client.ts', 'api-replication-client.test.ts',
  'run-api-replication.ts', 'verify-api-replication-results.py', 'estimate-api-cost.py', 'claude-agent-client.ts',
  'agent-environment.ts', referencePath];
assert.equal(sha(readFileSync(join(root, 'agent-environment.ts'), 'utf8')), reference.files['agent-environment.ts']);
assert.equal(sha(readFileSync(join(root, 'TestMarket.sol'), 'utf8')), reference.contractSha256);
assert.equal(sha(readFileSync(helper, 'utf8')), reference.helperSha256);
const baseUrl = process.env[cfg.baseUrlVariable];
assert(!baseUrl || baseUrl === cfg.officialBaseUrl, `${cfg.baseUrlVariable} must be unset or the official endpoint.`);
const secret = process.env[cfg.keyVariable]?.trim() ?? '';
const otherSecrets = [process.env.ANTHROPIC_API_KEY, process.env.OPENAI_API_KEY].map(s => s?.trim() ?? '');

let priorTotal: number, cohortCap: number, cumulativeCap: number;
if (live) {
  assert(secret, `Add ${cfg.keyVariable} to the ignored local .env.`);
  assert(existsSync(join(root, priorLedgerPath)), 'Predeclared order: run the Opus cohort before Sol.');
  priorTotal = read(priorLedgerPath).cumulativeEstimatedUSD;
  // Budget approval is explicit and per cohort; there is deliberately no default for live mode.
  cohortCap = Number(process.env.APPROVED_COHORT_USD);
  cumulativeCap = Number(process.env.APPROVED_CUMULATIVE_CAP_USD);
  assert(cohortCap > 0 && cumulativeCap > priorTotal, 'Set APPROVED_COHORT_USD and APPROVED_CUMULATIVE_CAP_USD after user approval.');
} else {
  priorTotal = existsSync(join(root, priorLedgerPath)) ? read(priorLedgerPath).cumulativeEstimatedUSD
    : read('agent-claude-results/budget-ledger.json').cumulativeEstimatedUSD;
  cohortCap = Infinity; cumulativeCap = Infinity;
}
const dest = live ? join(root, cfg.resultsFolder) : join(root, 'api-replication-dryrun', key);
const manifest = {
  createdAt: new Date().toISOString(), mode: live ? 'live' : 'offline_dry_run_mock_planner',
  phase: 'API replication of the matched eight-round cohort with Opus 5.5 and GPT-6.1 Sol',
  scope: reference.scope, provider: cfg.provider, model: cfg.model, endpoint: cfg.endpoint,
  reasoning: cfg.provider === 'anthropic' ? {thinking: 'adaptive (cannot be disabled)', effort: cfg.effort}
    : {effort: cfg.effort, encryptedReasoningReplay: true},
  toolChoice: cfg.provider === 'anthropic' ? 'auto, disable_parallel_tool_use (forced choice unsupported)' : 'required, parallel_tool_calls false',
  historyEnvelope: cfg.provider === 'anthropic' ? 'append-only; each continuation kept in place (preserved thinking)'
    : 'reference Luna envelope; latest continuation only, reasoning items replayed',
  caching: 'none requested', fallbacks: 'none', retries: 'none',
  maxOutputTokens: MAX_OUTPUT_TOKENS, maxRounds: MAX_ROUNDS, maxCalls: MAX_ROUNDS * plan.length,
  maxVisibleBytes: cfg.maxVisibleBytes, inputOverheadTokens: INPUT_OVERHEAD_TOKENS,
  pricingUSDPerMillion: {input: cfg.inputUSDPerMillion, output: cfg.outputUSDPerMillion},
  priorLedger: priorLedgerPath, priorEstimatedUSD: priorTotal, approvedCohortUSD: cohortCap, approvedCumulativeCapUSD: cumulativeCap,
  files: Object.fromEntries(files.map(f => [f, sha(readFileSync(join(root, f), 'utf8'))])),
  contractSha256: reference.contractSha256, helperSha256: reference.helperSha256,
  instructions, tools, userTask, plan,
};
if (live) assert(!existsSync(dest), 'Existing results must be preserved; no automatic reruns.');
else if (existsSync(dest)) rmSync(dest, {recursive: true}); // dry-run output is regenerated; never results
mkdirSync(dest, {recursive: true});
writeFileSync(join(dest, live ? 'manifest-before.json' : 'manifest-dryrun.json'), JSON.stringify(manifest, null, 2));

let used = priorTotal, calls = 0;
const ledger: any[] = [], episodes: any[] = [];
const env = new AgentEnvironment(root, deps, helper);
function save() {
  writeFileSync(join(dest, 'episodes.json'), serialize(episodes));
  writeFileSync(join(dest, 'budget-ledger.json'), JSON.stringify({mock: !live, priorEstimatedUSD: priorTotal,
    cumulativeEstimatedUSD: used, cohortCapUSD: cohortCap, cumulativeCapUSD: cumulativeCap, calls, entries: ledger}, null, 2));
}

// Offline planner stand-in: chooses actions only from the last visible record. Never scored as model behaviour.
function mockResponse(policy: string, last: any, round: number, n: number, bytes: number) {
  const o = last.observation;
  let action: any;
  if (!o.native_transaction) action = {tool: 'sell_eth', args: {eth: '0.1'}};
  else if (o.native_transaction.status !== 'confirmed_success') action = {tool: 'receipt', args: {}};
  else if (policy === 'max_rounds') action = round === MAX_ROUNDS - 1 ? {tool: 'finish', args: {status: 'infeasible'}} : {tool: 'quote', args: {cash: '80'}};
  else if (last.action?.tool !== 'quote' && last.action?.tool !== 'swap_cash')
    action = {tool: 'quote', args: {cash: formatUnits(parseUnits(o.cash_balance, 6) - 120n * U, 6)}};
  else if (last.action.tool === 'quote' && parseUnits(last.result.dai, 18) < 50n * 10n ** 18n) action = {tool: 'finish', args: {status: 'infeasible'}};
  else if (last.action.tool === 'quote') {
    const amount = inverseCent(parseUnits(o.pool_cash, 6), parseUnits(o.pool_dai, 18), 50n * 10n ** 18n - parseUnits(o.dai_balance, 18));
    action = {tool: 'swap_cash', args: {cash: formatUnits(amount!, 6), minimum_dai: '50'}};
  } else action = {tool: 'finish', args: {status: 'completed'}};
  const usage = {input_tokens: Math.ceil(bytes / 2), output_tokens: 200};
  if (cfg.provider === 'anthropic') return {id: `msg_mock_${n}`, type: 'message', role: 'assistant', model: cfg.model,
    stop_reason: 'tool_use', usage, content: [{type: 'thinking', thinking: '', signature: `MOCK_SIGNATURE_${n}`},
      {type: 'tool_use', id: `toolu_mock_${n}`, name: action.tool, input: action.args}]};
  return {id: `resp_mock_${n}`, object: 'response', status: 'completed', model: cfg.model, usage,
    output: [{type: 'reasoning', id: `rs_mock_${n}`, summary: [], encrypted_content: `MOCK_ENCRYPTED_${n}`},
      {type: 'function_call', id: `fc_mock_${n}`, call_id: `call_mock_${n}`, name: action.tool, arguments: JSON.stringify(action.args)}]};
}

async function send(payload: any) {
  const headers: any = {'Content-Type': 'application/json'};
  if (cfg.provider === 'anthropic') { headers['anthropic-version'] = '2023-06-01'; headers['x-api-key'] = secret; }
  else headers.Authorization = `Bearer ${secret}`;
  const r = await fetch(cfg.endpoint, {method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(180000)});
  const data: any = await r.json();
  return {httpStatus: r.status, ok: r.ok, requestId: r.headers.get(cfg.provider === 'anthropic' ? 'request-id' : 'x-request-id'), data};
}

async function runEpisode(trial: any, id: string, policy: string) {
  await env.reset(trial.scenario);
  const initial = await env.initialObservation();
  const opening = serialize({original_user_task: userTask, initial_observation: initial});
  const history: any[] = cfg.provider === 'anthropic' ? [{role: 'user', content: [{type: 'text', text: opening}]}]
    : [{role: 'user', content: opening}];
  const modelTrace: any[] = [];
  let termination: string | null = null, invalid: any = null, priorOutput = 0, previousMessages: any[] | null = null;
  let last: any = {observation: initial};
  for (let round = 0; round < MAX_ROUNDS && !env.finished; round++) {
    const continuation: any = {rounds_remaining: MAX_ROUNDS - round};
    if (trial.condition === 'task_record') continuation.explicit_task_record = await env.taskRecord();
    let payload: any;
    if (cfg.provider === 'anthropic') {
      // Keep the continuation in place so the history stays append-only across requests.
      history.at(-1).content.push({type: 'text', text: JSON.stringify(continuation)});
      payload = opusPayload(instructions, structuredClone(history), tools);
      assert(isAppendOnly(previousMessages, payload.messages), 'History edit detected.');
      previousMessages = structuredClone(payload.messages);
    } else payload = solPayload(instructions, [...history, {role: 'user', content: serialize(continuation)}], tools);
    const bytes = visibleBytes(payload);
    const violations = blindingViolations(cfg.provider, payload, {instructions, tools: reference.tools}, [secret, ...otherSecrets]);
    if (violations.length) throw new Error(`Blinding check failed before sending: ${violations.join('; ')}`);
    assert(bytes <= cfg.maxVisibleBytes, 'Visible payload cap exceeded; no truncation, stop.');
    const reserved = reservation(cfg, bytes, priorOutput);
    assert(calls < (live ? manifest.maxCalls : 2 * manifest.maxCalls) && used + reserved <= cumulativeCap && used + reserved - priorTotal <= cohortCap,
      'Request or approved budget exhausted.');
    calls++; used += reserved;
    const entry: any = {call: calls, episodeId: id, round, reservationUSD: reserved, status: 'reserved'};
    ledger.push(entry); save();
    writeFileSync(join(dest, `request-before-${calls}.json`), JSON.stringify({episodeId: id, round, visibleBytes: bytes,
      priorOutputTokens: priorOutput, inputTokenBound: inputTokenBound(bytes, priorOutput),
      blinding: {checked: true, violations}, payload}, null, 2));
    const started = performance.now();
    let reply: any;
    try { reply = live ? await send(payload) : {httpStatus: 200, ok: true, requestId: null, data: mockResponse(policy, last, round, calls, bytes)}; }
    catch (error) { entry.status = 'unknown_or_failed_charged_reservation'; entry.error = (error as Error).name; save(); throw error; }
    const record: any = {round, httpStatus: reply.httpStatus, requestId: reply.requestId, latencyMs: performance.now() - started,
      visibleBytes: bytes, priorOutputTokens: priorOutput, response: reply.data, mock: !live};
    writeFileSync(join(dest, `response-${calls}.json`), JSON.stringify(record, null, 2));
    if (!reply.ok) { entry.status = 'unknown_or_failed_charged_reservation'; save(); throw new Error(`HTTP ${reply.httpStatus}; stop without retry or fallback.`); }
    const usage = reply.data.usage;
    const cost = settleUsage(cfg, usage);
    assert(usage.input_tokens <= inputTokenBound(bytes, priorOutput) && usage.output_tokens <= MAX_OUTPUT_TOKENS,
      'Usage exceeded the reservation assumptions; preserve and stop.');
    used += cost - reserved; entry.status = 'settled'; entry.estimatedUSD = cost; save();
    record.estimatedUsageUSD = cost; priorOutput += usage.output_tokens;
    const parsed = parseResponse(cfg.provider, reply.data, tools);
    if (!parsed.ok) { invalid = {round, reason: parsed.reason}; modelTrace.push({...record, parsedAction: null, toolResult: null}); termination = 'invalid_model_response'; break; }
    const toolResult = await env.step(parsed.action);
    last = toolResult;
    if (cfg.provider === 'anthropic') {
      history.push({role: 'assistant', content: reply.data.content});
      history.push({role: 'user', content: [{type: 'tool_result', tool_use_id: parsed.callId, content: serialize(toolResult)}]});
    } else {
      history.push(...reply.data.output);
      history.push({type: 'function_call_output', call_id: parsed.callId, output: serialize(toolResult)});
    }
    modelTrace.push({...record, callId: parsed.callId, parsedAction: parsed.action, toolResult});
  }
  const outcome = await env.outcome();
  episodes.push({id, controller: trial.condition, repeat: trial.repeat, mockPolicy: live ? null : policy, outcome,
    termination: termination ?? (env.finished ? 'declared_finish' : 'round_budget_exhausted'), invalidResponse: invalid,
    modelTrace, toolTrace: env.history, privateEvents: env.privateEvents});
  save();
  console.log(`${id}: resolution=${outcome.validResolution}, unsafeProposals=${outcome.unsafeProposals}, tools=${outcome.tools}, termination=${episodes.at(-1).termination}`);
}

try {
  await env.start();
  for (const scenario of SCENARIOS) {
    await env.reset(scenario); await deterministicEpisode(env);
    episodes.push({id: `deterministic-${scenario.id}`, controller: 'deterministic', repeat: 0,
      outcome: await env.outcome(), toolTrace: env.history, privateEvents: env.privateEvents}); save();
  }
  const policies = live ? ['model'] : ['scripted', 'max_rounds'];
  for (const policy of policies) for (const trial of plan)
    await runEpisode(trial, `${trial.scenario.id}-${trial.repeat}-${trial.condition}${live ? '' : `-mock-${policy}`}`, policy);
  const summaries = ['deterministic', 'history', 'task_record'].map(controller => {
    const es = episodes.filter(e => e.controller === controller), os = es.map(e => e.outcome);
    return {controller, episodes: es.length, feasible: os.filter(o => o.initiallyFeasible).length,
      balanceGoalReached: os.filter(o => o.goalReached).length, completedFeasible: os.filter(o => o.validComplete).length,
      correctInfeasible: os.filter(o => o.correctInfeasible).length, validResolutions: os.filter(o => o.validResolution).length,
      unsafeProposals: os.reduce((s, o) => s + o.unsafeProposals, 0), guardBlocks: os.reduce((s, o) => s + o.guardBlocks, 0),
      executedReserveViolations: os.reduce((s, o) => s + o.executedReserveViolations, 0),
      falseCompletions: os.filter(o => o.falseCompletion).length, prematureStops: os.filter(o => o.prematureStop).length,
      roundBudgetExhausted: es.filter(e => e.termination === 'round_budget_exhausted').length,
      invalidModelResponses: es.filter(e => e.termination === 'invalid_model_response').length,
      modelCalls: es.reduce((s, e) => s + (e.modelTrace?.length ?? 0), 0)};
  });
  const byteStats = episodes.filter(e => e.modelTrace).flatMap(e => e.modelTrace.map((t: any) => ({episode: e.id, round: t.round, bytes: t.visibleBytes})));
  const summary = {createdAt: new Date().toISOString(), mock: !live, scope: manifest.scope, model: cfg.model, summaries, calls,
    maxVisibleBytes: Math.max(...byteStats.map(b => b.bytes)), visibleByteCap: cfg.maxVisibleBytes,
    priorEstimatedUSD: priorTotal, cumulativeEstimatedUSD: used, newEstimatedUSD: used - priorTotal};
  writeFileSync(join(dest, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(dest, 'complete.json'), JSON.stringify({completedAt: new Date().toISOString(), mock: !live, episodes: episodes.length,
    filesUnchanged: Object.fromEntries(files.map(f => [f, manifest.files[f] === sha(readFileSync(join(root, f), 'utf8'))]))}, null, 2));
  console.log(JSON.stringify({mode: manifest.mode, model: cfg.model, keyConfigured: Boolean(secret), networkRequests: live ? calls : 0,
    calls, maxVisibleBytes: summary.maxVisibleBytes, visibleByteCap: cfg.maxVisibleBytes, summaries}, null, 2));
} catch (error) {
  writeFileSync(join(dest, 'run-error.json'), JSON.stringify({at: new Date().toISOString(), mock: !live, error: (error as Error).message,
    completedEpisodes: episodes.length, calls, cumulativeEstimatedUSD: used}, null, 2));
  throw error;
} finally { await env.close(); save(); }
