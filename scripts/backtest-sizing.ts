/**
 * Deterministic, no-lookahead sizing backtest (illustrative — for the whitepaper).
 *
 * Runs our pure sizing functions (src/plugins/multiwallet/risk/sizing.ts) over historical ETH daily
 * prices and compares position-sizing policies on risk-adjusted metrics. Structure borrows from the
 * live-trading agent benchmarks (AMA / AI-Trader / KTD-Fin): step through time, decide exposure using
 * ONLY information available up to day t, apply the decision to the day t+1 return, charge a simple
 * turnover cost, and never peek at the future.
 *
 * This is a deterministic sizing study on historical prices, NOT live trading and NOT an LLM in the
 * loop. It shows that volatility-targeting stabilizes realized volatility and cuts drawdown versus
 * fixed sizing; it does not claim alpha.
 *
 *   bun run scripts/backtest-sizing.ts        # uses cached CSV if present, else fetches once
 */
import { realizedVolatility, clamp } from '../src/plugins/multiwallet/risk/sizing';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DATA = 'paper/data/eth_daily.csv';
const PERIODS = 365; // annualization factor for daily data
const WARMUP = 30; // days of history used to estimate realized vol
const TARGET_VOL = 0.5; // annualized target (matches DEFAULT_RISK_CONFIG.targetVol)
const FIXED_FRAC = 0.5; // fixed-fraction policy exposure
const TXN_COST = 0.001; // 10 bps charged per unit of turnover on each rebalance

type Policy = 'buy-and-hold' | 'fixed-fraction' | 'vol-target' | 'vol-target+cap';
const POLICIES: Policy[] = ['buy-and-hold', 'fixed-fraction', 'vol-target', 'vol-target+cap'];

