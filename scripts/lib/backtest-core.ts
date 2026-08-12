/**
 * Shared, no-lookahead backtest core. Used by both the deterministic sizing backtest
 * (backtest-sizing.ts) and the LLM-in-the-loop benchmark (backtest-llm.ts) so the two produce
 * comparable numbers from the same stepping, cost model, and metrics.
 */
import { realizedVolatility } from '../../src/plugins/multiwallet/risk/sizing';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

export const DATA_CSV = 'paper/data/eth_daily.csv';

export interface Metrics {
  annReturn: number;
  annVol: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  turnover: number;
}

export interface StepCtx {
  t: number; // current day index (decision uses info up to and including t)
  date: string;
  sigma: number; // annualized realized vol from the trailing window ending at t
  prices: number[];
  dates: string[];
}

export interface SimConfig {
  warmup: number;
  txnCost: number; // charged per unit of turnover on each rebalance
  periods: number; // annualization factor (365 for daily)
}

export async function loadPrices(): Promise<{ dates: string[]; prices: number[] }> {
  if (existsSync(DATA_CSV)) {
    const rows = readFileSync(DATA_CSV, 'utf8').trim().split('\n').slice(1);
    const dates: string[] = [];
    const prices: number[] = [];
    for (const r of rows) {
      const [d, p] = r.split(',');
      dates.push(d);
      prices.push(Number(p));
    }
    return { dates, prices };
  }
  const url = 'https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=365';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko fetch failed: ${res.status}. Provide ${DATA_CSV} manually.`);
  const j: any = await res.json();
  const arr: [number, number][] = j.prices;
  const dates = arr.map((x) => new Date(x[0]).toISOString().slice(0, 10));
  const prices = arr.map((x) => x[1]);
  mkdirSync('paper/data', { recursive: true });
  writeFileSync(DATA_CSV, 'date,price_usd\n' + arr.map((_, i) => `${dates[i]},${prices[i]}`).join('\n') + '\n');
  return { dates, prices };
}

export function metrics(daily: number[], turnover: number, periods: number): Metrics {
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
  return {
    annReturn: equity ** (periods / n) - 1,
    annVol: sd * Math.sqrt(periods),
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(periods) : 0,
    sortino: downside > 0 ? (mean / downside) * Math.sqrt(periods) : 0,
    maxDrawdown: maxDD,
    turnover,
  };
}

/**
 * Step through prices[from..to] with strict no-lookahead: the exposure for day t is decided from
 * information available at t and applied to the t -> t+1 return. exposureFn returns a target
 * exposure (fraction of capital in ETH).
 */
export function simulate(
  prices: number[],
  dates: string[],
  from: number,
  to: number,
  cfg: SimConfig,
  exposureFn: (ctx: StepCtx) => number
): { m: Metrics; cum: number; exposures: number[] } {
  const daily: number[] = [];
  const exposures: number[] = [];
  let exPrev = 0;
  let turnover = 0;
  const start = Math.max(from, cfg.warmup);
  for (let t = start; t < to; t++) {
    const sigma = realizedVolatility(prices.slice(t - cfg.warmup, t + 1), cfg.periods);
    const ex = exposureFn({ t, date: dates[t], sigma, prices, dates });
    const assetRet = prices[t + 1] / prices[t] - 1;
    const cost = Math.abs(ex - exPrev) * cfg.txnCost;
    turnover += Math.abs(ex - exPrev);
    daily.push(ex * assetRet - cost);
    exposures.push(ex);
    exPrev = ex;
  }
  return { m: metrics(daily, turnover, cfg.periods), cum: daily.reduce((eq, r) => eq * (1 + r), 1) - 1, exposures };
}

/** Find the calmest and most-volatile `win`-day sub-ranges by trailing realized vol. */
export function findRegimes(prices: number[], warmup: number, periods: number, win = 60) {
  let calm: [number, number] = [warmup, warmup + win];
  let vol: [number, number] = [warmup, warmup + win];
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = warmup; t + win < prices.length; t++) {
    const s = realizedVolatility(prices.slice(t, t + win), periods);
    if (s < lo) { lo = s; calm = [t, t + win]; }
    if (s > hi) { hi = s; vol = [t, t + win]; }
  }
  return { calm, volatile: vol };
}
