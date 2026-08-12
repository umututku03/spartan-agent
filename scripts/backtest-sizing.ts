/**
 * Deterministic, no-lookahead sizing backtest (illustrative - for the whitepaper).
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
import { clamp } from '../src/plugins/multiwallet/risk/sizing';
import { loadPrices, simulate, findRegimes, type Metrics, type SimConfig } from './lib/backtest-core';
import { realizedVolatility } from '../src/plugins/multiwallet/risk/sizing';
import { writeFileSync } from 'node:fs';

const PERIODS = 365;
const WARMUP = 30;
const TARGET_VOL = 0.5;
const FIXED_FRAC = 0.5;
const CFG: SimConfig = { warmup: WARMUP, txnCost: 0.001, periods: PERIODS };

type Policy = 'buy-and-hold' | 'fixed-fraction' | 'vol-target' | 'vol-target+cap';
const POLICIES: Policy[] = ['buy-and-hold', 'fixed-fraction', 'vol-target', 'vol-target+cap'];

function exposure(policy: Policy, sigma: number): number {
  switch (policy) {
    case 'buy-and-hold':
      return 1;
    case 'fixed-fraction':
      return FIXED_FRAC;
    case 'vol-target':
      return sigma > 0 ? clamp(TARGET_VOL / sigma, 0, 1.5) : 1.5;
    case 'vol-target+cap':
      return sigma > 0 ? clamp(TARGET_VOL / sigma, 0, 1.0) : 1.0;
  }
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
const { calm, volatile } = findRegimes(prices, WARMUP, PERIODS);
console.log(`Calm 60d window:     ${dates[calm[0]]} -> ${dates[calm[1]]}  vol ${pct(realizedVolatility(prices.slice(calm[0], calm[1]), PERIODS))}`);
console.log(`Volatile 60d window: ${dates[volatile[0]]} -> ${dates[volatile[1]]}  vol ${pct(realizedVolatility(prices.slice(volatile[0], volatile[1]), PERIODS))}`);

const results: any = {
  meta: { start: dates[0], end: dates[dates.length - 1], days: prices.length, fullVol, targetVol: TARGET_VOL },
  windows: {},
};
for (const [label, range] of [['FULL', [WARMUP, prices.length - 1]], ['CALM', calm], ['VOLATILE', volatile]] as const) {
  console.log(`\n=== ${label} window ===`);
  const bh = simulate(prices, dates, range[0], range[1], CFG, (c) => exposure('buy-and-hold', c.sigma)).cum;
  results.windows[label] = { range: [dates[range[0]], dates[range[1]]], policies: {} };
  for (const p of POLICIES) {
    const { m, cum } = simulate(prices, dates, range[0], range[1], CFG, (c) => exposure(p, c.sigma));
    console.log('  ' + row(p, m, cum, bh));
    results.windows[label].policies[p] = { ...m, cumReturn: cum, excessVsHodl: cum - bh };
  }
}
writeFileSync('paper/data/backtest_results.json', JSON.stringify(results, null, 2));
console.log('\nWrote paper/data/backtest_results.json');
