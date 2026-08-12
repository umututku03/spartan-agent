import { IAgentRuntime, Service, logger } from '@elizaos/core';
import {
  loadRiskConfig,
  getRegimeSignal,
  sizeSwapAmount,
  guardBorrow,
  maxSafeBorrowBase,
} from '../risk';
import type { RegimeSignal, RiskConfig } from '../risk';
import { getEthereumTokenBalance, getAaveUserAccountData } from '../utils/ethereum';
import { getCacheTimed, setCacheTimed } from '../../autonomous-trader/utils';

/** Aave v3 base currency is USD with 8 decimals. */
const AAVE_BASE = 1e8;
/** Cache regime reads for 5 minutes - a regime read on stale data is worse than none (Decision 7). */
const REGIME_TTL_MS = 5 * 60 * 1000;

export interface SwapAssessment {
  spendable: number;
  regime: RegimeSignal;
  maxSize: number; // vol-targeted budget for this asset
  recommended: number; // min(requested, maxSize) when a request is given
  clamped: boolean;
  boundedBy: string;
  note: string;
}

export interface BorrowAssessment {
  collateralUsd: number;
  debtUsd: number;
  liquidationThreshold: number;
  currentHF: number;
  floor: number;
  maxSafeBorrowUsd: number;
  projectedHF?: number; // only when an amount is given
  allowed?: boolean; // only when an amount is given
  note: string;
}

/**
 * Single source of truth for the deterministic risk layer. Wraps the pure risk core
 * (src/plugins/multiwallet/risk) plus the read-only ethereum helpers, and caches the regime.
 * Consumed by the risk provider, the RISK_ASSESS action, and the swap/lending guards.
 */
export class RiskService extends Service {
  private isRunning = false;

  static serviceType = 'AUTONOMOUS_TRADER_RISK';
  capabilityDescription =
    'Deterministic, regime-aware position sizing and Aave health-factor governance';

  constructor(public runtime: IAgentRuntime) {
    super(runtime);
  }

  getConfig(): RiskConfig {
    return loadRiskConfig(this.runtime);
  }

  /** Cached annualized realized-vol regime for a symbol (freshness-gated). */
  async getRegime(symbol: string): Promise<RegimeSignal> {
    const key = `risk_regime_${symbol.toUpperCase()}`;
    const cached = await getCacheTimed<RegimeSignal>(this.runtime, key, {
      notOlderThan: REGIME_TTL_MS,
    });
    if (cached) return cached;
    const regime = await getRegimeSignal(symbol, this.getConfig());
    await setCacheTimed(this.runtime, key, regime);
    return regime;
  }

  /** Vol-targeted sizing for a (prospective) swap of `symbol` from `walletAddress`. */
  async assessSwap(params: {
    walletAddress: string;
    symbol: string;
    requestedAmount?: number;
  }): Promise<SwapAssessment> {
    const config = this.getConfig();
    const [spendable, regime] = await Promise.all([
      getEthereumTokenBalance(params.walletAddress, params.symbol, this.runtime).catch(() => 0),
      this.getRegime(params.symbol),
    ]);
    const requested = params.requestedAmount ?? spendable;
    const { recommended, clamped, result } = sizeSwapAmount(spendable, requested, regime, config);
    const volPct = (regime.realizedVol * 100).toFixed(0);
    const note =
      `${params.symbol}: realized vol ~${volPct}%/yr (${regime.source}); ` +
      `vol-targeted max ~ ${result.size.toFixed(6)} ${params.symbol} ` +
      `(${(result.fraction * 100).toFixed(1)}% of ${spendable.toFixed(4)}, bound by ${result.boundedBy}).`;
    return {
      spendable,
      regime,
      maxSize: result.size,
      recommended,
      clamped,
      boundedBy: result.boundedBy,
      note,
    };
  }

  /** Aave health-factor headroom for a (prospective) borrow. */
  async assessBorrow(params: {
    walletAddress: string;
    token?: string;
    amount?: number;
  }): Promise<BorrowAssessment> {
    const config = this.getConfig();
    const acct = await getAaveUserAccountData(params.walletAddress, this.runtime);
    const maxSafeBorrowUsd =
      maxSafeBorrowBase(
        acct.totalCollateralBase,
        acct.totalDebtBase,
        acct.liquidationThreshold,
        config.hfFloor
      ) / AAVE_BASE;

    const base: BorrowAssessment = {
      collateralUsd: acct.totalCollateralBase / AAVE_BASE,
      debtUsd: acct.totalDebtBase / AAVE_BASE,
      liquidationThreshold: acct.liquidationThreshold,
      currentHF: acct.healthFactor,
      floor: config.hfFloor,
      maxSafeBorrowUsd,
      note: '',
    };

    if (typeof params.amount === 'number') {
      const decision = guardBorrow({
        accountData: {
          totalCollateralBase: acct.totalCollateralBase,
          totalDebtBase: acct.totalDebtBase,
          liquidationThreshold: acct.liquidationThreshold,
        },
        newBorrowBase: params.amount * AAVE_BASE, // ~$1/token - accurate for stablecoins
        config,
      });
      base.projectedHF = decision.projectedHF;
      base.allowed = decision.allowed;
      base.note = `${decision.reason}. Safe additional borrow ~ $${maxSafeBorrowUsd.toFixed(2)} (floor ${config.hfFloor}).`;
    } else {
      base.note = `Collateral $${base.collateralUsd.toFixed(2)}, debt $${base.debtUsd.toFixed(2)}, HF ${acct.healthFactor === Infinity ? 'inf' : acct.healthFactor.toFixed(2)}; safe additional borrow ~ $${maxSafeBorrowUsd.toFixed(2)} (floor ${config.hfFloor}).`;
    }
    return base;
  }

  static async start(runtime: IAgentRuntime) {
    const service = new RiskService(runtime);
    service.start();
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    const service = runtime.getService(this.serviceType);
    if (!service) throw new Error(this.serviceType + ' service not found');
    service.stop();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    logger.info('Starting risk-governance service...');
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }
}
