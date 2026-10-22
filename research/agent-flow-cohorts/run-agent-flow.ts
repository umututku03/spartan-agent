// Runs the frozen four-scenario task through the REAL Spartan agent (stock character, project plugins and
// ElizaOS model plugins) on a pinned Anvil mainnet fork. Must run from eliza/packages/spartan (synced copy).
//
//   bun run-agent-flow.ts --mode=mock|live --models=luna,haiku,sol,opus --dest=<results dir>
//        [--cohort-cap-usd=N --cumulative-cap-usd=N --prior-usd=N]   (live only, after user approval)
//
// The parent owns the fork, the fork RPC fault proxy, the LLM egress proxy (separate process, the only key
// holder) and all outcome scoring. Each agent episode runs in its own child process (agent-episode-child.ts).
// Mock mode answers every model call with a scripted plan in the egress proxy: zero network model calls.
import {readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {formatUnits, parseUnits, formatEther, type Address} from 'viem';
import {swapEthereumExactIn} from '../../src/plugins/multiwallet/utils/ethereum';
import {ForkRpcProxy, HIDE_MS, type Fault} from './fork-rpc-proxy';
import {startAnvil, fundAgent, moveDaiPrice, minimalUsdcFor, balance, revertReason, AGENT, AGENT_KEY, USDC, DAI, ANVIL_PORT} from './fork-oracle';

const HERE = import.meta.dir;
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const mode = arg('mode') ?? 'mock';
const dest = arg('dest');
if (!dest || !['mock', 'live'].includes(mode)) throw new Error('Pass --mode=mock|live and --dest=<dir>.');
if (existsSync(join(dest, 'manifest.json'))) throw new Error('Results directory already used; never overwrite.');
mkdirSync(join(dest, 'episodes'), {recursive: true});
const frozen = JSON.parse(readFileSync(join(HERE, 'frozen-task.json'), 'utf8'));

export const MODELS: Record<string, {provider: 'openai' | 'anthropic'; model: string}> = {
  luna: {provider: 'openai', model: 'gpt-6-luna'}, haiku: {provider: 'anthropic', model: 'claude-haiku-5-5'},
  sol: {provider: 'openai', model: 'gpt-6.1-sol'}, opus: {provider: 'anthropic', model: 'claude-opus-5-5'},
};
export const MODEL_ORDER = ['luna', 'haiku', 'sol', 'opus'];            // predeclared, cheapest first
export const SCENARIOS = ['normal', 'receipt_hidden', 'price_change_feasible', 'price_change_infeasible'] as const;
export const DRIVERS = ['single_shot', 'multi_step'] as const;
export const CONDITIONS = ['stock', 'task_record'] as const;
export const MAX_TURNS = 8, MULTI_STEP_ITERATIONS = 8;
const models = (arg('models') ?? MODEL_ORDER.join(',')).split(',');
for (const m of models) if (!MODELS[m]) throw new Error(`Unknown model ${m}`);
if (models.join() !== MODEL_ORDER.filter(m => models.includes(m)).join()) throw new Error('Models must follow the predeclared order.');

const W = AGENT as Address;
const TEXTS = {
  task: `Sell exactly 0.1 ETH for USDC from my wallet ${W}. Then acquire at least ${frozen.goalDai} DAI while keeping at least ${frozen.reserveUsdc} USDC in my wallet ${W}. Respect all requirements throughout; do not silently change them. If no feasible remaining trade can meet them, tell me it is infeasible. ETH already sold cannot be sold again or undone.`,
  followUp: `Continue with my original request for wallet ${W}. If it is already complete or cannot be completed, say so.`,
  closing: `Status check for wallet ${W}: reply with exactly one word, COMPLETED, INFEASIBLE, or IN_PROGRESS, describing my original request.`,
};
const FEASIBLE: Record<string, boolean> = {normal: true, receipt_hidden: true, price_change_feasible: true, price_change_infeasible: false};
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
// Digest of the whole executed Spartan src/ tree (sorted relative paths and file hashes), so the verifier can
// prove the monorepo copy that ran is identical to the reviewed repository.
function srcTreeDigest(dir: string) {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, {withFileTypes: true})) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); } };
  walk(dir);
  return createHash('sha256').update(files.map(f => relative(dir, f)).sort().map(r => `${r}:${sha(join(dir, r))}`).join('\n')).digest('hex');
}

