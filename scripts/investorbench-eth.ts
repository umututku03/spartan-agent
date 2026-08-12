/**
 * Step 2b - external benchmark comparison against InvestorBench's Ethereum task.
 *
 * InvestorBench (felis33/INVESTOR-BENCH, arXiv:2412.18174, ACL 2025) evaluates LLM agents on an ETH
 * trading task. Its full harness needs a multi-GPU VLLM server, a Qdrant vector DB, the FinMem memory
 * agent, and OpenAI embeddings, so we do NOT run it here. Instead we reproduce its ETH task exactly -
 * same price series (their data/eth.json), same test window (2023-04-03 to 2023-11-05, 365-day
 * annualization), and the same metric formulas from their src/eval_pipeline.py - and compare OUR
 * deterministic sizing policy to their published Table 3 numbers.
 *
 * Metric formulas (verbatim from their code): daily reward r_i = action_i * ln(p_{i+1}/p_i);
 * cumulative return = sum(r_i); annualized volatility = sample_std(r) * sqrt(365); Sharpe =
 * (CR * 252 / len(prices)) / AV (their two annualization constants differ - we mirror them);
 * max drawdown over the product of (1+r_i). Reproducing buy-and-hold matches their published
 * CR 4.528% / AV 41.817% / MDD 29.889% / SR 0.146 exactly, which validates the reproduction.
 *
 *   bun run scripts/investorbench-eth.ts
 */
import { realizedVolatility, clamp } from '../src/plugins/multiwallet/risk/sizing';
import { readFileSync, writeFileSync } from 'node:fs';

const CSV = 'paper/data/eth_2023_investorbench.csv';
const TEST_START = '2023-04-03';
const TEST_END = '2023-11-05';
const WARMUP = 30; // trailing days for our realized-vol estimate (uses pre-test data, no lookahead)
const TARGET_VOL = 0.5; // our layer's default annualized target
const AV_DAYS = 365;
const SHARPE_DAYS = 252;

// InvestorBench published ETH results (Table 3), for comparison.
const PUBLISHED: Record<string, { cr: number; sr: number; av: number; mdd: number }> = {
  'Buy&Hold (theirs)': { cr: 4.528, sr: 0.146, av: 41.817, mdd: 29.889 },
  'GPT-4o (theirs)': { cr: 4.666, sr: 0.19, av: 33.051, mdd: 22.539 },
  'GPT-4 (theirs)': { cr: 1.516, sr: 0.051, av: 39.812, mdd: 32.541 },
  'Qwen2.5-72B (theirs)': { cr: 11.984, sr: 0.584, av: 18.554, mdd: 27.642 },
  'Llama-3.1-70B (theirs)': { cr: -11.888, sr: -0.41, av: 39.047, mdd: 36.416 },
  'Palmyra-Fin-70B (theirs)': { cr: 4.795, sr: 0.24, av: 26.924, mdd: 16.405 },
};

// ---- load their exact ETH series ----
const rows = readFileSync(CSV, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const dates = rows.map((r) => r[0]);
const prices = rows.map((r) => Number(r[1]));
const t0 = dates.findIndex((d) => d >= TEST_START);
const t1 = dates.findIndex((d) => d > TEST_END) - 1;

// InvestorBench metric formulas, applied to a per-day action series over the test window.
function metrics(actions: number[]) {
  const dr: number[] = [];
  for (let i = t0; i <= t1 - 1; i++) dr.push(actions[i - t0] * Math.log(prices[i + 1] / prices[i]));
  const nPrices = dr.length + 1;
  const cr = dr.reduce((a, b) => a + b, 0);
  const mean = cr / dr.length;
  const sd = Math.sqrt(dr.reduce((a, r) => a + (r - mean) ** 2, 0) / (dr.length - 1));
  const av = sd * Math.sqrt(AV_DAYS);
  const sharpe = av > 0 ? (cr * SHARPE_DAYS) / nPrices / av : 0;
  let eq = 1, peak = 1, mdd = 0;
  for (const r of dr) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.max(mdd, (peak - eq) / peak); }
  return { cr: cr * 100, sr: sharpe, av: av * 100, mdd: mdd * 100 };
}

// ---- our policy exposures over the test window (no lookahead: vol from trailing prices up to t) ----
const nDays = t1 - t0 + 1;
const exposures: number[] = [];
for (let k = 0; k < nDays; k++) {
  const t = t0 + k;
  const sigma = realizedVolatility(prices.slice(t - WARMUP, t + 1), AV_DAYS);
  exposures.push(sigma > 0 ? clamp(TARGET_VOL / sigma, 0, 1) : 1); // long-only, vol-targeted, capped at 1
}

