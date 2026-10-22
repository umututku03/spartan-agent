// Fork oracle: starts the pinned Anvil mainnet fork, calibrates the frozen task numbers, provides the
// privileged post-sale pool move, the feasibility oracle and the deterministic (no-LLM) controls.
// Usage (calibration): bun --env-file=.env fork-oracle.ts calibrate --block=<N> --out=frozen-task.json
import {createPublicClient, createWalletClient, http, parseEther, parseUnits, formatUnits, keccak256, toHex,
  type Address, type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {mainnet} from 'viem/chains';
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {computePositionSize, loadRiskConfig} from '../../src/plugins/multiwallet/risk';

export const ROUTER: Address = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
export const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
export const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
// Deterministic fresh test key with no mainnet history; funded only on the fork.
export const AGENT_KEY = keccak256(toHex('spartan-agent-flow-cohorts-wallet-v1')) as Hex;
export const AGENT = privateKeyToAccount(AGENT_KEY).address;
// Anvil's well-known dev account #1 acts as the scheduled market mover (privileged, controller-only).
export const MOVER_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
export const AGENT_ETH = '1';
export const ANVIL_PORT = 18545;
// Toy-task proportions (agent-environment.ts): 50 DAI needed from an 80-cash budget whose baseline
// output is q(80 cash) on a 1:1 pool with 0.3% fee; scenario factors 0.73 and 0.58.
const TOY_BASE = 80 * 997 * 10000 / (10000 * 1000 + 80 * 997);
export const GOAL_RATIO = 50 / TOY_BASE;
export const FACTORS = {price_change_feasible: 0.73, price_change_infeasible: 0.58} as const;

const ROUTER_ABI = [
  {type: 'function', name: 'getAmountsOut', stateMutability: 'view', inputs: [{name: 'amountIn', type: 'uint256'}, {name: 'path', type: 'address[]'}], outputs: [{type: 'uint256[]'}]},
  {type: 'function', name: 'swapExactETHForTokens', stateMutability: 'payable', inputs: [{name: 'amountOutMin', type: 'uint256'}, {name: 'path', type: 'address[]'}, {name: 'to', type: 'address'}, {name: 'deadline', type: 'uint256'}], outputs: [{type: 'uint256[]'}]},
] as const;
const ERC20_ABI = [{type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{name: 'a', type: 'address'}], outputs: [{type: 'uint256'}]}] as const;

export function clients(url = `http://127.0.0.1:${ANVIL_PORT}`) {
  const transport = http(url, {retryCount: 0});
  return {
    pub: createPublicClient({chain: mainnet, transport, pollingInterval: 50}),
    mover: createWalletClient({chain: mainnet, transport, account: privateKeyToAccount(MOVER_KEY)}),
    rpc: async (method: string, params: any[] = []) => {
      const r: any = await (await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})})).json();
      if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
      return r.result;
    },
  };
}

export async function startAnvil(block: number) {
  const url = process.env.MAINNET_FORK_RPC_URL;
  if (!url) throw new Error('Set MAINNET_FORK_RPC_URL in research/agent-flow-cohorts/.env');
  const bin = process.env.ANVIL_BIN ?? join(import.meta.dir, '../recovery-experiments-20261021/node_modules/@foundry-rs/anvil-darwin-arm64/bin/anvil');
  // Provider throttling is respected (no --no-rate-limit) and fork reads are retried, so a transient RPC
  // failure cannot surface as an on-chain revert. Anvil's own log is kept for diagnosis.
  const log = process.env.ANVIL_LOG;
  const proc = Bun.spawn([bin, '--host', '127.0.0.1', '--port', String(ANVIL_PORT), '--fork-url', url,
    '--fork-block-number', String(block), '--retries', '10', '--timeout', '60000'],
    {stdout: log ? Bun.file(log) : 'ignore', stderr: log ? Bun.file(log + '.err') : 'ignore', env: {PATH: process.env.PATH ?? '/usr/bin:/bin'}});
  const c = clients();
  for (let i = 0; i < 200; i++) { try { if (await c.rpc('eth_chainId') === '0x1') break; } catch {} await Bun.sleep(100); }
  if (await c.rpc('eth_chainId') !== '0x1') throw new Error('Fork did not start with chain id 1');
  const head = Number(await c.rpc('eth_blockNumber'));
  if (head !== block) throw new Error(`Fork head ${head} is not the pinned block ${block}`);
  // Mainnet-like 12 s block spacing. With automine and no interval, several blocks can share one wall-clock
  // second, so a gas estimate can skip Uniswap V2's price-accumulator writes that the mined block then
  // performs (an out-of-gas revert seen in the dry run). A fixed interval keeps estimates and execution consistent.
  await c.rpc('anvil_setBlockTimestampInterval', [12]);
  return {proc, ...c};
}