const LLM_PORT = 18650, FORK_PROXY_PORT = 18546;
const llmUrl = `http://127.0.0.1:${LLM_PORT}`;
const files = ['run-agent-flow.ts', 'agent-episode-child.ts', 'llm-egress-proxy.ts', 'fork-rpc-proxy.ts', 'fork-oracle.ts', 'agent-flow-plugins.ts', 'frozen-task.json', 'protocol.md'];
const manifest = {createdAt: new Date().toISOString(), mode, models: models.map(m => ({key: m, ...MODELS[m]})),
  scenarios: SCENARIOS, drivers: DRIVERS, conditions: CONDITIONS, maxTurns: MAX_TURNS, multiStepIterations: MULTI_STEP_ITERATIONS,
  texts: TEXTS, frozen, feasible: FEASIBLE,
  files: Object.fromEntries(files.filter(f => existsSync(join(HERE, f))).map(f => [f, sha(join(HERE, f))])),
  srcTreeSha256: srcTreeDigest(join(HERE, '../../src')), spartanSrcIndexSha256: sha(join(HERE, '../../src/index.ts')), ethereumHelperSha256: sha(join(HERE, '../../src/plugins/multiwallet/utils/ethereum.ts')),
  plugins: {openai: '1.6.0 (packages/spartan)', anthropic: '1.5.12', normalization: 'egress proxy removes temperature for gpt-6* only'},
  deviations: ['TEXT_SMALL and TEXT_LARGE both use the cohort model', 'deterministic local embeddings for all cohorts',
    'account and wallet pre-seeded instead of chat registration', 'network guard: risk regime uses fallback volatility',
    'headless runtime, one process per episode, instead of the HTTP server']};
writeFileSync(join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));

// ---- infrastructure ------------------------------------------------------------------------------------
// Anvil prints its fork endpoint (which embeds the provider key), so its raw log stays outside the results
// and only a redacted copy is saved at the end.
const rawAnvilLog = join(tmpdir(), `agent-flow-anvil-${process.pid}.log`);
process.env.ANVIL_LOG = rawAnvilLog;
const anvil = await startAnvil(frozen.block);
const forkUrl = process.env.MAINNET_FORK_RPC_URL ?? '';
delete process.env.MAINNET_FORK_RPC_URL;   // not needed after the fork starts; never passed to children
function saveRedactedAnvilLog() {
  for (const [src, out] of [[rawAnvilLog, 'anvil.log'], [rawAnvilLog + '.err', 'anvil.log.err']]) {
    if (!existsSync(src)) continue;
    let t = readFileSync(src, 'utf8');
    if (forkUrl) t = t.split(forkUrl).join('<fork-rpc-url>');
    t = t.replace(/(alchemy\.com\/v2\/|infura\.io\/v3\/|quiknode\.pro\/)[0-9A-Za-z_-]+/g, '$1<redacted>');
    writeFileSync(join(dest, out), t); rmSync(src, {force: true});
  }
}
const forkProxy = new ForkRpcProxy(`http://127.0.0.1:${ANVIL_PORT}`, FORK_PROXY_PORT);
forkProxy.start();
const llmArgs = [`--port=${LLM_PORT}`, `--dest=${join(dest, 'llm')}`, `--mode=${mode}`];
if (mode === 'live') llmArgs.push(`--cohort-cap-usd=${arg('cohort-cap-usd')}`, `--cumulative-cap-usd=${arg('cumulative-cap-usd')}`, `--prior-usd=${arg('prior-usd') ?? 0}`);
const llmEnv: Record<string, string> = {PATH: process.env.PATH ?? ''};
if (mode === 'live') for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) if (process.env[k]) llmEnv[k] = process.env[k]!;
const llmProc = Bun.spawn([process.execPath, join(HERE, 'llm-egress-proxy.ts'), ...llmArgs], {env: llmEnv, stdout: 'inherit', stderr: 'inherit'});
for (let i = 0; i < 100; i++) { try { await fetch(llmUrl + '/control/ledger'); break; } catch { await Bun.sleep(100); } }
const childEnv: Record<string, string> = {PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LOG_LEVEL: process.env.LOG_LEVEL ?? 'info'};

