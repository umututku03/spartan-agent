# Phase 4 — Deterministic, regime-aware risk-governance layer (the project's novelty)

**Status: ✅ complete.** A new deterministic position-sizing layer sits between signal and execution
and answers the question most crypto agents skip: **how much to risk given the regime.** The LLM is
never in the multiply-by-size step. 30 unit tests pass, a deterministic demo shows regime-responsive
sizing, and the borrow guard is verified refusing an over-leverage against **real on-chain Aave state**
on the fork.

Grounding: arXiv:2512.00417 (CryptoBench — prediction is the weak axis, so size on the *forecastable*
quantity, volatility) and arXiv:2501.00826 (LLM-MAS — omits the slippage/regime realism we add). See
docs/ETH_MVP_DECISIONS.md Decision 7.

---

## 1. The module — `src/plugins/multiwallet/risk/` (pure, deterministic)

| File | What it holds |
|---|---|
| `types.ts` | `RiskConfig`, `RegimeSignal`, `SizingResult`, `HealthFactorDecision`. |
| `config.ts` | Defaults + env/`runtime.getSetting` overrides (`RISK_TARGET_VOL`, `RISK_MAX_WALLET_PCT`, `RISK_KELLY_FRACTION`, `RISK_HF_FLOOR`, `RISK_ENFORCE`, `RISK_VOL_FALLBACK`). |
| `sizing.ts` | The pure math (below). |
| `regime.ts` | Free, keyless CoinGecko price fetch → realized vol, with graceful fallback. CoinGlass/DefiLlama/FRED noted as future inputs. |
| `index.ts` | `sizeSwap(...)` and `guardBorrow(...)` — the two pre-execution guard entry points. |

**The size is the MINIMUM of three independent constraints** (most conservative wins):
1. **Volatility target:** `f = σ_target / σ_realized` — lean on forecastable vol, not direction.
2. **Fractional-Kelly:** `f = λ · μ / σ²` — growth-optimal, shrunk by λ (half-Kelly default).
3. **Wallet cap:** `f ≤ maxWalletPct` — hard concentration limit.

**Borrow health-factor floor:** `HF = (Σ collateral · liqThreshold) / (debt + newBorrow)`; a borrow
that would push the projected HF below `RISK_HF_FLOOR` (default 1.5) is refused.

## 2. Evidence

### 2a. Unit tests (offline, deterministic) — `src/plugins/multiwallet/risk/__tests__/sizing.test.ts`
```
$ bun test src/plugins/multiwallet/risk
 30 pass  0 fail   Ran 30 tests
```
Cover: realized-vol from a price series; `volTargetFraction` monotonically decreasing in realized vol
and capped; fractional-Kelly bounds/λ scaling; `computePositionSize` picks the binding constraint and
never exceeds the hard cap; `projectedHealthFactor` + floor allow/deny; config env overrides.

### 2b. Regime-responsive sizing demo — `scripts/demo-risk.ts`
```
$ bun run scripts/demo-risk.ts
[1] Vol-targeted sizing — wallet = 10 ETH, target vol = 0.5, cap = 1
    realizedVol   fraction     sizeETH   boundedBy
         0.50     1.0000    10.0000   wallet-cap
         1.00     0.5000     5.0000   volatility-target
         2.00     0.2500     2.5000   volatility-target
         4.00     0.1250     1.2500   volatility-target
    -> as regime vol rises the position shrinks ~1/vol; calm regimes clamp at the wallet cap.
[3] Aave HF floor (1.5):  borrow $100 -> HF 8.000 ✅ ;  borrow $700 -> HF 1.143 ⛔ REFUSED
```

### 2c. Borrow guard vs REAL on-chain Aave state — `scripts/verify-hf-guard.ts` (on the fork)
```
$ ETHEREUM_RPC_URL=http://127.0.0.1:8545 bun run scripts/verify-hf-guard.ts 0xf39Fd6…2266
Live Aave account data (fork): collateral $187.63, debt $0.00, liqThreshold 78.0%, HF ∞
  borrow $ 20 -> ✅ ALLOWED  (projected health factor 7.318 ≥ floor 1.50)
  borrow $ 50 -> ✅ ALLOWED  (projected health factor 2.927 ≥ floor 1.50)
  borrow $300 -> ⛔ REFUSED  (projected health factor 0.488 < floor 1.50 — borrow refused …)
```
This reads the wallet's **actual** `getUserAccountData` from the fork (the USDC supplied in Phase 3)
and refuses the over-leverage — the guard's real integration point, decoupled from the LLM.

## 3. Wiring (pre-execution guards)
- `ethereum.ts` (read-only additions): `getUserAccountData` added to `AAVE_V3_POOL_ABI`; new exports
  `getAaveUserAccountData()` and `getEthereumTokenBalance()`. **No existing write function changed.**
- `act_wallet_swap.ts` (Ethereum branch): before `swapEthereumExactIn`, reads the spendable input
  balance, calls `sizeSwap(...)`, clamps the amount when enforcing, and appends a `🛡️ Risk layer:` note
  to the chat reply.
- `act_wallet_lending.ts` (borrow branch): before `executeEthereumLendingAction`, reads Aave account
  data and **refuses** the borrow when the projected HF is below the floor.

## 4. Honest caveats
- **Enforcement defaults (per design):** borrow **refuses** below the HF floor; swaps **clamp + warn**;
  `RISK_ENFORCE=0` makes both advisory. Configurable via the `RISK_*` env vars.
- **In-chat live enforcement is bounded by LLM parameter extraction.** As in Phase 3, gpt-4o
  sometimes mis-extracts the amount/token (e.g. it emitted `USDC/100` or `ETH/9999` for a
  "borrow 200 DAI" request), so a clean end-to-end chat demo of the guard blocking is unreliable.
  The guard **logic** is proven deterministically (§2a/§2b) and **against real chain state** (§2c);
  the fork-based verifier is the reliable evidence. Tightening the in-chat path (constrained extraction,
  surfacing the sizing to the user, regime reads) is **Phase 4.2 (agent-integrated)**.
- **HF base-value approximation:** the borrow guard estimates the new debt's USD base as
  `amount × $1` — exact for the stablecoin borrows in scope (USDC/USDT/DAI); a price oracle would
  generalize it (future).

## 5. Reproduce
```bash
bun test src/plugins/multiwallet/risk        # 30/30
bun run scripts/demo-risk.ts                 # regime-responsive sizing + HF floor
ETHEREUM_RPC_URL=http://127.0.0.1:8545 bun run scripts/verify-hf-guard.ts   # guard vs real Aave state
```
