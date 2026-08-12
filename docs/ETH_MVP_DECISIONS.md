# Ethereum DeFi MVP — Decision Log & Rationale

This document records **every significant decision** made while turning this repo's Ethereum work
into a runnable, verified MVP, and **why** each choice was made. It is the companion to the
hands-on [`ETH_MVP_SETUP.md`](./ETH_MVP_SETUP.md) runbook.

Project context: this is the ElizaOS **Spartan** trading agent, adapted into an Ethereum-focused
DeFi MVP for a school project. The guiding milestone is *"implement the agent on Ethereum —
start with basic AMM swaps, then add lending/borrowing."* Target pipeline: wallet import →
wallet detection in chat → ETH transfers → AMM swaps → Aave supply/borrow.

---

## Starting point (what we found)

Before any changes, an exploration of the repo established:

- The Ethereum logic was **already implemented** (commit `9fe396f`) and is good quality:
  - `src/plugins/multiwallet/utils/ethereum.ts` — viem-based core: Uniswap V2 swaps (with
    path building, automatic allowance, slippage), native + ERC-20 transfers, Aave V3
    supply/borrow, plus pure helpers for key/address detection and normalization.
  - Wired into actions (`act_wallet_import`, `act_wallet_swap`, `act_wallet_xfer`,
    `act_wallet_lending`), providers (`multiwallet`, `wallet`), and chain-agnostic address
    detection (`autonomous-trader/utils`).
- **But the project had never been made runnable in this checkout** and nothing was verified:
  no `node_modules`/lockfile, `workspace:*` deps that only resolve in the monorepo, scripts
  pointing at a non-existent `../cli`, `viem` undeclared, no `.env(.example)`, mainnet
  addresses hardcoded.

**Conclusion that shaped everything:** the work was *environment + verification + light
hardening*, **not** rewriting DeFi logic. We deliberately avoided touching the working
`ethereum.ts` swap/transfer/lending code.

---

## Decision 1 — Run/dev path: **eliza monorepo** (not standalone)

**Decision.** Run and develop inside the ElizaOS monorepo: place this repo at
`eliza/packages/spartan`, `bun install` from the root, run `elizaos dev`.

**Why.**
- `package.json` is a verbatim copy of `packages/spartan`: it uses `workspace:*` for
  `@elizaos/core`, `@elizaos/cli`, `@elizaos/plugin-evm`, `@elizaos/plugin-solana`, etc. The
  `workspace:` protocol only resolves inside the workspace — a standalone `npm install` fails.
- Scripts already assume it: `"start": "bun ../cli/dist/index.js start"`, nodemon watches
  `../core/dist`.
- It's the officially documented path (README "Option 2: Development from Monorepo") and gives
  hot-reload against core during development.

**Alternative considered — standalone `@elizaos/cli`.** Rejected as the default because it
requires rewriting every `workspace:*` specifier to a published version and keeping them in sync
with the bleeding-edge core the agent depends on — more setup and more breakage. Kept documented
as a fallback only.

**Tradeoff accepted.** Heavier initial setup (clone a large monorepo) in exchange for a reliable,
supported, reproducible environment.

---

## Decision 2 — Test network: **local mainnet fork via Anvil** (not Sepolia, not real mainnet)

**Decision.** Verify all on-chain flows against `anvil --fork-url <mainnet RPC>`.

**Why.**
- The code hardcodes **mainnet** contract addresses (Uniswap V2 router, WETH, USDC/USDT/DAI,
  Aave V3 Pool) and uses viem's `mainnet` chain object everywhere. A fork keeps **all of that
  working unchanged** — Anvil's chain id is 1 and it mirrors real mainnet state/liquidity.
- **Zero real money.** Anvil provides pre-funded dev accounts; gas is free.
- **Real liquidity & contracts.** Unlike a clean testnet, the fork has true Uniswap pools and
  Aave markets, so swaps and lending behave realistically.
- **No code changes required** to test — the only knob is `ETHEREUM_RPC_URL` pointing at the fork.

**Alternatives considered.**
- *Sepolia testnet.* Rejected for the MVP: Uniswap V2 liquidity is thin/absent and Aave's
  addresses differ, so it would force adding per-network chain + address configuration to
  `ethereum.ts` — scope creep that the constant-product/lending demo doesn't need.