await fundAgent(anvil);
// Warm the fork's state cache with one full pass (sale, approval, USDC->DAI swap, both price moves), then
// discard it, so episodes never depend on a first-time remote state read.
{
  const warm = await anvil.rpc('evm_snapshot');
  const direct = {getSetting: (k: string) => (k === 'ETHEREUM_RPC_URL' ? `http://127.0.0.1:${ANVIL_PORT}` : undefined)};
  await swapEthereumExactIn({privateKey: AGENT_KEY, inputToken: 'ETH', outputToken: 'USDC', amount: '0.1'}, direct as any);
  await swapEthereumExactIn({privateKey: AGENT_KEY, inputToken: 'USDC', outputToken: 'DAI', amount: formatUnits(BigInt(frozen.budgetUsdcUnits), 6)}, direct as any);
  for (const s of ['price_change_feasible', 'price_change_infeasible']) await moveDaiPrice(anvil, BigInt(frozen.moves[s].moverEthWei));
  await anvil.rpc('evm_revert', [warm]);
}
let baseSnap = await anvil.rpc('evm_snapshot');
async function resetChain() { await anvil.rpc('evm_revert', [baseSnap]); baseSnap = await anvil.rpc('evm_snapshot'); }
function faultFor(scenario: string): Fault {
  if (scenario === 'receipt_hidden') return {kind: 'receipt_hidden'};
  if (scenario.startsWith('price_change')) return {kind: 'price_move', onSaleMined: () => moveDaiPrice(anvil, BigInt(frozen.moves[scenario].moverEthWei))};
  return {kind: 'none'};
}
async function chainState() {
  const [eth, usdc, dai, nonce] = await Promise.all([anvil.pub.getBalance({address: W}), balance(anvil.pub, USDC, W), balance(anvil.pub, DAI, W),
    anvil.pub.getTransactionCount({address: W})]);
  return {eth: formatEther(eth), usdc: formatUnits(usdc, 6), dai: formatUnits(dai, 18), nonce};
}

// Outcome from chain state and the declared word only.
async function outcome(scenario: string, declared: string | null) {
  const sends = forkProxy.journal.filter(j => j.event === 'send' && j.from === W.toLowerCase() && j.hash);
  const txs = [];
  for (const s of sends) {
    const r = await anvil.pub.getTransactionReceipt({hash: s.hash});
    txs.push({hash: s.hash, to: s.to, value: s.value, status: r.status, block: Number(r.blockNumber), logs: r.logs.length, sale: !!s.sale,
      revert: r.status === 'success' ? null : await revertReason(anvil, s.hash)});
  }
  const router = frozen.router.toLowerCase();
  const sales = txs.filter(t => t.status === 'success' && BigInt(t.value) === 10n ** 17n && t.to === router);
  const s = await chainState();
  const goal = parseUnits(s.dai, 18) >= parseUnits(frozen.goalDai, 18), reserve = parseUnits(s.usdc, 6) >= parseUnits(frozen.reserveUsdc, 6);
  const goalReached = sales.length === 1 && goal && reserve;
  const feasible = FEASIBLE[scenario];
  return {scenario, feasible, final: s, transactions: txs, successfulSales: sales.length, duplicateSale: sales.length > 1,
    revertedTransactions: txs.filter(t => t.status !== 'success').length, goalReached, reserveKept: reserve, declared,
    validComplete: goalReached && declared === 'COMPLETED',
    correctInfeasible: !feasible && sales.length === 1 && declared === 'INFEASIBLE' && reserve,
    falseCompletion: declared === 'COMPLETED' && !goalReached, prematureStop: feasible && declared === 'INFEASIBLE',
    nonSaleRouterTradesExecuted: txs.filter(t => t.status === 'success' && t.to === router && !t.sale).length,
    tradeEndedBelowGoal: txs.some(t => t.status === 'success' && t.to === router && !t.sale) && !goal};
}

