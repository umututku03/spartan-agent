/**
 * Risk-layer configuration: sane defaults, overridable via env vars or runtime.getSetting.
 * Keeping sizing parameters as config (not code constants) is what lets the same deterministic
 * engine express different risk appetites without touching the math.
 */
import type { RiskConfig } from './types';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  targetVol: 0.5, // 50%/yr - a moderate crypto target-vol
  maxWalletPct: 0.25, // never risk more than 25% of the wallet in one position
  kellyFraction: 0.5, // half-Kelly (standard prudent shrinkage)
  hfFloor: 1.5, // refuse borrows that would push Aave HF below 1.5 (Decision 7)
  enforce: true, // borrow refuses / swaps clamp by default; RISK_ENFORCE=0 loosens
  volFallback: 0.8, // assume elevated vol when live data is unavailable (conservative)
};

type SettingGetter = { getSetting?: (key: string) => string | undefined } | undefined;

function readSetting(runtime: SettingGetter, key: string): string | undefined {
  const fromRuntime = runtime?.getSetting?.(key);
  if (fromRuntime !== undefined && fromRuntime !== null && fromRuntime !== '') return fromRuntime;
  const fromEnv = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  return fromEnv;
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return !(v === '0' || v.toLowerCase() === 'false' || v.toLowerCase() === 'no');
}

/** Build the effective RiskConfig from defaults + env/runtime overrides. */
export function loadRiskConfig(runtime?: SettingGetter): RiskConfig {
  const d = DEFAULT_RISK_CONFIG;
  return {
    targetVol: num(readSetting(runtime, 'RISK_TARGET_VOL'), d.targetVol),
    maxWalletPct: num(readSetting(runtime, 'RISK_MAX_WALLET_PCT'), d.maxWalletPct),
    kellyFraction: num(readSetting(runtime, 'RISK_KELLY_FRACTION'), d.kellyFraction),
    hfFloor: num(readSetting(runtime, 'RISK_HF_FLOOR'), d.hfFloor),
    enforce: bool(readSetting(runtime, 'RISK_ENFORCE'), d.enforce),
    volFallback: num(readSetting(runtime, 'RISK_VOL_FALLBACK'), d.volFallback),
  };
}
