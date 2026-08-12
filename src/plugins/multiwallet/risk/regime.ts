/**
 * Regime signal acquisition for the MVP: realized volatility from recent daily prices.
 *
 * The volatility MATH lives in sizing.ts (pure, unit-tested). This file only fetches the input
 * series from a FREE, keyless source (CoinGecko market_chart) and degrades gracefully to a
 * configured fallback vol when the network/API is unavailable — a guard must never hard-fail open.
 *
 * Future, richer regime inputs (Decision 7): CoinGlass (funding / OI / CVD / liquidations),
 * DefiLlama (on-chain / TVL), FRED (macro). All should be freshness-gated — a regime read on stale
 * data is worse than none (a top CryptoBench failure mode).
 */
import { realizedVolatility } from './sizing';
import type { RegimeSignal, RiskConfig } from './types';

const COINGECKO_IDS: Record<string, string> = {
  ETH: 'ethereum',
  WETH: 'ethereum',
  BTC: 'bitcoin',
  WBTC: 'wrapped-bitcoin',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
};

/** Fetch recent daily close prices for a symbol from CoinGecko (free, no key). */
export async function fetchRecentPrices(
  symbol: string,
  days = 30,
  timeoutMs = 4000
): Promise<number[] | null> {
  const id = COINGECKO_IDS[symbol.toUpperCase()];
  if (!id) return null;
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json: any = await res.json();
    const prices: number[] = (json?.prices ?? []).map((p: [number, number]) => p[1]);
    return prices.length >= 2 ? prices : null;
  } catch {
    return null; // network/timeout/parse — caller falls back
  }
}

/**
 * Resolve a RegimeSignal (annualized realized vol) for a symbol.
 * Tries live prices; on any failure uses config.volFallback. Never throws.
 */
export async function getRegimeSignal(symbol: string, config: RiskConfig): Promise<RegimeSignal> {
  const prices = await fetchRecentPrices(symbol);
  if (prices && prices.length >= 2) {
    const realizedVol = realizedVolatility(prices, 365);
    if (realizedVol > 0) return { realizedVol, source: 'live' };
  }
  return { realizedVol: config.volFallback, source: 'fallback' };
}