async function loadPrices(): Promise<{ dates: string[]; prices: number[] }> {
  if (existsSync(DATA)) {
    const rows = readFileSync(DATA, 'utf8').trim().split('\n').slice(1);
    const dates: string[] = [];
    const prices: number[] = [];
    for (const r of rows) {
      const [d, p] = r.split(',');
      dates.push(d);
      prices.push(Number(p));
    }
    return { dates, prices };
  }
  // Free, keyless CoinGecko daily history (~1 year). Cached to CSV so the backtest is reproducible.
  const url = 'https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=365';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko fetch failed: ${res.status}. Provide ${DATA} manually.`);
  const j: any = await res.json();
  const arr: [number, number][] = j.prices;
  const dates = arr.map((x) => new Date(x[0]).toISOString().slice(0, 10));
  const prices = arr.map((x) => x[1]);
  mkdirSync('paper/data', { recursive: true });
  writeFileSync(DATA, 'date,price_usd\n' + arr.map((_, i) => `${dates[i]},${prices[i]}`).join('\n') + '\n');
  return { dates, prices };
}

function exposure(policy: Policy, sigma: number): number {
  switch (policy) {
    case 'buy-and-hold':
      return 1;
    case 'fixed-fraction':
      return FIXED_FRAC;
    case 'vol-target':
      // f = targetVol / realizedVol, allowing modest leverage up to 1.5x
      return sigma > 0 ? clamp(TARGET_VOL / sigma, 0, 1.5) : 1.5;
    case 'vol-target+cap':
      // same, but hard-capped at full (no leverage) — the regime-aware, cap-respecting variant
      return sigma > 0 ? clamp(TARGET_VOL / sigma, 0, 1.0) : 1.0;
  }
}

interface Metrics {
  annReturn: number;
  annVol: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  turnover: number;
}

// Simulate a policy over prices[from..to] (no-lookahead: exposure at t uses prices up to t, applied to t->t+1).
function simulate(policy: Policy, prices: number[], from: number, to: number): { m: Metrics; cum: number } {
  const daily: number[] = [];
  let exPrev = 0;
  let turnover = 0;
  const start = Math.max(from, WARMUP);
  for (let t = start; t < to; t++) {
    const window = prices.slice(t - WARMUP, t + 1); // info known at day t
    const sigma = realizedVolatility(window, PERIODS);
    const ex = exposure(policy, sigma);
    const assetRet = prices[t + 1] / prices[t] - 1; // next-day return
    const cost = Math.abs(ex - exPrev) * TXN_COST;
    turnover += Math.abs(ex - exPrev);
    daily.push(ex * assetRet - cost);
    exPrev = ex;
  }
  return { m: metrics(daily, turnover), cum: daily.reduce((eq, r) => eq * (1 + r), 1) - 1 };
}

function metrics(daily: number[], turnover: number): Metrics {
  const n = daily.length;
  const mean = daily.reduce((a, b) => a + b, 0) / n;
  const variance = daily.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const downside = Math.sqrt(daily.filter((r) => r < 0).reduce((a, r) => a + r * r, 0) / n);
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  for (const r of daily) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    maxDD = Math.min(maxDD, equity / peak - 1);
  }
  const annReturn = equity ** (PERIODS / n) - 1;
  return {
    annReturn,
    annVol: sd * Math.sqrt(PERIODS),
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(PERIODS) : 0,
    sortino: downside > 0 ? (mean / downside) * Math.sqrt(PERIODS) : 0,
    maxDrawdown: maxDD,
    turnover,
  };
}

// Find the calmest and most-volatile WINDOW-day sub-ranges by trailing realized vol.
function findRegimes(prices: number[], win = 60): { calm: [number, number]; volatile: [number, number] } {
  let calm: [number, number] = [WARMUP, WARMUP + win];
  let vol: [number, number] = [WARMUP, WARMUP + win];
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = WARMUP; t + win < prices.length; t++) {
    const s = realizedVolatility(prices.slice(t, t + win), PERIODS);
    if (s < lo) { lo = s; calm = [t, t + win]; }
    if (s > hi) { hi = s; vol = [t, t + win]; }
  }
  return { calm, volatile: vol };
}

const pct = (x: number) => (x * 100).toFixed(1) + '%';
function row(name: string, m: Metrics, cum: number, bhCum: number) {
  return [
    name.padEnd(16),
    ('ret ' + pct(cum)).padEnd(14),
    ('vol ' + pct(m.annVol)).padEnd(13),
    ('Sharpe ' + m.sharpe.toFixed(2)).padEnd(14),
    ('Sortino ' + m.sortino.toFixed(2)).padEnd(15),
    ('maxDD ' + pct(m.maxDrawdown)).padEnd(14),
    ('turn ' + m.turnover.toFixed(1)).padEnd(11),
    'exVsHODL ' + pct(cum - bhCum),
  ].join('');
}

const { dates, prices } = await loadPrices();
console.log(`ETH daily series: ${prices.length} days, ${dates[0]} -> ${dates[dates.length - 1]}`);
const fullVol = realizedVolatility(prices, PERIODS);
console.log(`Full-window annualized realized vol: ${pct(fullVol)}  (target ${pct(TARGET_VOL)})`);
const { calm, volatile } = findRegimes(prices);
console.log(`Calm 60d window:     ${dates[calm[0]]} -> ${dates[calm[1]]}  vol ${pct(realizedVolatility(prices.slice(calm[0], calm[1]), PERIODS))}`);
console.log(`Volatile 60d window: ${dates[volatile[0]]} -> ${dates[volatile[1]]}  vol ${pct(realizedVolatility(prices.slice(volatile[0], volatile[1]), PERIODS))}`);

const results: any = {
  meta: { start: dates[0], end: dates[dates.length - 1], days: prices.length, fullVol, targetVol: TARGET_VOL },
  windows: {},
};
for (const [label, range] of [['FULL', [WARMUP, prices.length - 1]], ['CALM', calm], ['VOLATILE', volatile]] as const) {
  console.log(`\n=== ${label} window ===`);
  const bh = simulate('buy-and-hold', prices, range[0], range[1]).cum;
  results.windows[label] = { range: [dates[range[0]], dates[range[1]]], policies: {} };
  for (const p of POLICIES) {
    const { m, cum } = simulate(p, prices, range[0], range[1]);
    console.log('  ' + row(p, m, cum, bh));
    results.windows[label].policies[p] = { ...m, cumReturn: cum, excessVsHodl: cum - bh };
  }
}
writeFileSync('paper/data/backtest_results.json', JSON.stringify(results, null, 2));
console.log('\nWrote paper/data/backtest_results.json');
