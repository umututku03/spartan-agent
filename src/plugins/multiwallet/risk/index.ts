/**
 * Deterministic, regime-aware position-sizing layer - public surface.
 *
 * The two guard entry points the action handlers call:
 *   - sizeSwap:    clamp a swap's input amount to the vol-targeted size (advisory unless enforcing)
 *   - guardBorrow: refuse an Aave borrow that would push the projected health factor below the floor
 *
 * See docs/ETH_MVP_DECISIONS.md Decision 7 and docs/PHASE4_RISK.md.
 */
export * from './types';
export * from './sizing';
export * from './config';
export * from './regime';

import { loadRiskConfig } from './config';
import { getRegimeSignal } from './regime';
import { healthFactorFloorDecision, projectedHealthFactor, sizeSwapAmount } from './sizing';
import type { HealthFactorDecision, RiskConfig } from './types';

type SettingGetter = { getSetting?: (key: string) => string | undefined } | undefined;

export interface SwapGuardResult {
  /** Amount to actually execute (clamped iff enforcing). */
  amount: number;
  /** Amount the risk layer recommends regardless of enforcement. */
  recommended: number;
  /** True if the recommendation is below the request. */
  clamped: boolean;
  enforced: boolean;
  /** Human-readable note to append to the agent's chat reply. */
  note: string;
}

/**
 * Pre-execution swap guard. Fetches the regime (live vol w/ fallback), risk-sizes the input amount,
 * and - when enforcing - returns the clamped amount. Always returns a note explaining the decision.
 */
export async function sizeSwap(params: {
  symbol: string; // input asset symbol, e.g. "ETH"
  spendableBalance: number; // spendable balance of the input asset (same unit as amounts)
  requestedAmount: number;
  runtime?: SettingGetter;
  config?: RiskConfig;
}): Promise<SwapGuardResult> {
  const config = params.config ?? loadRiskConfig(params.runtime);
  const regime = await getRegimeSignal(params.symbol, config);
  const { recommended, clamped, result } = sizeSwapAmount(
    params.spendableBalance,
    params.requestedAmount,
    regime,
    config
  );

  const volPct = (regime.realizedVol * 100).toFixed(0);
  const tgtPct = (config.targetVol * 100).toFixed(0);
  let note: string;
  if (!clamped) {
    note = `Risk check OK: ${params.requestedAmount} ${params.symbol} within the vol-targeted size (realized vol ~${volPct}%/yr, source ${regime.source}, bound by ${result.boundedBy}).`;
  } else if (config.enforce) {
    note = `Risk-sized ${params.requestedAmount} -> ${recommended.toFixed(6)} ${params.symbol}: realized vol ~${volPct}%/yr > target ${tgtPct}%/yr (bound by ${result.boundedBy}, cap ${(config.maxWalletPct * 100).toFixed(0)}% of wallet).`;
  } else {
    note = `Risk advisory (not enforced): recommend ${recommended.toFixed(6)} ${params.symbol} vs requested ${params.requestedAmount} (realized vol ~${volPct}%/yr; set RISK_ENFORCE=1 to auto-size).`;
  }

  return {
    amount: config.enforce ? recommended : params.requestedAmount,
    recommended,
    clamped,
    enforced: config.enforce,
    note,
  };
}

/**
 * Pre-execution borrow guard. Given the current Aave account data and the base-currency value of the
 * requested borrow, decide whether the borrow keeps the projected health factor at/above the floor.
 * Refuses (allowed=false) when enforcing; advisory otherwise (allowed stays true but note warns).
 */
export function guardBorrow(params: {
  accountData: {
    totalCollateralBase: number;
    totalDebtBase: number;
    liquidationThreshold: number; // FRACTION in [0,1]
  };
  newBorrowBase: number;
  runtime?: SettingGetter;
  config?: RiskConfig;
}): HealthFactorDecision & { enforced: boolean } {
  const config = params.config ?? loadRiskConfig(params.runtime);
  const projectedHF = projectedHealthFactor({
    totalCollateralBase: params.accountData.totalCollateralBase,
    totalDebtBase: params.accountData.totalDebtBase,
    liquidationThreshold: params.accountData.liquidationThreshold,
    newBorrowBase: params.newBorrowBase,
  });
  const decision = healthFactorFloorDecision(projectedHF, config.hfFloor);
  // In advisory mode we still surface the warning but don't block.
  const allowed = config.enforce ? decision.allowed : true;
  return { ...decision, allowed, enforced: config.enforce };
}
