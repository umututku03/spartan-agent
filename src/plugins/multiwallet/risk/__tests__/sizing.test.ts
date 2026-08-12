import { describe, it, expect } from 'vitest';
import {
  realizedVolatility,
  volTargetFraction,
  fractionalKelly,
  computePositionSize,
  projectedHealthFactor,
  healthFactorFloorDecision,
  maxSafeBorrowBase,
  sizeSwapAmount,
  clamp,
} from '../sizing';
import { DEFAULT_RISK_CONFIG, loadRiskConfig } from '../config';
import type { RiskConfig } from '../types';

const CFG: RiskConfig = { ...DEFAULT_RISK_CONFIG };

describe('clamp', () => {
  it('bounds within range and maps NaN to lo', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(NaN, 2, 10)).toBe(2);
  });
});

describe('realizedVolatility', () => {
  it('is 0 for <2 prices', () => {
    expect(realizedVolatility([])).toBe(0);
    expect(realizedVolatility([100])).toBe(0);
  });

  it('is 0 for a flat price series (no variation)', () => {
    expect(realizedVolatility([100, 100, 100, 100])).toBe(0);
  });

  it('is positive and larger for a more volatile series', () => {
    const calm = realizedVolatility([100, 101, 100, 101, 100, 101]);
    const wild = realizedVolatility([100, 130, 90, 140, 80, 150]);
    expect(calm).toBeGreaterThan(0);
    expect(wild).toBeGreaterThan(calm);
  });

  it('annualizes: higher periodsPerYear => higher annualized vol', () => {
    const s = [100, 105, 98, 103, 99];
    expect(realizedVolatility(s, 365)).toBeGreaterThan(realizedVolatility(s, 52));
  });
});

describe('volTargetFraction', () => {
  it('equals target/realized when uncapped', () => {
    expect(volTargetFraction(0.5, 1.0)).toBeCloseTo(0.5, 12);
    expect(volTargetFraction(0.5, 0.25)).toBeCloseTo(2.0, 12);
  });

  it('monotonically DECREASES as realized vol rises', () => {
    const a = volTargetFraction(0.5, 0.25);
    const b = volTargetFraction(0.5, 0.5);
    const c = volTargetFraction(0.5, 1.0);
    const d = volTargetFraction(0.5, 2.0);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(d);
  });

  it('respects the max fraction cap', () => {
    expect(volTargetFraction(0.5, 0.1, 0.25)).toBe(0.25);
  });

  it('falls back to the cap when realized vol is 0/unknown', () => {
    expect(volTargetFraction(0.5, 0, 0.25)).toBe(0.25);
  });
});

describe('fractionalKelly', () => {
  it('is 0 when variance is non-positive', () => {
    expect(fractionalKelly(0.1, 0, 0.5)).toBe(0);
    expect(fractionalKelly(0.1, -1, 0.5)).toBe(0);
  });

  it('scales with the shrinkage factor lambda', () => {
    const full = fractionalKelly(0.02, 0.04, 1.0);
    const half = fractionalKelly(0.02, 0.04, 0.5);
    expect(half).toBeCloseTo(full * 0.5, 12);
  });

  it('never exceeds the cap and is never negative', () => {
    expect(fractionalKelly(10, 0.01, 1.0, 0.25)).toBe(0.25);
    expect(fractionalKelly(-0.1, 0.04, 0.5)).toBe(0); // negative edge => no position
  });
});

describe('computePositionSize', () => {
  it('is bound by volatility-target in a high-vol regime', () => {
    const r = computePositionSize({
      walletValue: 10,
      regime: { realizedVol: 2.0, source: 'provided' }, // target 0.5 => volF = 0.25 (== cap here)
      config: { ...CFG, targetVol: 0.5, maxWalletPct: 0.5 },
    });
    expect(r.boundedBy).toBe('volatility-target');
    expect(r.fraction).toBeCloseTo(0.25, 12);
    expect(r.size).toBeCloseTo(2.5, 12);
  });

  it('is bound by the wallet cap in a calm regime', () => {
    const r = computePositionSize({
      walletValue: 10,
      regime: { realizedVol: 0.1, source: 'provided' }, // volF would be 5.0, capped at 0.25
      config: { ...CFG, targetVol: 0.5, maxWalletPct: 0.25 },
    });
    expect(r.boundedBy).toBe('wallet-cap');
    expect(r.fraction).toBe(0.25);
    expect(r.size).toBeCloseTo(2.5, 12);
  });

  it('never exceeds the hard wallet cap regardless of regime', () => {
    for (const vol of [0.05, 0.2, 0.5, 1, 3]) {
      const r = computePositionSize({
        walletValue: 100,
        regime: { realizedVol: vol, source: 'provided' },
        config: { ...CFG, maxWalletPct: 0.25 },
      });
      expect(r.fraction).toBeLessThanOrEqual(0.25 + 1e-12);
    }
  });

  it('size shrinks as realized vol rises (regime responsiveness)', () => {
    const mk = (vol: number) =>
      computePositionSize({
        walletValue: 10,
        regime: { realizedVol: vol, source: 'provided' },
        config: { ...CFG, targetVol: 0.5, maxWalletPct: 1.0 },
      }).size;
    expect(mk(0.5)).toBeGreaterThan(mk(1.0));
    expect(mk(1.0)).toBeGreaterThan(mk(2.0));
  });

  it('lets fractional-Kelly bind when it is the smallest', () => {
    const r = computePositionSize({
      walletValue: 10,
      regime: { realizedVol: 0.5, source: 'provided', expectedReturn: 0.002, variance: 0.04 },
      // volF = 1.0 (capped 1.0); kelly = 0.5 * 0.002/0.04 = 0.025; cap 1.0 => kelly binds
      config: { ...CFG, targetVol: 0.5, maxWalletPct: 1.0, kellyFraction: 0.5 },
    });
    expect(r.boundedBy).toBe('fractional-kelly');
    expect(r.fraction).toBeCloseTo(0.025, 12);
  });
});

