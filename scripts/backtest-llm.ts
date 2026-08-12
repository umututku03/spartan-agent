/**
 * LLM-in-the-loop, no-lookahead ETH trading benchmark.
 *
 * At each day the model sees ONLY information available up to that day (recent daily returns and
 * trailing volatility, given as relative numbers with no dates or price levels, to limit both
 * lookahead and memorization) and chooses a target ETH exposure in [0,1]. We then compare:
 *   - llm-raw      : the model's exposure, used directly
 *   - llm+risk     : the model's exposure clamped to our deterministic volatility-targeted budget
 *   - baselines    : buy-and-hold, fixed-fraction, vol-target+cap (deterministic)
 * on the same metrics and stepping as the deterministic backtest (scripts/lib/backtest-core.ts).
 *
 * Decisions are cached per (model, date) so re-runs are free, offline, and deterministic.
 *
 *   OPENAI_API_KEY=sk-... bun run scripts/backtest-llm.ts gpt-4o-mini
 *   OPENAI_API_KEY=sk-... bun run scripts/backtest-llm.ts gpt-4o
 */
import { clamp, realizedVolatility, volTargetFraction } from '../src/plugins/multiwallet/risk/sizing';
import { loadPrices, simulate, type Metrics, type SimConfig } from './lib/backtest-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MODEL = process.argv[2] || 'gpt-4o-mini';
const PERIODS = 365;
const WARMUP = 30;
const TARGET_VOL = 0.5;
const FIXED_FRAC = 0.5;
const RECENT = 90; // last N days reported separately (least-contaminated slice)
const CONCURRENCY = MODEL === 'gpt-4o-mini' ? 8 : 4; // gpt-4o has tighter rate limits
const CFG: SimConfig = { warmup: WARMUP, txnCost: 0.001, periods: PERIODS };
const DECISIONS = `paper/data/llm_decisions_${MODEL}.json`;
const RESULTS = 'paper/data/llm_results.json';

type Decision = { exposure: number; reason: string; fallback?: boolean };

function baseExposure(policy: string, sigma: number): number {
  if (policy === 'buy-and-hold') return 1;
  if (policy === 'fixed-fraction') return FIXED_FRAC;
  if (policy === 'vol-target+cap') return sigma > 0 ? clamp(TARGET_VOL / sigma, 0, 1.0) : 1.0;
  return 1;
}

function prompt(recentReturns: number[], sigma: number, prevExposure: number) {
  const sys =
    'You are a disciplined cryptocurrency trading agent. Each day you decide what fraction of a ' +
    'portfolio to hold in ETH for the next day: 0 means all cash, 1 means fully invested. You only ' +
    'see recent price behavior, never the future. Manage risk: reduce exposure when recent moves are ' +
    'large and choppy, hold more when conditions are calm and trending up. Reply with STRICT JSON: ' +
    '{"exposure": <number 0..1>, "reason": "<one short sentence>"}.';
  const rets = recentReturns.map((r) => (r * 100).toFixed(2)).join(', ');
  const usr =
    `Recent daily returns in %, oldest to newest: [${rets}].\n` +
    `Trailing ${WARMUP}-day annualized volatility: ${(sigma * 100).toFixed(0)}%.\n` +
    `Current ETH exposure: ${prevExposure.toFixed(2)}.\n` +
    `Choose next-day ETH exposure in [0,1] as JSON.`;
  return { sys, usr };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callOpenAI(sys: string, usr: string): Promise<Decision> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  let lastErr = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: usr },
          ],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = `${res.status}`;
        await sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 400)); // backoff + jitter
        continue;
      }
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const j: any = await res.json();
      const parsed = JSON.parse(j.choices[0].message.content);
      const exposure = clamp(Number(parsed.exposure), 0, 1);
      return { exposure: Number.isFinite(exposure) ? exposure : 0.5, reason: String(parsed.reason ?? '').slice(0, 200) };
    } catch (e) {
      lastErr = (e as Error).message;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(lastErr || 'exhausted retries');
}

// ---- collect decisions for every decision day (cached) ----
const { dates, prices } = await loadPrices();
const cache: Record<string, Decision> = existsSync(DECISIONS) ? JSON.parse(readFileSync(DECISIONS, 'utf8')) : {};

