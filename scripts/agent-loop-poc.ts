/**
 * Step 2a.2 - agent-in-the-loop proof of concept.
 *
 * Replays the LLM's own cached daily decisions (from the stage-1 benchmark) and has the REAL running
 * Spartan agent execute each one as an actual Uniswap V2 swap on the Docker-anvil mainnet fork. This
 * closes the loop end to end: LLM decision -> chat command -> Spartan action -> on-chain transaction.
 *
 * This is a CAPABILITY DEMO at a single forked block, not a historical backtest. The exposure->swap
 * mapping is illustrative (each day's target exposure is turned into a small de-risking ETH->USDC
 * swap); the point is that the deployed agent really executes the decisions on chain.
 *
 * Preconditions: the Spartan agent is running on :3000 with a verified account + imported wallet for
 * USER_ID (anvil account-0), and the Docker-anvil fork is up. Decisions are read from the stage-1
 * cache (no new LLM calls).
 *
 *   AGENT_LOG=/path/to/agent.output bun run scripts/agent-loop-poc.ts [N]
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const AGENT = 'http://127.0.0.1:3000';
const RPC = 'http://127.0.0.1:8545';
const AGENT_ID = '479233fd-b0e7-0f50-9d88-d4c9ea5b0de0';
const USER_ID = '77777771-7777-7777-7777-777777777771';
const WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const DECISIONS = 'paper/data/llm_decisions_gpt-4o-mini.json';
const AGENT_LOG = process.env.AGENT_LOG;
const N = Number(process.argv[2] || 6);
const BASE = 0.1;
const FLOOR = 0.02;
const MAX_RETRIES = 5;

if (!AGENT_LOG) throw new Error('Set AGENT_LOG to the running agent stdout log path');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newSession(): Promise<string> {
  const r = await fetch(`${AGENT}/api/messaging/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: AGENT_ID, userId: USER_ID }),
  }).then((x) => x.json());
  return (r as any).sessionId;
}

async function send(sid: string, content: string) {
  await fetch(`${AGENT}/api/messaging/sessions/${sid}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

function logTail(fromByte: number): string {
  const size = statSync(AGENT_LOG!).size;
  if (size <= fromByte) return '';
  const buf = readFileSync(AGENT_LOG!);
  return buf.subarray(fromByte).toString('utf8');
}

async function receipt(hash: string) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [hash], id: 1 }),
  }).then((x) => x.json());
  const res = (r as any).result;
  return res ? { status: res.status, block: parseInt(res.blockNumber, 16), from: res.from } : null;
}

// Fire one swap command and wait for the agent to report a NEW (unseen) tx hash in its log.
// Each command carries a distinct amount so the agent does not dedupe identical messages.
async function fireSwap(sid: string, amount: number, seen: Set<string>): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const from = statSync(AGENT_LOG!).size;
    await send(sid, `swap ${amount} ETH for USDC from my wallet ${WALLET} now`);
    for (let i = 0; i < 12; i++) {
      await sleep(4000);
      const tail = logTail(from);
      for (const m of tail.matchAll(/Transaction ID: `?(0x[a-f0-9]{64})`?/g)) {
        if (!seen.has(m[1])) { seen.add(m[1]); return m[1]; }
      }
      if (/Ethereum swap failed|Unsupported Ethereum token/.test(tail)) break; // failed; retry
    }
    console.log(`    attempt ${attempt}: no new tx, retrying...`);
  }
  return null;
}

// ---- main ----
const cache: Record<string, { exposure: number; reason: string }> = JSON.parse(readFileSync(DECISIONS, 'utf8'));
const days = Object.keys(cache).sort().slice(-N); // most-recent N days
console.log(`Agent-in-the-loop PoC: ${days.length} steps, wallet ${WALLET}`);
console.log(`Replaying gpt-4o-mini decisions for ${days[0]} -> ${days[days.length - 1]}\n`);

const sid = await newSession();
const seen = new Set<string>();
const steps: any[] = [];
let idx = 0;
for (const date of days) {
  const exposure = cache[date].exposure;
  // de-risking swap sized by the day's exposure; nudged per step so each command is distinct on-chain
  const amount = Math.round((Math.max(FLOOR, BASE * (1 - exposure)) + idx * 0.005) * 10000) / 10000;
  idx++;
  console.log(`Step ${date}: exposure ${exposure} -> swap ${amount} ETH -> USDC`);
  const hash = await fireSwap(sid, amount, seen);
  let rec = null;
  if (hash) {
    await sleep(1500);
    rec = await receipt(hash);
    console.log(`  tx ${hash}  status ${rec?.status ?? '?'}  block ${rec?.block ?? '?'}`);
  } else {
    console.log(`  not-fired after ${MAX_RETRIES} retries`);
  }
  steps.push({ date, exposure, amount, txHash: hash, status: rec?.status ?? null, block: rec?.block ?? null, from: rec?.from ?? null });
}

const fired = steps.filter((s) => s.txHash && s.status === '0x1');
const out = {
  meta: { wallet: WALLET, model: 'gpt-4o-mini', steps: steps.length, fired: fired.length, note: 'capability demo at a single fork block; illustrative exposure->swap mapping; not a historical backtest' },
  steps,
};
writeFileSync('paper/data/agent_loop_poc.json', JSON.stringify(out, null, 2));
console.log(`\n${fired.length}/${steps.length} steps executed on-chain (status 0x1). Wrote paper/data/agent_loop_poc.json`);
