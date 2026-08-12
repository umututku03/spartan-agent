/**
 * Types for the deterministic, regime-aware position-sizing layer.
 *
 * This is the project's novel contribution (see docs/ETH_MVP_DECISIONS.md Decision 7): the layer
 * between signal ("what to trade") and execution ("how to trade") that answers "HOW MUCH to risk
 * given the regime." All sizing math is deterministic - the LLM is never in the multiply-by-size
 * step. Grounded in arXiv:2512.00417 (prediction is the weak axis, so size on forecastable vol) and
 * arXiv:2501.00826 (which omits the slippage/regime realism we add).
 */

/** Tunable risk parameters (defaults in config.ts, overridable via env / runtime.getSetting). */
export interface RiskConfig {
  /** Annualized target portfolio volatility (e.g. 0.50 = 50%/yr). */
  targetVol: number;
  /** Hard cap on any single position as a fraction of the wallet (e.g. 0.25 = 25%). */
  maxWalletPct: number;
  /** Kelly shrinkage factor lambda in (0,1]; 0.5 = "half-Kelly". */
  kellyFraction: number;
  /** Aave health-factor floor; a borrow that would push HF below this is refused (e.g. 1.5). */
  hfFloor: number;
  /** When false, the guards compute + annotate but do NOT clamp/refuse (advisory mode). */
  enforce: boolean;
  /** Fallback annualized realized vol used when live price data is unavailable. */
  volFallback: number;
}

/** A (minimal, MVP) read of the current market regime. */
export interface RegimeSignal {
  /** Annualized realized volatility of the traded asset. */
  realizedVol: number;
  /** Where realizedVol came from - for transparency in logs/replies. */
  source: 'live' | 'fallback' | 'provided';
  /** Optional expected per-period return (edge) for the Kelly arm; omitted -> Kelly not binding. */
  expectedReturn?: number;
  /** Optional variance of returns for the Kelly arm. */
  variance?: number;
}

/** Which constraint ended up binding the position size. */
export type BindingConstraint = 'volatility-target' | 'fractional-kelly' | 'wallet-cap';

export interface SizingInput {
  /** Total sizeable value of the wallet, in the unit you want the size back in (ETH or USD). */
  walletValue: number;
  regime: RegimeSignal;
  config: RiskConfig;
}

export interface SizingResult {
  /** Final fraction of the wallet to allocate: min(volTarget, kelly, cap). */
  fraction: number;
  /** fraction * walletValue, in the same unit as walletValue. */
  size: number;
  /** Which constraint bound the size. */
  boundedBy: BindingConstraint;
  /** The individual candidate fractions, for transparency / the paper. */
  breakdown: { volatilityTarget: number; fractionalKelly: number; walletCap: number };
}

/** Inputs to the Aave health-factor projection (all amounts in the same base unit). */
export interface HealthFactorInput {
  totalCollateralBase: number;
  totalDebtBase: number;
  /** Liquidation threshold as a FRACTION in [0,1] (Aave reports bps; convert at the call site). */
  liquidationThreshold: number;
  /** The additional debt (in base units) the requested borrow would add. */
  newBorrowBase: number;
}

export interface HealthFactorDecision {
  allowed: boolean;
  /** Projected HF after the new borrow (Infinity if no debt). */
  projectedHF: number;
  floor: number;
  reason: string;
}