const todo: number[] = [];
for (let t = WARMUP; t < prices.length - 1; t++) if (!cache[dates[t]] || cache[dates[t]].fallback) todo.push(t);
console.log(`Model ${MODEL}: ${prices.length - 1 - WARMUP} decision days, ${todo.length} to fetch, ${Object.keys(cache).length} cached.`);

let done = 0;
async function worker(queue: number[]) {
  while (queue.length) {
    const t = queue.shift()!;
    const rr: number[] = [];
    for (let i = t - WARMUP + 1; i <= t; i++) rr.push(Math.log(prices[i] / prices[i - 1]));
    const sigma = realizedVolatility(prices.slice(t - WARMUP, t + 1), PERIODS);
    const { sys, usr } = prompt(rr, sigma, 0.5);
    try {
      cache[dates[t]] = await callOpenAI(sys, usr);
    } catch (e) {
      cache[dates[t]] = { exposure: 0.5, reason: `fallback: ${(e as Error).message}`, fallback: true };
    }
    if (++done % 20 === 0) { writeFileSync(DECISIONS, JSON.stringify(cache, null, 0)); console.log(`  ...${done}/${todo.length}`); }
  }
}
if (todo.length) {
  const q = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(q)));
  writeFileSync(DECISIONS, JSON.stringify(cache, null, 2));
  const fb = Object.values(cache).filter((d) => d.fallback).length;
  console.log(`Fetched. Fallbacks (parse/API errors): ${fb}.`);
}

// ---- exposure functions ----
const llmRaw = (c: { date: string }) => cache[c.date]?.exposure ?? 0.5;
const llmRisk = (c: { date: string; sigma: number }) =>
  Math.min(cache[c.date]?.exposure ?? 0.5, volTargetFraction(TARGET_VOL, c.sigma, 1.0));

const ARMS: Record<string, (c: any) => number> = {
  'buy-and-hold': (c) => baseExposure('buy-and-hold', c.sigma),
  'fixed-fraction': (c) => baseExposure('fixed-fraction', c.sigma),
  'vol-target+cap': (c) => baseExposure('vol-target+cap', c.sigma),
  'llm-raw': llmRaw,
  'llm+risk': llmRisk,
};

const pct = (x: number) => (x * 100).toFixed(1) + '%';
function runWindow(label: string, from: number, to: number) {
  console.log(`\n=== ${MODEL} :: ${label} (${dates[from]} -> ${dates[to]}) ===`);
  const bh = simulate(prices, dates, from, to, CFG, ARMS['buy-and-hold']).cum;
  const out: Record<string, any> = {};
  for (const [arm, fn] of Object.entries(ARMS)) {
    const { m, cum } = simulate(prices, dates, from, to, CFG, fn);
    out[arm] = { ...m, cumReturn: cum, excessVsHodl: cum - bh };
    console.log(
      '  ' +
        arm.padEnd(16) +
        ('ret ' + pct(cum)).padEnd(14) +
        ('vol ' + pct(m.annVol)).padEnd(13) +
        ('Sharpe ' + m.sharpe.toFixed(2)).padEnd(14) +
        ('Sortino ' + m.sortino.toFixed(2)).padEnd(15) +
        ('maxDD ' + pct(m.maxDrawdown)).padEnd(14) +
        'exVsHODL ' + pct(cum - bh)
    );
  }
  return out;
}

const full = runWindow('FULL', WARMUP, prices.length - 1);
const recent = runWindow('RECENT', prices.length - 1 - RECENT, prices.length - 1);

const all = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};
all[MODEL] = {
  meta: { start: dates[0], end: dates[dates.length - 1], recentDays: RECENT, targetVol: TARGET_VOL, warmup: WARMUP },
  FULL: { range: [dates[WARMUP], dates[prices.length - 1]], arms: full },
  RECENT: { range: [dates[prices.length - 1 - RECENT], dates[prices.length - 1]], arms: recent },
};
writeFileSync(RESULTS, JSON.stringify(all, null, 2));
console.log(`\nWrote ${RESULTS} and ${DECISIONS}`);