describe('projectedHealthFactor & floor', () => {
  it('is Infinity when there is no debt', () => {
    expect(
      projectedHealthFactor({
        totalCollateralBase: 1000,
        totalDebtBase: 0,
        liquidationThreshold: 0.8,
        newBorrowBase: 0,
      })
    ).toBe(Infinity);
  });

  it('computes HF = collateral*threshold / (debt+newBorrow)', () => {
    // 1000 * 0.8 / (0 + 100) = 8.0
    expect(
      projectedHealthFactor({
        totalCollateralBase: 1000,
        totalDebtBase: 0,
        liquidationThreshold: 0.8,
        newBorrowBase: 100,
      })
    ).toBeCloseTo(8.0, 12);
  });

  it('drops as the new borrow grows', () => {
    const hf = (nb: number) =>
      projectedHealthFactor({
        totalCollateralBase: 1000,
        totalDebtBase: 0,
        liquidationThreshold: 0.8,
        newBorrowBase: nb,
      });
    expect(hf(100)).toBeGreaterThan(hf(400));
  });

  it('floor decision allows HF >= floor and refuses below', () => {
    expect(healthFactorFloorDecision(1.8, 1.5).allowed).toBe(true);
    const refused = healthFactorFloorDecision(1.2, 1.5);
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toMatch(/refused/i);
    expect(healthFactorFloorDecision(Infinity, 1.5).allowed).toBe(true);
  });
});

describe('maxSafeBorrowBase', () => {
  it('inverts HF=floor: collateral*threshold/floor - debt', () => {
    // 1000*0.8/1.5 - 0 = 533.33
    expect(maxSafeBorrowBase(1000, 0, 0.8, 1.5)).toBeCloseTo(533.333, 2);
  });

  it('subtracts existing debt', () => {
    // 1000*0.8/1.5 - 100 = 433.33
    expect(maxSafeBorrowBase(1000, 100, 0.8, 1.5)).toBeCloseTo(433.333, 2);
  });

  it('never goes negative (already over-levered)', () => {
    expect(maxSafeBorrowBase(1000, 900, 0.8, 1.5)).toBe(0);
  });

  it('a borrow of exactly maxSafeBorrow lands at the floor', () => {
    const maxB = maxSafeBorrowBase(1000, 0, 0.8, 1.5);
    const hf = projectedHealthFactor({
      totalCollateralBase: 1000,
      totalDebtBase: 0,
      liquidationThreshold: 0.8,
      newBorrowBase: maxB,
    });
    expect(hf).toBeCloseTo(1.5, 6);
  });

  it('returns 0 for a non-positive floor', () => {
    expect(maxSafeBorrowBase(1000, 0, 0.8, 0)).toBe(0);
  });
});

describe('sizeSwapAmount', () => {
  it('does not clamp when the request is within the sized budget', () => {
    const { recommended, clamped } = sizeSwapAmount(
      10,
      0.5,
      { realizedVol: 0.25, source: 'provided' }, // volF=2.0 capped 0.25 -> budget 2.5 ETH
      { ...CFG, targetVol: 0.5, maxWalletPct: 0.25 }
    );
    expect(clamped).toBe(false);
    expect(recommended).toBe(0.5);
  });

  it('clamps a request that exceeds the sized budget', () => {
    const { recommended, clamped } = sizeSwapAmount(
      10,
      5, // request 5 ETH
      { realizedVol: 2.0, source: 'provided' }, // volF=0.25 capped -> budget 2.5 ETH
      { ...CFG, targetVol: 0.5, maxWalletPct: 0.5 }
    );
    expect(clamped).toBe(true);
    expect(recommended).toBeCloseTo(2.5, 12);
  });
});

describe('loadRiskConfig', () => {
  it('uses defaults with no overrides', () => {
    const c = loadRiskConfig(undefined);
    expect(c.hfFloor).toBe(1.5);
    expect(c.enforce).toBe(true);
  });

  it('applies runtime.getSetting overrides and parses booleans', () => {
    const runtime = {
      getSetting: (k: string) =>
        ({ RISK_HF_FLOOR: '2.0', RISK_ENFORCE: '0', RISK_MAX_WALLET_PCT: '0.1' } as any)[k],
    };
    const c = loadRiskConfig(runtime);
    expect(c.hfFloor).toBe(2.0);
    expect(c.enforce).toBe(false);
    expect(c.maxWalletPct).toBe(0.1);
  });
});