const arms: Record<string, number[]> = {
  'buy-and-hold (repro)': exposures.map(() => 1),
  'ours vol-target': exposures.slice(),
  'ours vol-target (long/flat)': exposures.map((e) => (e >= 0.5 ? 1 : 0)),
};

// ---- optional LLM arm: gpt-4o-mini makes buy/sell/hold each day (their action space) ----
// price-only prompt (no news/memory, unlike InvestorBench); 2023 window is inside training cutoffs
// so this arm is contamination-prone. Cached for reproducibility.
const LLM_CACHE = 'paper/data/investorbench_llm_gpt-4o-mini.json';
async function llmPositions(): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY;
  let cache: Record<string, number> = {};
  try { cache = JSON.parse(readFileSync(LLM_CACHE, 'utf8')); } catch {}
  const need = [] as number[];
  for (let k = 0; k < nDays; k++) if (!(dates[t0 + k] in cache)) need.push(t0 + k);
  if (need.length && !key) return null; // can't fetch and nothing cached
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function one(t: number) {
    const rr: number[] = [];
    for (let i = t - WARMUP + 1; i <= t; i++) rr.push((Math.log(prices[i] / prices[i - 1]) * 100));
    const sigma = realizedVolatility(prices.slice(t - WARMUP, t + 1), AV_DAYS);
    const body = {
      model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a crypto trading agent. Decide today\'s ETH stance for tomorrow from recent price behaviour only. Reply STRICT JSON {"action":"BUY"|"SELL"|"HOLD"}. BUY=go long, SELL=go short/flat, HOLD=keep current.' },
        { role: 'user', content: `Recent daily returns %: [${rr.map((x) => x.toFixed(2)).join(', ')}]. Trailing vol ${(sigma * 100).toFixed(0)}%/yr. Action?` },
      ],
    };
    for (let a = 0; a < 6; a++) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
        if (res.status === 429 || res.status >= 500) { await sleep(800 * 2 ** a); continue; }
        const j: any = await res.json();
        const act = String(JSON.parse(j.choices[0].message.content).action || 'HOLD').toUpperCase();
        return act === 'BUY' ? 1 : act === 'SELL' ? -1 : 0;
      } catch { await sleep(500 * 2 ** a); }
    }
    return 0;
  }
  const q = [...need];
  await Promise.all(Array.from({ length: 8 }, async () => { while (q.length) { const t = q.shift()!; const v = await one(t); cache[dates[t]] = v === 1 ? 1 : v === -1 ? -1 : 2; } }));
  writeFileSync(LLM_CACHE, JSON.stringify(cache, null, 0));
  // map raw actions to a carried position series: BUY=+1, SELL=-1, HOLD(2)=carry previous
  const pos: number[] = [];
  let cur = 0;
  for (let k = 0; k < nDays; k++) { const raw = cache[dates[t0 + k]]; if (raw === 1) cur = 1; else if (raw === -1) cur = -1; pos.push(cur); }
  return pos;
}

const llmPos = await llmPositions();
if (llmPos) arms['ours LLM gpt-4o-mini (contaminated)'] = llmPos;

const fmt = (m: { cr: number; sr: number; av: number; mdd: number }) =>
  `CR ${m.cr.toFixed(3)}%  SR ${m.sr.toFixed(3)}  AV ${m.av.toFixed(3)}%  MDD ${m.mdd.toFixed(3)}%`;

console.log(`InvestorBench ETH task reproduction | test ${dates[t0]} -> ${dates[t1]} | ${nDays - 1} returns\n`);
console.log('=== reproduced buy-and-hold (sanity vs their published) ===');
const bh = metrics(arms['buy-and-hold (repro)']);
console.log('  reproduced:', fmt(bh));
console.log('  published :', fmt(PUBLISHED['Buy&Hold (theirs)']));

console.log('\n=== our deterministic policy (contamination-free) ===');
const results: any = { meta: { window: [dates[t0], dates[t1]], returns: nDays - 1, avDays: AV_DAYS, sharpeDays: SHARPE_DAYS }, ours: {}, published: PUBLISHED };
for (const [name, act] of Object.entries(arms)) {
  const m = metrics(act);
  results.ours[name] = m;
  console.log(`  ${name.padEnd(28)} ${fmt(m)}`);
}
console.log('\n=== InvestorBench published ETH results (Table 3) ===');
for (const [name, m] of Object.entries(PUBLISHED)) console.log(`  ${name.padEnd(28)} ${fmt(m)}`);

writeFileSync('paper/data/investorbench_eth.json', JSON.stringify(results, null, 2));
console.log('\nWrote paper/data/investorbench_eth.json');
