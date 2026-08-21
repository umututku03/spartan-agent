/**
 * Phase 6 - end-to-end demo driver (Section 1: the core product, live).
 *
 * Drives the REAL running Spartan agent through the Sessions API and shows the core loop end to end:
 * onboarding (register -> verify -> import) if requested, a real Uniswap V2 swap on the Docker-anvil
 * mainnet fork, a read-only RISK_ASSESS, and an optional Aave supply. Every on-chain claim is confirmed
 * against the fork with eth_getTransactionReceipt.
 *
 * This is the reliable fallback for the live demo: LLM action-selection is non-deterministic, so each
 * command is retried until the agent actually fires the action (not just replies). It is a capability
 * demo at a single forked block, not a backtest; the deterministic numbers live in the Section-2
 * scripts (backtest-sizing.ts, investorbench-eth.ts).
 *
 * Preconditions: Docker-anvil fork up on :8545 and the Spartan agent running on :3000. For full
 * onboarding also tee the agent stdout to a file and pass AGENT_LOG (the verification code is printed
 * there, not in chat). If the box already has a verified wallet imported, run with SKIP_ONBOARDING=1.
 *
 *   # already-seeded box: skip onboarding, just do the actions
 *   SKIP_ONBOARDING=1 bun run scripts/demo-e2e.ts
 *
 *   # fresh box: full flow (needs the agent log for the verification code)
 *   AGENT_LOG=/path/to/agent.output bun run scripts/demo-e2e.ts
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const AGENT = process.env.AGENT_URL || 'http://127.0.0.1:3000';
const RPC = process.env.ETHEREUM_RPC_URL || 'http://127.0.0.1:8545';
const USER_ID = process.env.DEMO_USER_ID || '77777771-7777-7777-7777-777777777771';
const WALLET = process.env.DEMO_WALLET || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil dev acct #0
const EMAIL = 'spartan@warlord.eth';
const AGENT_LOG = process.env.AGENT_LOG;
const SKIP_ONBOARDING = process.env.SKIP_ONBOARDING === '1' || !AGENT_LOG;
const DO_SUPPLY = process.env.DEMO_SUPPLY !== '0'; // Aave supply on by default; set 0 to skip
const MAX_RETRIES = 6;
const TX_RE = /0x[a-fA-F0-9]{64}/; // matches "Transaction ID: 0x.." / "Transaction hash: 0x.."

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (h: string) => `${h.slice(0, 10)}...${h.slice(-4)}`;

type Msg = { content: string; isAgent: boolean; createdAt: string; actions: string[] };

async function jget(path: string): Promise<any> {
  return fetch(`${AGENT}${path}`).then((r) => r.json());
}

async function discoverAgentId(): Promise<string> {
  if (process.env.DEMO_AGENT_ID) return process.env.DEMO_AGENT_ID;
  const r = await jget('/api/agents');
  const agents = r?.data?.agents ?? [];
  const spartan = agents.find((a: any) => /spartan/i.test(a.name)) || agents[0];
  if (!spartan) throw new Error('no agent found at /api/agents');
  return spartan.id;
}

async function newSession(agentId: string): Promise<string> {
  const r = await fetch(`${AGENT}/api/messaging/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId, userId: USER_ID }),
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

// agent replies to `sid` created strictly after `sinceMs`, oldest-first
async function agentRepliesSince(sid: string, sinceMs: number): Promise<Msg[]> {
  const r = await jget(`/api/messaging/sessions/${sid}/messages`);
  const msgs: any[] = r?.messages ?? [];
  return msgs
    .filter((m) => m.isAgent && new Date(m.createdAt).getTime() > sinceMs)
    .map((m) => ({ content: m.content as string, isAgent: true, createdAt: m.createdAt, actions: m.metadata?.actions ?? [] }))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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

// Send a command, poll for the agent's reply. Returns the concatenated new agent text (or '' on timeout).
async function ask(sid: string, content: string, timeoutMs = 60000): Promise<string> {
  const since = Date.now();
  await send(sid, content);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3500);
    const replies = await agentRepliesSince(sid, since);
    if (replies.length) return replies.map((m) => m.content).join('\n');
  }
  return '';
}

// Fire a command that must produce a NEW on-chain tx; retry through non-deterministic action-selection.
async function fireTx(sid: string, command: string, seen: Set<string>): Promise<{ hash: string; text: string } | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const text = await ask(sid, command);
    const m = text.match(TX_RE);
    if (m && !seen.has(m[0])) { seen.add(m[0]); return { hash: m[0], text }; }
    if (/failed|Unsupported|error|revert/i.test(text)) console.log(`    attempt ${attempt}: agent reported a problem, retrying`);
    else console.log(`    attempt ${attempt}: no new tx (agent replied without acting), retrying`);
  }
  return null;
}

function logTailHas(re: RegExp, fromByte: number): RegExpMatchArray | null {
  if (!AGENT_LOG) return null;
  const size = statSync(AGENT_LOG).size;
  if (size <= fromByte) return null;
  return readFileSync(AGENT_LOG).subarray(fromByte).toString('utf8').match(re);
}

// ---- preflight ----
async function preflight(): Promise<string> {
  const fail = (m: string) => { console.error(`  FAIL  ${m}`); process.exit(1); };
  // anvil
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }) }).then((x) => x.json());
    console.log(`  PASS  anvil fork on ${RPC} (block ${parseInt((r as any).result, 16)})`);
  } catch { fail(`anvil not reachable on ${RPC} - start the Docker-anvil fork`); }
  // agent + id
  let agentId = '';
  try {
    agentId = await discoverAgentId();
    console.log(`  PASS  Spartan agent on ${AGENT} (agentId ${agentId})`);
  } catch (e: any) { fail(`agent not reachable on ${AGENT} - ${e.message}`); }
  // onboarding requirement
  if (SKIP_ONBOARDING) console.log('  INFO  SKIP_ONBOARDING - assuming a verified wallet is already imported');
  else console.log(`  PASS  AGENT_LOG set (${AGENT_LOG}) - will parse the verification code from it`);
  return agentId;
}

async function onboard(sid: string) {
  console.log('\n[onboard] register -> verify -> import');
  const fromByte = AGENT_LOG ? statSync(AGENT_LOG).size : 0;
  let reg = '';
  for (let a = 1; a <= MAX_RETRIES && !/code|verif|register/i.test(reg); a++) reg = await ask(sid, `Please register my account. My email is ${EMAIL}`);
  console.log(`  register -> "${reg.slice(0, 80).replace(/\n/g, ' ')}"`);
  let code: string | null = null;
  for (let i = 0; i < 8 && !code; i++) { const m = logTailHas(/sending\s+([A-Za-z0-9]{4,8})\s+to\s+email/i, fromByte); if (m) code = m[1]; else await sleep(1500); }
  if (!code) throw new Error('could not read verification code from AGENT_LOG (expected "sending <CODE> to email ...")');
  console.log(`  code from log -> ${code}`);
  const ver = await ask(sid, `my verification code is ${code}`);
  console.log(`  verify   -> "${ver.slice(0, 80).replace(/\n/g, ' ')}"`);
  let imp = '';
  for (let a = 1; a <= MAX_RETRIES && !/public key|0x[a-fA-F0-9]{40}|wallet/i.test(imp); a++) imp = await ask(sid, `import my ethereum wallet ${ANVIL_KEY}`);
  console.log(`  import   -> "${imp.slice(0, 120).replace(/\n/g, ' ')}"`);
}

// ---- main ----
console.log('Phase 6 end-to-end demo driver (Section 1: core product, live on the fork)\n');
console.log('[preflight]');
const agentId = await preflight();
const sid = await newSession(agentId);
console.log(`\n[session] ${sid}`);

const seen = new Set<string>();
const result: any = { meta: { wallet: WALLET, agentId, session: sid, note: 'capability demo at a single fork block; live LLM action-selection retried; not a backtest' }, steps: [] as any[] };

if (!SKIP_ONBOARDING) await onboard(sid);

// [1] real swap
console.log('\n[1] swap 0.05 ETH -> USDC (real tx on the fork)');
const swap = await fireTx(sid, `Execute a swap now: 0.05 ETH to USDC using my wallet ${WALLET}`, seen);
if (swap) {
  await sleep(1500);
  const rec = await receipt(swap.hash);
  console.log(`    tx ${short(swap.hash)}  status ${rec?.status}  block ${rec?.block}`);
  result.steps.push({ step: 'swap', txHash: swap.hash, status: rec?.status ?? null, block: rec?.block ?? null, from: rec?.from ?? null });
} else { console.log('    NOT FIRED after retries'); result.steps.push({ step: 'swap', txHash: null }); }

// [2] read-only risk assessment. RISK_ASSESS replies via takeItPrivate (channelType DM), so its text
// does not surface in the GROUP Sessions channel this driver reads; it renders in the web UI. We scan
// AGENT_LOG as a best-effort capture and never treat a miss as failure.
console.log('\n[2] assess my risk (RISK_ASSESS, read-only - replies privately/DM)');
const riskFrom = AGENT_LOG ? statSync(AGENT_LOG).size : 0;
await ask(sid, 'how much ETH can I safely swap right now, and how much can I borrow on Aave?');
const riskLog = logTailHas(/Risk assessment for[\s\S]{0,400}/i, riskFrom);
if (riskLog) console.log(`    ${riskLog[0].split('\n').slice(0, 4).join(' | ')}`);
else console.log('    RISK_ASSESS is a private reply - show it live in the web UI (see docs/DEMO.md)');
result.steps.push({ step: 'risk_assess', privateReply: true, capturedFromLog: riskLog ? riskLog[0].slice(0, 400) : null });

// [3] optional Aave supply
if (DO_SUPPLY) {
  console.log('\n[3] supply 100 USDC to Aave (real tx on the fork)');
  const sup = await fireTx(sid, `supply 100 USDC to Aave from my wallet ${WALLET}`, seen);
  if (sup) {
    await sleep(1500);
    const rec = await receipt(sup.hash);
    console.log(`    tx ${short(sup.hash)}  status ${rec?.status}  block ${rec?.block}`);
    result.steps.push({ step: 'supply', txHash: sup.hash, status: rec?.status ?? null, block: rec?.block ?? null });
  } else { console.log('    NOT FIRED after retries (supply needs prior USDC balance from the swap)'); result.steps.push({ step: 'supply', txHash: null }); }
}

const onchain = result.steps.filter((s: any) => s.txHash && s.status === '0x1');
console.log(`\n[summary] ${onchain.length} confirmed on-chain tx (status 0x1):`);
for (const s of onchain) console.log(`  ${s.step.padEnd(8)} ${s.txHash}  block ${s.block}`);
writeFileSync('paper/data/demo_e2e.json', JSON.stringify(result, null, 2));
console.log('\nWrote paper/data/demo_e2e.json');
if (!onchain.length) { console.error('No on-chain tx captured - re-run, or drive the swap manually in the web UI.'); process.exit(2); }