export async function quote(pub: any, amountIn: bigint, path: Address[]) {
  const out = await pub.readContract({address: ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [amountIn, path]}) as bigint[];
  return out[out.length - 1];
}
export const balance = (pub: any, token: Address, who: Address) => pub.readContract({address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [who]}) as Promise<bigint>;

/** Smallest USDC amount (cent steps) whose DAI quote reaches `target`, or null if `budget` cannot. */
export async function minimalUsdcFor(pub: any, target: bigint, budget: bigint) {
  if (await quote(pub, budget, [USDC, WETH, DAI]) < target) return null;
  let lo = 0n, hi = budget / 10000n;
  while (lo < hi) { const mid = (lo + hi) / 2n; if (await quote(pub, mid * 10000n, [USDC, WETH, DAI]) >= target) hi = mid; else lo = mid + 1n; }
  return lo * 10000n;
}

/** Privileged scheduled market change: the mover buys DAI with `eth` ETH on the WETH/DAI pair. */
export async function moveDaiPrice(c: ReturnType<typeof clients>, eth: bigint) {
  const hash = await c.mover.writeContract({address: ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens',
    args: [0n, [WETH, DAI], c.mover.account.address, BigInt(Math.floor(Date.now() / 1000) + 3600)], value: eth, gas: 300000n});
  const r = await c.pub.waitForTransactionReceipt({hash});
  if (r.status !== 'success') throw new Error('Market move reverted');
  return {hash, eth: eth.toString(), block: Number(r.blockNumber)};
}

/** Simulate the agent's exact 0.1 ETH sale from the funded agent wallet (calibration only). */
async function simulateSale(c: ReturnType<typeof clients>) {
  const w = createWalletClient({chain: mainnet, transport: http(`http://127.0.0.1:${ANVIL_PORT}`), account: privateKeyToAccount(AGENT_KEY)});
  const hash = await w.writeContract({address: ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens',
    args: [0n, [WETH, USDC], AGENT, BigInt(Math.floor(Date.now() / 1000) + 3600)], value: parseEther('0.1'), gas: 300000n});
  await c.pub.waitForTransactionReceipt({hash});
}

/** Revert reason of a mined transaction via Anvil's debug tracer (null if it succeeded). */
export async function revertReason(c: ReturnType<typeof clients>, hash: string) {
  try {
    const t: any = await c.rpc('debug_traceTransaction', [hash, {tracer: 'callTracer'}]);
    const deepest = (n: any): any => (n?.calls ?? []).map(deepest).find((x: any) => x?.error) ?? (n?.error ? n : null);
    const d = deepest(t);
    let reason: string | null = null;
    const out = d?.output as string | undefined;
    if (out && out.startsWith('0x08c379a0')) { const len = parseInt(out.slice(74, 138), 16); reason = Buffer.from(out.slice(138, 138 + len * 2), 'hex').toString(); }
    return {error: t?.error ?? null, deepestError: d?.error ?? null, deepestTo: d?.to ?? null, reason, gasUsed: t?.gasUsed ?? null, gas: t?.gas ?? null};
  } catch (e) { return {traceError: (e as Error).message.slice(0, 200)}; }
}

export async function fundAgent(c: ReturnType<typeof clients>) {
  await c.rpc('anvil_setBalance', [AGENT, toHex(parseEther(AGENT_ETH))]);
  await c.rpc('anvil_setBalance', [c.mover.account.address, toHex(parseEther('100000'))]);
}