- *Real mainnet with small funds.* Rejected: costs real ETH + gas on every test run and risks
  fat-finger losses, with no upside over a fork for verification.

**Tradeoff accepted.** A fork doesn't exercise public-testnet networking or a persistent
explorer, but for verifying agent → contract correctness it's strictly better, safer, and free.

---

## Decision 3 — Wallet creation: **import-only for the MVP**

**Decision.** Support importing an existing Ethereum private key (already implemented); do **not**
add new-keypair generation in the core MVP.

**Why.**
- It matches the README MVP scope, which lists only *"Ethereum wallet import."*
- `act_wallet_import.ts` already detects 64-hex keys, derives the address, and stores them under
  `metawallet.keypairs.ethereum` — stage 1 of the pipeline is done.
- Testing uses Anvil's pre-funded throwaway keys, which are *imported*, so generation isn't on
  the critical path.

**Noted as optional.** Generation is a cheap (~15-line) add later using viem's
`generatePrivateKey()` + the existing `privateKeyToEthereumAddress()` export, storing the keypair
exactly as the import action does. Left out to keep MVP scope tight.

---

## Decision 4 — Declare `viem` explicitly (the one code/config hardening edit)

**Decision.** Add `viem` (`^2.21.0`, the v2 line `@elizaos/plugin-evm` resolves) to
`package.json` dependencies.

**Why.** `ethereum.ts` imports `viem`, `viem/accounts`, and `viem/chains` directly, but `viem`
was not a declared dependency — it only worked by riding in transitively through
`@elizaos/plugin-evm`. That is fragile: if plugin-evm's tree changes or is bumped, the import
could break or silently resolve to a mismatched version. Declaring it makes the dependency
explicit and lets the workspace dedupe to a single viem instance.

**Why this is the *only* code-adjacent change.** Everything else (RPC selection, chain object,
addresses) already worked for the fork strategy, so we changed nothing in the DeFi logic to avoid
regressions in code that was verified to be correct by reading.

---

## Decision 5 — Verification strategy: **pure-unit tests + fork-based e2e runbook**

**Decision.** Two layers:
1. Offline **vitest unit tests** for the pure, network-free helpers in `ethereum.ts`
   (`detectEthereumPrivateKeysFromText`, `detectEthereumAddressesFromText`,
   `normalizeEthereumPrivateKey`, `privateKeyToEthereumAddress`, `isEthereumAddress`,
   `buildPath`).
2. A documented **end-to-end runbook** on the Anvil fork covering all five stages
   (import → detect → transfer → swap → supply → borrow).

**Why.**
- The pure helpers are deterministic and high-value (key parsing/validation is where a subtle
  regex/normalization bug would silently break wallet import) — fast tests guard them with no RPC.
- The on-chain functions can only be *truly* validated against real contracts; the fork runbook
  does that without mocking away the parts that matter, and yields real tx hashes as evidence.
- We did **not** write mocked unit tests for the swap/lending RPC paths: mocking viem clients
  would mostly test the mocks, not the Uniswap/Aave integration. The fork is the honest test.

**Ordering constraints baked into the runbook (learned from the code):**
- *Swap before supply* — Aave needs a real ERC-20 balance; ETH is aliased to WETH but the wallet
  must hold the token, so acquire USDC via swap first.
- *Supply before borrow* — borrowing with no collateral reverts.

---

## Decision 6 — Underlying model (milestone 5): benchmark, don't hard-commit

**Decision.** Keep the model a config knob and run milestone 5 as a real A/B test: benchmark
**Grok-4** (CryptoBench's agentic winner), **Claude Sonnet 4.5** (the portfolio-MAS paper's best
mean return), and a **GPT** baseline, on our *own* execution-weighted task mix. Default to whichever
wins our tasks rather than any single external leaderboard.

**Two papers inform this — and they disagree, which is itself the finding.**

