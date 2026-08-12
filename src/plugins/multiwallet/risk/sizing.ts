/**
 * Deterministic position-sizing math. Every function here is PURE (numbers in → numbers out), so it
 * is fully unit-testable offline and the LLM is never involved in the multiply-by-size step.
 *
 * The final position size is the MINIMUM of three independent risk constraints:
 *   1. volatility-target:   f = σ_target / σ_realized   (lean on forecastable vol, not direction)
 *   2. fractional-Kelly:    f = λ · μ / σ²              (growth-optimal, shrunk by λ)
 *   3. wallet cap:          f ≤ maxWalletPct            (hard concentration limit)
 * Taking the min means the most conservative constraint always wins.
 */
import type {
  BindingConstraint,
  HealthFactorDecision,
  HealthFactorInput,
  RiskConfig,
  SizingInput,
  SizingResult,
} from './types';

export function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return Math.min(Math.max(x, lo), hi);
}

/**
 * Annualized realized volatility from a price series, via the sample std-dev of log returns.
 * Returns 0 for fewer than 2 prices (no returns to measure).
 */
export function realizedVolatility(prices: number[], periodsPerYear = 365): number {
  if (!Array.isArray(prices) || prices.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const cur = prices[i];
    if (prev > 0 && cur > 0) returns.push(Math.log(cur / prev));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, r) => a + (r - mean) * (r - mean), 0) / (returns.length - 1); // sample (n-1)
  const perPeriodSd = Math.sqrt(variance);
  return perPeriodSd * Math.sqrt(periodsPerYear);
}

/**
 * Volatility-targeting fraction: f = σ_target / σ_realized, clamped to [0, maxFraction].
 * As realized vol rises the fraction shrinks — the core regime-responsive behaviour.
 * If realized vol is 0/unknown we cannot target, so we defer to the cap (return maxFraction).
 */
export function volTargetFraction(
  targetVol: number,
  realizedVol: number,
  maxFraction = Infinity
): number {
  if (!(realizedVol > 0)) return clamp(maxFraction, 0, maxFraction);
  return clamp(targetVol / realizedVol, 0, maxFraction);
}

/**
 * Fractional-Kelly fraction: f = λ · μ / σ², clamped to [0, maxFraction].
 * μ = expected per-period return (edge), σ² = variance of returns, λ = shrinkage in (0,1].
 * With no edge estimate the Kelly arm should not bind — callers pass maxFraction to neutralize it.
 */
export function fractionalKelly(
  expectedReturn: number,
  variance: number,
  lambda: number,
  maxFraction = Infinity
): number {
  if (!(variance > 0)) return 0;
  const kelly = expectedReturn / variance;
  return clamp(lambda * kelly, 0, maxFraction);
}

/**
 * Combine the three constraints. `expectedReturn`/`variance` are optional: when absent, the Kelly
 * arm is set to the wallet cap so it never binds (we only size on vol + the hard cap).
 */
export function computePositionSize(input: SizingInput): SizingResult {
  const { walletValue, regime, config } = input;
  const cap = Math.max(0, config.maxWalletPct);

  // Compute each constraint UNCAPPED so we can attribute which one truly binds. The wallet cap is a
  // separate hard limit; the final fraction is the min of all three, and the cap wins ties (a
  // vol-target that only fits because it hit the cap should be reported as the cap binding).
  const volatilityTarget = volTargetFraction(config.targetVol, regime.realizedVol, Infinity);

  const hasEdge =
    typeof regime.expectedReturn === 'number' && typeof regime.variance === 'number';
  const fractionalKellyValue = hasEdge
    ? fractionalKelly(regime.expectedReturn!, regime.variance!, config.kellyFraction, Infinity)
    : Infinity; // no edge estimate → Kelly non-binding

  const breakdown = {
    volatilityTarget,
    fractionalKelly: fractionalKellyValue,
    walletCap: cap,
  };

  const fraction = Math.min(volatilityTarget, fractionalKellyValue, cap);
  let boundedBy: BindingConstraint;
  if (cap <= volatilityTarget && cap <= fractionalKellyValue) {
    boundedBy = 'wallet-cap';
  } else if (volatilityTarget <= fractionalKellyValue) {
    boundedBy = 'volatility-target';
  } else {
    boundedBy = 'fractional-kelly';
  }

  return { fraction, size: fraction * Math.max(0, walletValue), boundedBy, breakdown };
}

/**
 * Aave health factor projected AFTER a prospective borrow:
 *   HF = (collateral · liquidationThreshold) / (debt + newBorrow)
 * liquidationThreshold is a FRACTION in [0,1]. HF = Infinity when there is no debt at all.
 */
export function projectedHealthFactor(input: HealthFactorInput): number {
  const { totalCollateralBase, totalDebtBase, liquidationThreshold, newBorrowBase } = input;
  const debt = Math.max(0, totalDebtBase) + Math.max(0, newBorrowBase);
  if (debt <= 0) return Infinity;
  return (Math.max(0, totalCollateralBase) * clamp(liquidationThreshold, 0, 1)) / debt;
}

/**
 * The largest ADDITIONAL borrow (in base units) that keeps the projected health factor at exactly
 * the floor — i.e. invert HF = collateral·liqThreshold / (debt + newBorrow) = floor for newBorrow:
 *   maxNewBorrow = collateral·liqThreshold/floor − debt   (clamped at 0).
 * Powers the "how much can I safely borrow?" answer.
 */
export function maxSafeBorrowBase(
  totalCollateralBase: number,
  totalDebtBase: number,
  liquidationThreshold: number,
  floor: number
): number {
  if (!(floor > 0)) return 0;
  const capacity =
    (Math.max(0, totalCollateralBase) * clamp(liquidationThreshold, 0, 1)) / floor -
    Math.max(0, totalDebtBase);
  return Math.max(0, capacity);
}

/** Allow the borrow only if the projected HF stays at or above the floor. */
export function healthFactorFloorDecision(projectedHF: number, floor: number): HealthFactorDecision {
  const allowed = projectedHF >= floor;
  const hfStr = projectedHF === Infinity ? '∞' : projectedHF.toFixed(3);
  return {
    allowed,
    projectedHF,
    floor,
    reason: allowed
      ? `projected health factor ${hfStr} ≥ floor ${floor.toFixed(2)}`
      : `projected health factor ${hfStr} < floor ${floor.toFixed(2)} — borrow refused to avoid liquidation risk`,
  };
}

/**
 * Convenience for the swap guard: given the spendable balance of the input asset and the requested
 * amount, return the risk-sized amount (never larger than requested) and whether it was clamped.
 */
export function sizeSwapAmount(
  spendableBalance: number,
  requestedAmount: number,
  regime: SizingInput['regime'],
  config: RiskConfig
): { recommended: number; clamped: boolean; result: SizingResult } {
  const result = computePositionSize({ walletValue: spendableBalance, regime, config });
  const recommended = Math.min(requestedAmount, result.size);
  return { recommended, clamped: recommended < requestedAmount - 1e-18, result };
}