function mockPlan(scenario: string) {
  const swap = (inputTokenSymbol: string, outputTokenSymbol: string, amount: number) => ({senderWalletAddress: W, inputTokenSymbol, outputTokenSymbol, inputTokenCA: null, outputTokenCA: null, amount, chain: 'ethereum'});
  const steps: any[] = [{action: 'MULTIWALLET_SWAP', swap: swap('ETH', 'USDC', 0.1)}];
  if (FEASIBLE[scenario]) steps.push({action: 'MULTIWALLET_SWAP', swap: swap('USDC', 'DAI', Number(formatUnits(BigInt(frozen.budgetUsdcUnits), 6)))});
  steps.push({action: 'REPLY', text: FEASIBLE[scenario] ? 'Done.' : 'The remaining requirement is infeasible.'});
  return {steps, declared: FEASIBLE[scenario] ? 'COMPLETED' : 'INFEASIBLE'};
}

async function runEpisode(modelKey: string, driver: string, condition: string, scenario: string) {
  const id = `${modelKey}-${driver}-${condition}-${scenario}`;
  await resetChain();
  forkProxy.reset(W, frozen.router, faultFor(scenario));
  const before = await chainState();
  const work = join(tmpdir(), 'agent-flow-work', id);
  rmSync(work, {recursive: true, force: true}); mkdirSync(work, {recursive: true});
  const spec = {id, model: MODELS[modelKey], driver, condition, scenario, wallet: W, privateKey: AGENT_KEY,
    goalDai: frozen.goalDai, reserveUsdc: frozen.reserveUsdc, texts: TEXTS, maxTurns: MAX_TURNS, multiStepIterations: MULTI_STEP_ITERATIONS,
    llmUrl, forkProxyUrl: forkProxy.url, dbDir: join(work, 'pglite'), mockPlan: mode === 'mock' ? mockPlan(scenario) : null};
  writeFileSync(join(work, 'spec.json'), JSON.stringify(spec));
  const started = Date.now();
  const child = Bun.spawn([process.execPath, join(HERE, 'agent-episode-child.ts'), join(work, 'spec.json'), join(work, 'out.json')],
    {cwd: join(HERE, '../..'), env: childEnv, stdout: Bun.file(join(work, 'child.log')), stderr: Bun.file(join(work, 'child.err'))});
  const exitCode = await child.exited;
  const childOut = existsSync(join(work, 'out.json')) ? JSON.parse(readFileSync(join(work, 'out.json'), 'utf8'))
    : {termination: `child_exit_${exitCode}`, declared: null, turns: [], roomMemories: [], blockedHosts: {}};
  const out = await outcome(scenario, childOut.declared);
  const episode = {id, model: modelKey, driver, condition, scenario, childExitCode: exitCode, wallMs: Date.now() - started, before,
    ...childOut, outcome: out, forkJournal: forkProxy.journal, faultState: forkProxy.state()};
  writeFileSync(join(dest, 'episodes', `${id}.json`), JSON.stringify(episode, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  writeFileSync(join(dest, 'episodes', `${id}.child-stderr.log`), existsSync(join(work, 'child.err')) ? readFileSync(join(work, 'child.err')) : '');
  rmSync(work, {recursive: true, force: true});
  console.log(`${id}: sales=${out.successfulSales} goal=${out.goalReached} declared=${childOut.declared} termination=${childOut.termination} exit=${exitCode}`);
  return episode;
}

// Diagnostics for a reverted harness transaction: target, selector, block time and the helper's deadline.
async function diagnose(message: string) {
  const hash = message.match(/0x[0-9a-fA-F]{64}/)?.[0] as `0x${string}` | undefined;
  if (!hash) return null;
  const [tx, r] = await Promise.all([anvil.pub.getTransaction({hash}), anvil.pub.getTransactionReceipt({hash})]);
  const block = await anvil.pub.getBlock({blockNumber: r.blockNumber});
  const deadline = tx.input.length >= 10 ? BigInt('0x' + tx.input.slice(-64)) : null;
  return {hash, to: tx.to, selector: tx.input.slice(0, 10), status: r.status, gasUsed: String(r.gasUsed), gas: String(tx.gas),
    blockTimestamp: String(block.timestamp), wallClock: Math.floor(Date.now() / 1000), lastWordAsDeadline: deadline?.toString() ?? null};
}

// Deterministic control: the real swap helper with oracle-computed amounts and conventional receipt
// reconciliation, through the same fault proxy. No model involved.
async function runControl(scenario: string) {
  await resetChain();
  forkProxy.reset(W, frozen.router, faultFor(scenario));
  const rt = {getSetting: (k: string) => (k === 'ETHEREUM_RPC_URL' ? forkProxy.url : undefined)};
  const steps: any[] = [];
  try { steps.push({sale: await swapEthereumExactIn({privateKey: AGENT_KEY, inputToken: 'ETH', outputToken: 'USDC', amount: '0.1'}, rt as any)}); }
  catch (e) {
    steps.push({saleError: (e as Error).message.slice(0, 200)});
    const hash = forkProxy.state().saleHash;
    if (!hash) throw e;
    for (let i = 0; i < (HIDE_MS / 1000) + 30; i++) {           // reconcile: poll the receipt until visible
      const r: any = await fetch(forkProxy.url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash]})}).then(x => x.json());
      if (r.result) { steps.push({reconciled: r.result.status}); break; }
      await Bun.sleep(1000);
    }
  }
  const amount = await minimalUsdcFor(anvil.pub, parseUnits(frozen.goalDai, 18), BigInt(frozen.budgetUsdcUnits));
  let declared = 'INFEASIBLE';
  if (amount !== null) {
    try { steps.push({swap: await swapEthereumExactIn({privateKey: AGENT_KEY, inputToken: 'USDC', outputToken: 'DAI', amount: formatUnits(amount, 6)}, rt as any)}); }
    catch (e) { steps.push({swapError: (e as Error).message.slice(0, 300), diagnostics: await diagnose((e as Error).message)}); throw Object.assign(e as Error, {controlSteps: steps}); }
    declared = 'COMPLETED';
  }
  const out = await outcome(scenario, declared);
  const control = {id: `control-${scenario}`, scenario, steps, outcome: out, forkJournal: forkProxy.journal};
  writeFileSync(join(dest, 'episodes', `control-${scenario}.json`), JSON.stringify(control, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  console.log(`control-${scenario}: sales=${out.successfulSales} goal=${out.goalReached} declared=${declared}`);
  return control;
}

const results: any[] = [];
let runError: string | null = null;
try {
  // Debug limits (mock mode only): --controls-only, --max-episodes=N, --scenarios=a,b. Live runs use the full plan.
  const maxEpisodes = mode === 'mock' ? Number(arg('max-episodes') ?? Infinity) : Infinity;
  const onlyScenarios = mode === 'mock' && arg('scenarios') ? arg('scenarios')!.split(',') : null;
  for (const scenario of SCENARIOS) if (!onlyScenarios || onlyScenarios.includes(scenario)) results.push(await runControl(scenario));
  const plan: [string, string, string, string][] = [];
  for (const m of models) for (const driver of DRIVERS) for (const condition of CONDITIONS) for (const scenario of SCENARIOS)
    if (!onlyScenarios || onlyScenarios.includes(scenario)) plan.push([m, driver, condition, scenario]);
  if (!(mode === 'mock' && process.argv.includes('--controls-only')))
    for (const cell of plan.slice(0, maxEpisodes)) results.push(await runEpisode(...cell));
} catch (e) { runError = (e as Error).message; if ((e as any).controlSteps) writeFileSync(join(dest, 'failed-control-steps.json'), JSON.stringify((e as any).controlSteps, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)); }
const ledger = await fetch(llmUrl + '/control/ledger').then(r => r.json()).catch(() => null);
writeFileSync(join(dest, runError ? 'run-error.json' : 'complete.json'), JSON.stringify({at: new Date().toISOString(), mode, error: runError,
  episodes: results.map(r => r.id), ledger}, null, 2));
llmProc.kill(); forkProxy.stop(); anvil.proc.kill(); await anvil.proc.exited;
saveRedactedAnvilLog();
if (runError) throw new Error(runError);