1. **CryptoBench** — Guo et al., *A Dynamic Benchmark for Expert-Level Evaluation of LLM Agents in
   Cryptocurrency*, arXiv:2512.00417 (https://arxiv.org/abs/2512.00417,
   html: https://arxiv.org/html/2512.00417v5).
   - *What it is / why it stands out:* a **live, expert-curated, contamination-resistant** benchmark
     of real crypto-analysis tasks, scored on a four-quadrant grid (Simple/Complex ×
     Retrieval/Prediction). It evaluates models both directly and inside an **agentic framework**.
   - *Headline:* a stark **retrieval–prediction imbalance** — models retrieve facts well but nearly
     fail at prediction (best Complex-Prediction ≈ 18.6%). Rankings shift between direct and agentic
     settings; "raw model capability does not directly translate into effective agentic execution."
   - *Result for us (agentic table):* **Grok-4 leads every quadrant** (42.3 / 32.1 / 22.4 / 18.6),
     Grok-4 Fast 2nd, Qwen3-Max 3rd; Claude (Opus 4.1 / Sonnet 4.5) mid-pack; GPT-5 retrieval-strong
     but prediction-weak.
   - *How we use it:* it's the right proxy for the **analysis/advisory** side of the agent (regime
     reads, token research). Its core lesson — keep a human in the loop for predictions, don't let
     the agent present forecasts as confident — is a hard requirement for any advisory feature.

