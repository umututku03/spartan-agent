/**
 * Deterministic demo of the regime-aware position-sizing layer (Phase 4 novelty).
 * Pure math, no network, no funds - fully reproducible.
 *
 *   bun run scripts/demo-risk.ts
 *
 * Shows (1) the swap size shrinking as realized volatility rises (leaning on the FORECASTABLE
 * quantity), which constraint binds, and (2) the Aave health-factor floor allowing a safe borrow
 * and refusing an over-leveraged one.
 */
import {
  computePositionSize,
  realizedVolatility,
  projectedHealthFactor,
  healthFactorFloorDecision,
} from '../src/plugins/multiwallet/risk/sizing';
import { DEFAULT_RISK_CONFIG } from '../src/plugins/multiwallet/risk/config';

// Use a high wallet cap here so the VOLATILITY-TARGETING behaviour is the visible story; the hard
// cap (25% in DEFAULT_RISK_CONFIG) still sits underneath as a concentration ceiling (shown after).
const cfg = { ...DEFAULT_RISK_CONFIG, maxWalletPct: 1.0, targetVol: 0.5 };
const WALLET_ETH = 10;

console.log('Risk config:', JSON.stringify(cfg));
console.log(`\n[1] Vol-targeted sizing of a swap - wallet = ${WALLET_ETH} ETH, target vol = ${cfg.targetVol}, cap = ${cfg.maxWalletPct}`);
console.log('    realizedVol   fraction     sizeETH   boundedBy');
for (const vol of [0.15, 0.3, 0.5, 1.0, 2.0, 4.0]) {
  const r = computePositionSize({ walletValue: WALLET_ETH, regime: { realizedVol: vol, source: 'provided' }, config: cfg });
  console.log(
    `    ${vol.toFixed(2).padStart(9)}   ${r.fraction.toFixed(4).padStart(8)}   ${r.size.toFixed(4).padStart(8)}   ${r.boundedBy}`
  );
}
console.log('    -> as regime vol rises, the position shrinks ~1/vol (size = targetVol/vol * wallet),');
console.log('       until the low-vol regime is clamped by the wallet cap.');

// The production default cap (25%) as a hard ceiling, regardless of how calm the regime looks:
const capped = computePositionSize({
  walletValue: WALLET_ETH,
  regime: { realizedVol: 0.1, source: 'provided' },
  config: { ...DEFAULT_RISK_CONFIG, targetVol: 0.5 }, // maxWalletPct = 0.25
});
console.log(`    (with the default 25% cap, even a calm regime is limited to ${capped.size} ETH - boundedBy ${capped.boundedBy}.)`);

console.log('\n[2] Realized vol is computed from a price series (pure, unit-tested):');
const calm = [100, 101, 100.5, 101.2, 100.8, 101.5, 101.0];
const wild = [100, 118, 92, 130, 85, 140, 78];
console.log(`    calm series  -> annualized realized vol = ${(realizedVolatility(calm) * 100).toFixed(1)}%`);
console.log(`    wild series  -> annualized realized vol = ${(realizedVolatility(wild) * 100).toFixed(1)}%`);

console.log(`\n[3] Aave health-factor floor on borrow (floor = ${cfg.hfFloor}) - base units are USD:`);
const collateral = 1000; // $1000 supplied
const liqThreshold = 0.8; // 80% (USDC-like)
for (const borrow of [100, 300, 500, 700]) {
  const hf = projectedHealthFactor({
    totalCollateralBase: collateral,
    totalDebtBase: 0,
    liquidationThreshold: liqThreshold,
    newBorrowBase: borrow,
  });
  const d = healthFactorFloorDecision(hf, cfg.hfFloor);
  console.log(
    `    borrow $${String(borrow).padStart(4)}  -> projected HF ${hf.toFixed(3)}  ${d.allowed ? 'ALLOWED' : 'REFUSED'}`
  );
}
console.log('    -> borrows that would push HF below the floor are deterministically refused.');