export async function calibrate(block: number) {
  const a = await startAnvil(block);
  try {
    await fundAgent(a);
    if (await balance(a.pub, USDC, AGENT) !== 0n || await balance(a.pub, DAI, AGENT) !== 0n) throw new Error('Agent wallet is not clean');
    const proceedsQuote = await quote(a.pub, parseEther('0.1'), [WETH, USDC]);
    const base = await a.rpc('evm_snapshot');
    await simulateSale(a);
    const proceeds = await balance(a.pub, USDC, AGENT);
    if (proceeds !== proceedsQuote) throw new Error('Sale did not match its quote');
    // Stock risk clamp with the fallback regime (the harness blocks live CoinGecko data).
    const cfg = loadRiskConfig({getSetting: () => undefined});
    const sized = computePositionSize({walletValue: Number(formatUnits(proceeds, 6)), regime: {realizedVol: cfg.volFallback, source: 'fallback'} as any, config: cfg});
    const clampUnits = parseUnits(sized.size.toFixed(6), 6);
    // Reserve aligned with the clamp: R rounded up to cents so the permitted budget never exceeds the clamp.
    const reserve = ((proceeds - clampUnits + 9999n) / 10000n) * 10000n;
    const budget = proceeds - reserve;
    const baselineOut = await quote(a.pub, budget, [USDC, WETH, DAI]);
    const goal = BigInt(Math.floor(Number(baselineOut) * GOAL_RATIO / 1e16)) * 10n ** 16n; // DAI to 2 decimals
    let afterSale = await a.rpc('evm_snapshot');
    // Anvil consumes a snapshot on revert, so re-take it every time.
    const restore = async () => { await a.rpc('evm_revert', [afterSale]); afterSale = await a.rpc('evm_snapshot'); };
    const moves: Record<string, any> = {};
    for (const [name, factor] of Object.entries(FACTORS)) {
      const target = BigInt(Math.floor(Number(baselineOut) * factor));
      let lo = 0n, hi = parseEther('5000');
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2n;
        await restore();
        await moveDaiPrice(a, mid);
        if (await quote(a.pub, budget, [USDC, WETH, DAI]) > target) lo = mid; else hi = mid;
      }
      const eth = (lo / 10n ** 15n) * 10n ** 15n; // round to 0.001 ETH
      await restore();
      await moveDaiPrice(a, eth);
      const out = await quote(a.pub, budget, [USDC, WETH, DAI]);
      moves[name] = {moverEthWei: eth.toString(), budgetDaiOutWei: out.toString(), feasible: out >= goal};
    }
    await a.rpc('evm_revert', [base]);
    const frozen = {block, agent: AGENT, agentEth: AGENT_ETH, router: ROUTER, path: [USDC, WETH, DAI],
      saleEth: '0.1', proceedsUsdcUnits: proceeds.toString(), clampUsdcUnits: clampUnits.toString(),
      reserveUsdc: formatUnits(reserve, 6), budgetUsdcUnits: budget.toString(), baselineDaiOutWei: baselineOut.toString(),
      goalDai: formatUnits(goal, 18), goalRatio: GOAL_RATIO, factors: FACTORS, moves,
      riskConfig: cfg, regime: {realizedVol: cfg.volFallback, source: 'fallback'}};
    if (moves.price_change_feasible.feasible !== true || moves.price_change_infeasible.feasible !== false) throw new Error('Calibration did not produce the intended feasibility labels');
    return frozen;
  } finally { a.proc.kill(); await a.proc.exited; }
}

if (import.meta.main && process.argv[2] === 'calibrate') {
  const block = Number(process.argv.find(x => x.startsWith('--block='))?.slice(8));
  const out = process.argv.find(x => x.startsWith('--out='))?.slice(6) ?? join(import.meta.dir, 'frozen-task.json');
  if (!(block > 0)) throw new Error('Pass --block=<pinned mainnet block>');
  if (existsSync(out)) throw new Error(`${out} exists; frozen parameters are never overwritten`);
  const frozen = await calibrate(block);
  writeFileSync(out, JSON.stringify(frozen, null, 2));
  console.log(JSON.stringify(frozen, null, 2));
}
