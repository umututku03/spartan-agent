# Phase 4.2 — Agent-integrated risk layer — VERIFIED on the VM

**Status: ✅ complete.** The deterministic risk core from Phase 4 is now **native to the Spartan
agent**: a shared `RiskService` is the single source of truth, an always-on provider injects the
user's risk budget into every turn (so the agent is proactively risk-aware and self-limits), a
read-only `RISK_ASSESS` action answers "how much can I safely swap/borrow?", and the swap/borrow
guards are routed through the service. All verified live against the Docker-anvil fork.

This closes the Phase-4 honesty gap (docs/PHASE4_RISK.md §4): risk is no longer buried in the action
handlers and gated behind LLM action-selection — it is in the agent's context unconditionally, and
the guards remain the hard backstop.

---

## 1. What was added

| Piece | File | Role |
|---|---|---|
| `RiskService` | `src/plugins/multiwallet/services/srv_risk.ts` | Single source of truth. `getRegime` (5-min cached), `assessSwap`, `assessBorrow`, `getConfig`. Wraps the pure risk core + `ethereum.ts` reads. `serviceType = AUTONOMOUS_TRADER_RISK`. |
| `riskProvider` | `src/plugins/multiwallet/providers/risk.ts` | `RISK_GOVERNANCE`, **non-dynamic** (every turn). Injects the regime, vol-targeted max swap, and Aave borrow headroom + explicit "Do NOT propose…" guidance. Returns empty unless the author's own verified ETH wallet resolves. |
| `RISK_ASSESS` action | `src/plugins/multiwallet/actions/act_risk_assess.ts` | Read-only advisory ("how much can I safely swap/borrow?"). No execution. |
| `maxSafeBorrowBase` | `src/plugins/multiwallet/risk/sizing.ts` | Pure helper: invert `HF = floor` → max additional borrow. Unit-tested. |
| Guards routed via service | `act_wallet_swap.ts`, `act_wallet_lending.ts` | Swap clamps to `assessSwap.recommended` (also corrects absurd LLM amounts — the budget never exceeds spendable); borrow refuses via `assessBorrow.allowed`. |

Registered in `src/plugins/multiwallet/index.ts` (`providers`, `actions`, `services`).

## 2. Evidence (live, on the fork, with the Phase-3 verified wallet)

### 2a. Proactive awareness — provider injects on EVERY turn
A casual "gm" message; the composed context contained:
```
# Risk governance (deterministic) for wallet 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Swap sizing: ETH: realized vol ~39%/yr (live); vol-targeted max ≈ 2499.974706 ETH (25.0% of 9999.8988, bound by wallet-cap).
-> Do NOT propose an ETH swap larger than ~2499.974706 ETH right now.
Borrow headroom: Collateral $187.63, debt $0.00, HF ∞; safe additional borrow ≈ $97.57 (floor 1.5).
-> Do NOT propose borrowing more than ~$97.57; borrows below the HF floor are refused deterministically.
```
The agent sees this regardless of what the user says, so its replies are risk-aware and it self-limits.

### 2b. On-demand advisory — `RISK_ASSESS` fired from chat
"How much ETH can I safely swap, and how much can I borrow on Aave right now?" →
```
Risk assessment for 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Policy: target vol 50%/yr · wallet cap 25% · Aave HF floor 1.5 · enforcement ON
• Max ETH swap now: ~2499.974706 ETH — realized vol ~39%/yr (live), bound by wallet-cap.
• Aave: Collateral $187.63, debt $0.00, HF ∞; safe additional borrow ≈ $97.57 (floor 1.5).
```
`$97.57` = `maxSafeBorrowBase(187.63, 0, 0.78, 1.5)` — deterministic, matches the unit-tested math.

### 2c. Unit tests
```
$ bun test src/plugins/multiwallet/risk
 30 pass  0 fail
```
(25 from Phase 4 + 5 new for `maxSafeBorrowBase`, incl. "a borrow of exactly maxSafeBorrow lands at
the floor".)

## 3. Why this is more reliable than Phase 4's in-handler guards
- The **provider is unconditional** — no dependency on the LLM selecting an action, so risk context
  is always present. Even when the model just chats, it has the budget and the "Do NOT propose…" lines.
- The **swap guard clamps to the sized budget**, which never exceeds the spendable balance — so a
  mis-extracted amount (the Phase-3/4 "9999 ETH") is deterministically corrected before execution.
- The **borrow guard refuses** below the floor; `RISK_ASSESS` and the provider tell the user the safe
  amount up front, reducing the chance of proposing a doomed borrow at all.
- LLM action-selection non-determinism still exists for the *execution* actions, but the risk layer no
  longer depends on it for *awareness*.

## 4. Config & reproduce
Env / `runtime.getSetting`: `RISK_TARGET_VOL`, `RISK_MAX_WALLET_PCT`, `RISK_KELLY_FRACTION`,
`RISK_HF_FLOOR`, `RISK_ENFORCE` (1=enforce, 0=advisory), `RISK_VOL_FALLBACK`.
```bash
bun test src/plugins/multiwallet/risk               # 30/30
bun run scripts/demo-risk.ts                        # deterministic sizing + HF floor
ETHEREUM_RPC_URL=http://127.0.0.1:8545 bun run scripts/verify-hf-guard.ts   # guard vs real Aave state
# live: boot the agent, ask "how much can I safely swap/borrow?" -> RISK_ASSESS;
#       any turn's context carries the RISK_GOVERNANCE briefing.
```

## 5. Out of scope (future / Decision 7)
Full regime-switching posture (confirmation-gate/deny in high-vol/bear), LLM-driven regime
classification, CoinGlass/DefiLlama/FRED regime inputs, CoW-Protocol MEV-protected execution, the
hierarchical multi-agent decision layer. A price oracle would generalize the borrow base-value beyond
the current ~$1/token (stablecoin-accurate) approximation.