2. **LLM-Powered Multi-Agent System for Automated Crypto Portfolio Management** — Luo et al.,
   arXiv:2501.00826 (https://arxiv.org/abs/2501.00826, html: https://arxiv.org/html/2501.00826v3).
   - *What it is / why it stands out:* an actual **backtested trading system** (52 weeks of 2025,
     top-15 L1s) with three modality-specialised agents — **Crypto** (market), **News** (sentiment),
     **Trading** (supervisor) — across 3 architectures (hierarchical / collaborative / debate) × 4
     capabilities (zero-shot / CoT / RAG / skill). Fully **traceable** ReAct reasoning; open-sourced.
   - *Headline:* **multi-agent decomposition beats single-agent decisively and model-agnostically.*
     Single-agent variants all lost money; the best MAS config (Hierarchical-Skill) returned
     **+133.5% at Sharpe 1.50**, beating deep-learning and passive baselines. Ablation: the **Crypto
     Agent is the alpha driver** (−42.6pp without it), **memory** adds continuity (−11.5pp without),
     **News acts as a risk damper** (removing it barely changes return but raises volatility ~6.8pp).
   - *Result for us (cross-model):* **Claude Sonnet 4.5 has the highest mean return** (+33% across 16
     configs); GPT-4o holds the single best config; GPT-5 is most conservative (low return, low vol).
     Grok was not tested.
   - *How we use it:* it's the evidence-backed blueprint for our **decision layer** (see Decision 7),
     and it maps onto our existing plugins (analytics ≈ Crypto, degenIntel ≈ News, trading ≈ Trading).

**Reconciliation / why "benchmark, don't hard-commit":** the two papers crown different models
(Grok-4 vs Claude Sonnet 4.5) because they measure different things (analysis-QA vs portfolio
backtest) under different harnesses. Model ranking is **task- and architecture-dependent**, so the
only honest choice is to A/B on our own workload. Also note our current MVP is **execution-shaped**
(parse "swap X to Y" → call a tool), where essentially all frontier models — including the
Anthropic/OpenAI models already wired in — perform reliably; model choice only becomes decisive once
we add the analysis/decision layer.

**Eliza wiring note.** The repo loads `@elizaos/plugin-anthropic` + `@elizaos/plugin-openai`.
Grok (xAI) is reachable via **`@elizaos/plugin-openrouter`** (currently commented out in
`src/index.ts`) — which is how CryptoBench accessed these models. Enabling it + setting the model
env var is the low-effort path to A/B testing Grok-4 / Claude Sonnet 4.5 / GPT side by side.

---

## Decision 7 — Decision-layer architecture & risk governance (future)

This captures *where the agent goes after the execution MVP*. Not in MVP scope, but recorded now so
the direction is explicit and evidence-linked.

**The gap we're targeting.** Most crypto AI agents are either **signal generators** (what to trade)
or **execution bots** (how to trade). The missing piece is **risk governance — how much to risk
given current conditions.** An agent that's right on direction but 3× oversized during a volatility
spike still loses money. That sizing-relative-to-regime layer is the part most projects skip, and
it's where we should differentiate.

**Why this is the right bet (statistical + empirical).**
- *Statistical:* returns are nearly unforecastable, but **volatility is forecastable** (it clusters
  and is autocorrelated). Sizing-on-regime leans on the predictable quantity (vol) instead of the
  unpredictable one (direction) — which is also why CryptoBench shows prediction is the weak axis.
- *Empirical (the MAS paper):* it shows risk governance in the data — skill/momentum tops bull
  (+277–291%) but blows up in bear (−47%); CoT improves capital preservation (best bear MDD −4.4%);
  News functions as a risk damper. The unsolved problem there is **regime switching**: the best
  full-period, best-bull, and best-bear configs are three *different* configs, and the paper can't
  pick ex ante. That regime-aware switch is exactly the governance layer we'd build.

**Proposed design (post-MVP).**
- *Decision layer:* adopt the **hierarchical multi-agent** pattern (Crypto + News → supervisory
  Trading agent) on our Eliza stack, with rolling memory and traceable ReAct reasoning. It's the
  best risk-adjusted performer in the paper and fits Eliza's provider→action model.
- *Risk governance (deterministic, not LLM-delegated):* hard position caps as % of wallet;
  **volatility-scaled sizing** (target position-vol); regime-aware conservatism (lean
  CoT/RAG-style caution in high-vol/bear, momentum in low-vol/bull). Keep the LLM out of the
  multiply-by-size step.
- *Analysis data sources for regime reads:* **CoinGlass** (derivatives — funding, OI, CVD,
  liquidations), **DefiLlama** (on-chain / TVL), **FRED** (macro). Gate on **freshness** — a regime
  read on stale funding/vol is worse than none (a top CryptoBench failure mode was stale data).
- *Execution upgrade:* **CoW Protocol** for Ethereum (batch auctions, solver competition,
  **MEV protection**, better fills than hitting the Uniswap router for larger orders). Note it's an
  **intent/async** model — a real rebuild of our current synchronous Uniswap-V2 swap path, justified
  at size, not for tiny MVP/fork demos.
- *Lending-side governance now-ish:* an **Aave health-factor floor on borrow** is the lending
  instance of "don't get oversized" — refuse to borrow below a target HF (e.g. 1.5). This is small,
  deterministic, and arguably should move from "out of scope" into near-term work.

**IMPLEMENTED (Phase 4, 2026-08-12).** The deterministic risk-governance CORE now exists in
`src/plugins/multiwallet/risk/`: volatility-targeting + fractional-Kelly + hard wallet cap sizing, and
an Aave health-factor floor on borrow (default 1.5). Pure math, 25 passing unit tests, a
regime-responsive demo (`scripts/demo-risk.ts`), and a live check against real fork Aave state
(`scripts/verify-hf-guard.ts`). Wired as pre-execution guards in the swap (`sizeSwap`) and borrow
(`guardBorrow`) action paths. Full details + honest caveats: `docs/PHASE4_RISK.md`. Still future: the
LLM/regime decision layer, CoinGlass/DefiLlama/FRED inputs, and CoW-Protocol execution.

**AGENT-INTEGRATED (Phase 4.2, 2026-08-12).** The risk layer is now native to the agent: a shared
`RiskService` (single source of truth, cached regime), an always-on `RISK_GOVERNANCE` provider that
injects the user's risk budget + "do not propose…" guidance into every turn (proactive awareness, not
gated by LLM action-selection), and a read-only `RISK_ASSESS` advisory action. The swap/borrow guards
route through the service; the swap clamp deterministically corrects absurd LLM-extracted amounts.
30/30 unit tests; verified live on the fork. Details: `docs/PHASE4_2_AGENT_RISK.md`.

---

## Explicitly out of scope (future work)

| Item | Why deferred |
|------|--------------|
| Sepolia / multi-network support | Needs parameterized chain object + per-network address tables in `ethereum.ts`; not needed to demo AMM + lending |
| Aave withdraw / repay, health-factor & position queries | README MVP lists only `supply`/`borrow`; round-trip and risk views are a later milestone |
| Uniswap V3 (concentrated liquidity) | Current code is V2 (constant product); V3 is a separate, larger integration |
| ETH wallet generation | Optional convenience; import covers the MVP (see Decision 3) |

---

## Summary

The Ethereum DeFi logic was already written and sound. The MVP work was to make it **runnable
and provably working**: pin the environment to the monorepo, declare `viem`, document and wire
the RPC/env, and verify every stage safely on a mainnet fork — while deliberately leaving the
verified DeFi code untouched.
