# Handoff: Ethereum Spartan agent

This document is written for a new developer (and a fresh AI assistant) picking up this repository
cold. It maps the codebase, separates the work done here (an Ethereum DeFi agent) from the upstream
ElizaOS "Spartan" fork it sits inside, tells you exactly what boots and what is illustrative, and
lists which files matter and which do not. Every claim below was checked against the code on branch
`step2-llm-benchmark`.

Read these first, in order, then come back here:
- `docs/WORKBOOK.md` - the full logbook (origins, decisions, what broke, what was left for later).
- `docs/SETUP_FROM_SCRATCH.md` - the reproducible run recipe (this is the source of truth for booting).
- `docs/ETH_MVP_DECISIONS.md` - the decision log with rationale.
- `docs/VERIFICATION.md` - the evidence that the on-chain layer works (real tx hashes).

---

## 1. What this project is, and current status

The upstream repository is a fork of the ElizaOS "Spartan" monorepo package, a Solana DeFi agent.
The work in this fork is an Ethereum DeFi MVP layered on top of it, plus an evaluation and a paper.

What was built here:
- Ethereum wallet import and in-chat detection, ETH transfers, Uniswap V2 swaps, and Aave V3
  supply/borrow, all via `viem` against Ethereum mainnet (or a local Anvil mainnet fork).
- A deterministic risk-governance (position-sizing) layer: volatility targeting with a wallet cap
  and a fractional-Kelly arm for swaps, and an Aave health-factor floor for borrows. The math is
  pure and unit-tested; the LLM is never in the multiply-by-size step.
- An LLM-in-the-loop benchmark, an external-benchmark comparison (InvestorBench ETH task), an
  agent-in-the-loop proof of concept, a whitepaper (`paper/main.pdf`), and a timed demo.

Status (honest framing, mirrored from the docs):
- The Ethereum execution layer is verified end to end on real contracts on a mainnet fork
  (transfer, Uniswap V2 swap, Aave V3 supply, Aave V3 borrow, with real tx hashes captured in
  `docs/VERIFICATION.md`). It also runs read-only against live mainnet.
- The agent boots on the ElizaOS monorepo, serves the web chat UI, understands wallet commands, and
  can fire the wallet actions from chat (Phases 2 and 3). Action selection by the LLM is
  non-deterministic; sometimes a command must be re-sent (see gotchas).
- The risk layer is verified by unit tests and deterministic scripts; the sizing backtest and the
  benchmarks are one asset over roughly one year, single windows, single seed. These are a proposal
  plus a first implementation, fork-verified, not a result proven at scale. Say that out loud.

Phases/steps (see the PHASE and BENCHMARK docs for detail):
- Phase 2 (`docs/PHASE2_AGENT_CHAT.md`): agent boots and chats.
- Phase 3 (`docs/PHASE3_ACTIONS.md`): wallet actions fire on-chain from chat.
- Phase 4 and 4.2 (`docs/PHASE4_RISK.md`, `docs/PHASE4_2_AGENT_RISK.md`): risk layer and its wiring
  into the agent (the RISK_GOVERNANCE provider and the RISK_ASSESS action).
- Step 2 benchmarks (`docs/BENCHMARK_LLM.md`, `docs/BENCHMARK_EXTERNAL.md`) and the paper.
- Phase 6 (`docs/DEMO.md`): the end-to-end demo runbook.

---

## 2. How it runs (it is not standalone)

This package cannot `bun install` or run on its own. Its `package.json` uses `workspace:*`
dependencies (`@elizaos/core`, `@elizaos/cli`, `@elizaos/plugin-sql`, etc.) that only resolve inside
the ElizaOS monorepo. The intended run path is:

1. Clone the ElizaOS monorepo on the `develop` branch (core 1.6.5-alpha). Do not check out a tagged
   beta to "match versions"; it triggers a `zod`/langchain dependency cascade.
2. Copy this repo into the monorepo as `packages/spartan` (a real copy via `rsync`, not a symlink;
   a symlink breaks the relative CLI path and Node module resolution).
3. Trim the workspace plugins this monorepo does not contain, install with `--ignore-scripts`,
   build the handful of workspace packages the runtime needs, start an Anvil mainnet fork, then
   launch from `packages/spartan` with the absolute CLI path.

The full, step-by-step recipe with every blocker and fix is `docs/SETUP_FROM_SCRATCH.md`. The demo
runbook is `docs/DEMO.md`. Do not re-derive the steps; follow those two documents.

Build detail: `build.ts` is a node-only Bun build that emits `dist/index.js` from `src/index.ts` and
nothing else. It deliberately does not shell out to `vite` (the upstream build did, which failed
under an old system Node). The web chat UI is served by `@elizaos/server`, not built here.

### The one required monorepo patch (there is no patch file in this repo)

`docs/project-notes` was purged, so there is no `.patch`/`.diff` file checked in. The single required
change to the monorepo is documented in `docs/SETUP_FROM_SCRATCH.md` (troubleshooting table, last
rows) and `docs/PHASE3_ACTIONS.md`:

In `packages/plugin-sql/src/base.ts`, `updateComponent` must set only the mutable columns:
replace `.set({ ...component, updatedAt: new Date() })` with
`.set({ data: component.data, updatedAt: new Date() })`, then rebuild `plugin-sql`. Without this,
account verification throws `value.toISOString is not a function` or a foreign-key violation, because
a component is updated by id and the identity/FK/createdAt columns are immutable (callers pass a
numeric createdAt and fallback FKs). If you re-clone the monorepo, you must re-apply this by hand.

### Environment keys

`.env` lives at `packages/spartan/.env` in the monorepo (see `.env.example` here for the ETH subset):
- A model provider key: `ANTHROPIC_API_KEY` (listed as default in `.env.example`) or `OPENAI_API_KEY`
  (used by `docs/SETUP_FROM_SCRATCH.md`, which also does embeddings via OpenAI). Only enable the
  provider plugin you have a key for in `src/index.ts` `character.plugins`.
- `ETHEREUM_RPC_URL` (or `EVM_PROVIDER_URL`), read by `getRpcUrl()` in
  `src/plugins/multiwallet/utils/ethereum.ts`. Point it at `http://127.0.0.1:8545` for the fork.
- Optional risk-layer overrides (all have safe defaults): `RISK_TARGET_VOL`, `RISK_MAX_WALLET_PCT`,
  `RISK_KELLY_FRACTION`, `RISK_HF_FLOOR`, `RISK_ENFORCE`, `RISK_VOL_FALLBACK`.

Rotate any key that may have been shared or committed at any point. End-user wallets are imported
in-chat, not read from `.env`; always use a throwaway key for testing (an Anvil dev key on a fork).

---

## 3. What always works offline vs what needs live infrastructure

Offline and deterministic (no keys, no fork, no agent; a first run may fetch a price CSV once):
- Unit tests for the risk sizing math: `src/plugins/multiwallet/risk/__tests__/sizing.test.ts`
  (30 cases across clamp, realized volatility, vol-target fraction, fractional Kelly, position size,
  projected health factor and floor, max safe borrow, swap sizing, and config loading).
- Unit tests for the Ethereum helpers: `src/plugins/multiwallet/utils/__tests__/ethereum.test.ts`
  (21 cases; key/address detection and derivation, normalization, known-token resolution).
  Because the repo root cannot `bun install` standalone, run these from a scratch dir with `viem`
  installed, exactly as `docs/VERIFICATION.md` section 1 shows (captured result: 21 pass).
- `scripts/demo-risk.ts` - prints swap size shrinking about 1/vol and the Aave HF floor
  allowing/refusing borrows. Pure math.
- `scripts/backtest-sizing.ts` - no-lookahead sizing backtest over one year of ETH; writes
  `paper/data/backtest_results.json`.
- The three figure scripts (`scripts/make-figure.py`, `make-figure-llm.py`,
  `make-figure-external.py`) - matplotlib, read `paper/data/*.json`, write `paper/figures/*`.
- `scripts/lib/backtest-core.ts` - shared no-lookahead backtest library (not standalone).

Offline once cached, needs an API key only to fetch new decisions:
- `scripts/backtest-llm.ts` - LLM-in-the-loop ETH benchmark. Decisions are cached per (model, date)
  in `paper/data/llm_decisions_<MODEL>.json`; re-runs off the cache are deterministic. Fetching new
  decisions needs `OPENAI_API_KEY` (gpt-*) or `ANTHROPIC_API_KEY` (claude-*). Writes
  `paper/data/llm_results.json`.
- `scripts/investorbench-eth.ts` - reproduces the InvestorBench ETH task; the core comparison is
  deterministic, an optional LLM arm needs `OPENAI_API_KEY`. Writes `paper/data/investorbench_eth.json`.

Needs a live RPC (read-only, no funds):
- `scripts/demo-readonly.ts` - derives an address, reads live balances, resolves a token, pulls a
  live Uniswap V2 quote. Set `ETHEREUM_RPC_URL` to any public mainnet RPC.

Needs a live Anvil mainnet fork:
- `scripts/smoke.ts` - the full state-changing flow (transfer, swap, supply, borrow) with real tx
  hashes. This is the primary evidence the execution layer works.
- `scripts/verify-hf-guard.ts` - reads real Aave state and runs the borrow HF guard for a small
  (allowed) and a large (refused) borrow.

Needs a live fork plus the running agent (`:3000`):
- `scripts/demo-e2e.ts` - drives the real agent through onboarding, a real swap, RISK_ASSESS, and an
  Aave supply, confirming each tx against the fork; retries because action selection is
  non-deterministic. Writes `paper/data/demo_e2e.json`.
- `scripts/agent-loop-poc.ts` - replays cached LLM decisions as real swaps through the agent. Writes
  `paper/data/agent_loop_poc.json`.

There are no `package.json` aliases for these scripts. Run TypeScript ones with
`bun run scripts/<name>.ts` and figures with `python3 scripts/<name>.py`. Exact invocations
(including required env vars) are in `docs/DEMO.md`, `docs/VERIFICATION.md`, and
`docs/SETUP_FROM_SCRATCH.md`.

---

## 4. Repo layout: our work vs upstream

### Our Ethereum work (load-bearing for the ETH agent)

- `src/index.ts` - the entrypoint. Defines the Spartan `character` and the `ProjectAgent` plugin
  list. This is where you see exactly which plugins load (see section 5).
- `src/init.ts` - `initCharacter`, imported by `src/index.ts`.
- `src/tasks/tsk_discord_post.ts` - imported by `src/init.ts` (in the build/run path).
- `src/plugins/multiwallet/` - the core of the ETH agent. Notable files:
  - `index.ts` - registers the plugin: providers `multiwallet`, `wallet`, `token`, `risk`; actions
    `walletCreate`, `walletImportAction`, `userMetawalletXfer`, `userMetawalletSwap`,
    `userMetawalletSweep`, `ethereumLendingAction`, `riskAssessAction`, `userMetawalletList`;
    services `InterfaceWalletService`, `RiskService`.
  - `actions/act_wallet_import.ts`, `act_wallet_swap.ts`, `act_wallet_xfer.ts`,
    `act_wallet_sweep.ts`, `act_wallet_lending.ts`, `act_wallet_list.ts`, `act_wallet_create.ts`,
    `act_risk_assess.ts` - the in-chat actions.
  - `utils/ethereum.ts` - all on-chain logic via `viem`, hardcoded to mainnet. Address/key helpers
    (offline), Uniswap V2 `swapEthereumExactIn`, `transferEthereumAsset`,
    `executeEthereumLendingAction` (Aave V3 supply/borrow), and read helpers
    `getEthereumWalletSummary`, `getAaveUserAccountData`, `getEthereumTokenBalance`. RPC from
    `ETHEREUM_RPC_URL`/`EVM_PROVIDER_URL`, default `https://eth.llamarpc.com`.
  - `providers/risk.ts` - the `RISK_GOVERNANCE` provider, injected into every turn so the agent is
    risk-aware before being asked. Emits the risk policy, max ETH swap size, and Aave borrow
    headroom for the user's first imported Ethereum wallet.
  - `services/srv_risk.ts` - `RiskService` (serviceType `AUTONOMOUS_TRADER_RISK`). Wraps the pure
    risk core plus read-only Ethereum reads, caches the regime (5-minute TTL). `assessSwap` and
    `assessBorrow`.
  - `risk/` - the deterministic sizing engine:
    - `sizing.ts` - pure math. `realizedVolatility`, `volTargetFraction`, `fractionalKelly`,
      `computePositionSize` (final fraction is the minimum of vol-target, Kelly, and wallet cap),
      `projectedHealthFactor`, `maxSafeBorrowBase`, `healthFactorFloorDecision`, `sizeSwapAmount`.
    - `regime.ts` - fetches a daily price series from CoinGecko (keyless) and computes annualized
      realized volatility; degrades to a configured fallback vol on any failure. Never throws.
    - `config.ts` - `RiskConfig` and `loadRiskConfig`. Defaults: target vol 0.5/yr, wallet cap 0.25,
      half-Kelly 0.5, HF floor 1.5, enforce true, fallback vol 0.8.
    - `types.ts`, `index.ts` - types and the `sizeSwap`/`guardBorrow` entry points the actions call.
    - `__tests__/sizing.test.ts` - 30 unit tests.
- `paper/` - the whitepaper (`main.tex`, `main.pdf`), data (`paper/data/*.json`, `*.csv`), and
  figures (`paper/figures/*`).
- `scripts/` - the deterministic and live scripts described in section 3.
- Our docs in `docs/` (dated recently): `SETUP_FROM_SCRATCH.md`, `DEMO.md`, `VERIFICATION.md`,
  `ETH_MVP_DECISIONS.md`, `PHASE2_AGENT_CHAT.md`, `PHASE3_ACTIONS.md`, `PHASE4_RISK.md`,
  `PHASE4_2_AGENT_RISK.md`, `BENCHMARK_LLM.md`, `BENCHMARK_EXTERNAL.md`, `WORKBOOK.md`, and
  `PLUGINS.md` (updated to describe the plugin set). `docs/README.md` is an index that still carries
  upstream content plus links to our new docs.

### Upstream ElizaOS/Spartan (Solana product) carried along in the fork

- `chrome-extension/`, `farcaster-miniapps/`, `spartan-mcp/` - upstream front-ends and an MCP server.
- `docker/`, `docker-compose.yml`, `docker-compose.dev.yml`, `DOCKER_QUICK_START.md` - a
  MySQL/Redis production stack the ETH MVP does not use (it uses local PGlite/SQLite via
  `@elizaos/plugin-sql`).
- Upstream docs: `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/QUICKSTART.md`.
- Upstream plugins under `src/plugins/`: `account`, `autonomous-trader`, `degenIntel`, `trading`,
  `analytics`, `kol`, `coin_marketing`. Several of these are load-bearing for the build/boot even
  though they are Solana-oriented (see section 5).
- Front-end build tooling at the repo root: `index.html`, `vite.config.ts`, `tailwind.config.js`,
  `postcss.config.js`, `tsup.config.ts`, and the React dependencies in `package.json`.
- Upstream test scaffolding: `tests/spartan.test.ts`, `tests/suite.ts`, `src/plugins.test.ts`.

### Root README

`README.md` at the repo root is the upstream Spartan README (it advertises the Solana product,
Docker, the Chrome extension, and MCP). It is informational, not load-bearing. If you trim upstream
directories, its links will break (see section 6).

---

## 5. What actually loads (verified against imports)

`src/index.ts` exports a `ProjectAgent` (`spartan`) whose `plugins` array is the authoritative list
of what loads. It is: `accountRegPlugin`, `autonomousTraderPlugin`, `degenIntelPlugin`,
`multiwalletPlugin`, `traderPlugin`, `kolPlugin`, `coinMarketingPlugin`. `analyticsPlugin` is
commented out in both the import and the array.

The character-level `character.plugins` list (framework plugins) has only `@elizaos/plugin-sql`,
`@elizaos/plugin-openai`, and `@elizaos/plugin-bootstrap` active; everything Solana-related
(`plugin-solana`, `plugin-jupiter`, `plugin-evm`, `plugin-birdeye`) is commented out for the ETH MVP.

Cross-plugin dependency facts I verified (these determine what cannot be removed):
- `autonomous-trader` is a foundational utility library imported all over: 17 files in
  `multiwallet`, 13 in `trading`, 11 in `account`, and a few in `degenIntel`/`analytics` import from
  `../../autonomous-trader`. Removing it breaks the build.
- `trading` imports `multiwallet/types` and `degenIntel/types`; `degenIntel` imports
  `trading/types`. These are mutually entangled.
- `analytics` is not loaded as a plugin, but it is a build dependency:
  `src/plugins/degenIntel/routes/charting.routes.ts` imports `BirdeyeProvider` from
  `../../analytics/providers/birdeyeProvider`. Deleting the `analytics/` directory breaks the
  `degenIntel` build. Keep the directory even though `analyticsPlugin` never loads.
- `kol` and `coin_marketing` are near-empty stubs (kol registers nothing; coin_marketing registers
  one provider), but they are in the `ProjectAgent.plugins` array. To drop them you must edit
  `src/index.ts`.
- Dead code that does not affect the build: `src/plugins/degenIntel/tasks/sellSignal.ts` and
  `buySignal.ts` import from a non-existent `../../degenTrader` directory, but they are commented out
  in `degenIntel/tasks.ts`, so Bun never resolves them. If you re-enable those tasks, they will fail
  to build.
- Unregistered actions inside our own plugin: `multiwallet/actions/act_faq.ts`, `act_menu.ts`, and
  `act_wallet_lp.ts` exist but are not in `multiwallet/index.ts`'s `actions` array, so they do not
  load.

---

## 6. Unnecessary-files analysis

This is analysis only; nothing has been deleted. Three lists, conservative by design.

### (a) Safe to remove for a lean Ethereum-only repo

Each of these is not imported by any `src` file and not in the `ProjectAgent.plugins` array, so it is
not on the build or boot path for the ETH agent.

- `chrome-extension/` (about 3.4 MB) - upstream browser extension. No `src` file references it.
  Adjust after removal: links in `README.md` (Chrome-extension sections) and in `docs/README.md`.
- `farcaster-miniapps/` (about 592 KB) - upstream Farcaster mini-apps. Not referenced by `src`.
- `spartan-mcp/` (about 416 KB) - upstream MCP server. Not referenced by `src`. Adjust after
  removal: MCP links in `README.md` and `docs/README.md`.
- `docker/`, `docker-compose.yml`, `docker-compose.dev.yml`, `DOCKER_QUICK_START.md` - the
  MySQL/Redis production stack. The ETH MVP runs via the ElizaOS CLI with a local PGlite/SQLite
  store, not this compose stack. Adjust after removal: Docker links in `README.md` and
  `docs/README.md`.
- Upstream Solana-product docs: `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`,
  `docs/QUICKSTART.md`. These describe endpoints, deployment, and architecture for the upstream
  product, not the ETH MVP. Adjust after removal: the index links in `docs/README.md` (and the
  root `README.md` "documentation" section).

If you remove any of the above, the root `README.md` and `docs/README.md` will contain dead links;
plan to rewrite both to point only at the ETH docs listed in section 4.

### (b) Must keep (load-bearing to build or boot the ETH agent)

- `src/index.ts`, `src/init.ts`, `src/tasks/tsk_discord_post.ts` - the entrypoint chain.
- `build.ts`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsconfig.typecheck.json` -
  build and type configuration used by the run path.
- `.env.example` - the documented ETH environment subset.
- `src/plugins/multiwallet/**` - the ETH agent and the risk layer. Core of the product.
- `src/plugins/autonomous-trader/**` - foundational utilities imported across account, trading,
  multiwallet, degenIntel, analytics. Registered and depended on. Removing it breaks the build.
- `src/plugins/account/**` - registered; registration/verification gates the wallet actions.
- `src/plugins/degenIntel/**` - registered; provides the chain/data/strategy/LP services and is
  entangled with `trading` types. Also imports `analytics/providers/birdeyeProvider` at build time.
- `src/plugins/trading/**` - registered (the strategy layer); imports `multiwallet` and `degenIntel`
  types.
- `src/plugins/analytics/**` - not loaded as a plugin, but a build dependency of `degenIntel`
  (`charting.routes.ts` imports `BirdeyeProvider`). Keep the directory.
- `src/plugins/kol/**`, `src/plugins/coin_marketing/**` - registered in `ProjectAgent.plugins`
  (stubs). They load today; removing them requires editing `src/index.ts` first.
- `src/assets/portrait.jpg` - the character avatar file. Note a latent bug: `src/index.ts` reads
  `./src/spartan/assets/portrait.jpg`, which does not exist, so the avatar currently falls back to an
  empty string. The real file is `src/assets/portrait.jpg`; fix the path if you want the avatar.
- `paper/**`, `scripts/**`, and the ETH docs in `docs/` (section 4) - the deliverables and their
  reproducibility. Keep.

### (c) Uncertain: needs a runtime check before removing

- Front-end build tooling at the repo root: `index.html`, `vite.config.ts`, `tailwind.config.js`,
  `postcss.config.js`, `tsup.config.ts`, `src/vite-env.d.ts`, `src/assets/logos/`, and the React and
  vite/tailwind dependencies in `package.json`. The node-only `build.ts` does not invoke vite and the
  web chat UI is served by `@elizaos/server`, so these look unused at runtime. But the loaded
  `degenIntel` plugin serves static front-end assets from its routes, and `package.json` still has a
  `build-frontend` script. Confirm no loaded route depends on a vite build before removing.
- `src/plugins/degenIntel/frontend/` and `frontend_new/` - static assets served by degenIntel
  routes. Since `degenIntel` is loaded, verify these routes are unused before removing.
- `tests/spartan.test.ts`, `tests/suite.ts`, `src/plugins.test.ts` - upstream test scaffolding. The
  `package.json` `test` script runs `elizaos test`, which may load these. They are not the ETH unit
  tests (those live under `src/plugins/multiwallet/`). Verify the test harness does not depend on
  them before removing.
- `src/discord-types.d.ts`, `src/types/index.d.ts` - ambient type declarations; likely needed for a
  clean typecheck. Keep unless a typecheck shows they are unused.
- `src/plugins/multiwallet/actions/act_faq.ts`, `act_menu.ts`, `act_wallet_lp.ts` - present in our
  plugin but not registered in `multiwallet/index.ts`. Dead today; confirm nothing else imports them
  before removing (they may be intended future features).

---

## 7. Branch layout

- `ethereum-amm-agent` - the core, shippable product: boot, chat, the risk-governance provider, and
  the on-chain actions (Uniswap V2 swap, Aave supply/borrow) on the fork.
- `step2-llm-benchmark` (current) - a superset of the core branch that adds the deterministic sizing
  backtest, the LLM-in-the-loop and external-benchmark studies, the agent-in-the-loop proof of
  concept, the paper additions, the demo runbook and driver, and the workbook. The Section-1
  agent code exercised in the demo is byte-identical to `ethereum-amm-agent`.

Other branches present are earlier work-in-progress lines
(`eth-mvp-setup-tests-docs`, `eth-mvp-verification-scripts`, `eth-verification-scripts-v2`,
`fix-aave-supply-borrow`); `step2-llm-benchmark` supersedes them. Do all new work from
`step2-llm-benchmark` unless you specifically need the lean core.

Files that exist only on `step2-llm-benchmark` (not on `ethereum-amm-agent`) include:
`docs/BENCHMARK_EXTERNAL.md`, `docs/BENCHMARK_LLM.md`, `docs/DEMO.md`, `docs/WORKBOOK.md`, all of
`paper/data/*` and `paper/figures/*`, and the scripts `agent-loop-poc.ts`, `backtest-llm.ts`,
`demo-e2e.ts`, `investorbench-eth.ts`, `lib/backtest-core.ts`, `make-figure-external.py`,
`make-figure-llm.py`.

---

## 8. Known gotchas

- Non-deterministic LLM action selection. The agent sometimes replies conversationally instead of
  firing the offered action. Re-send the same message one to three times. The headless drivers
  (`scripts/demo-e2e.ts`, `scripts/agent-loop-poc.ts`) already retry. Documented in
  `docs/PHASE3_ACTIONS.md` and both runbooks. This is not a bug.
- The `plugin-sql` `updateComponent` monorepo patch (section 2) is required for account
  verification. There is no patch file in the repo; it is documented in `docs/SETUP_FROM_SCRATCH.md`
  troubleshooting and `docs/PHASE3_ACTIONS.md`. Re-apply by hand on a fresh monorepo clone.
- Build/launch order matters. Build the workspace packages the runtime needs, and rebuild `server`
  after `client` so the web UI is bundled. Launch from `packages/spartan` (not the monorepo root) or
  it loads the default Eliza character. Use the absolute CLI path. All in `docs/SETUP_FROM_SCRATCH.md`.
- Stale identity between runs. The character list and onboarding state are cached in PGlite;
  `rm -rf packages/spartan/.eliza` and restart to pick up edits.
- `.env` keys. Enable only the model provider plugin you have a key for. Rotate any key that may have
  been shared. Use a throwaway wallet key for testing.
- `paper/data/eth_daily.csv` has a duplicate final row (two rows for `2026-08-12`). This is a known
  quirk noted in the docs audit. If you regenerate or extend the series, de-duplicate the last date
  before recomputing metrics.
- Latent avatar path bug: `src/index.ts` points at `./src/spartan/assets/portrait.jpg` (does not
  exist); the file is at `src/assets/portrait.jpg`. Harmless (falls back to empty avatar) but worth
  fixing.
- Anvil forks require an upstream mainnet RPC key (for example Alchemy) to start, even though the
  fork itself needs no funds.

---

## 9. Honest limitations and future work

Limitations (stated plainly in the paper and demo):
- The fork is not live trading: state is pinned, there are no adversarial counterparties, and MEV is
  absent. The demo driver is a capability check at a single forked block, not a backtest.
- The sizing backtest and benchmarks are one asset (ETH) over roughly one year, with single windows
  and a single seed. No claim of excess return; the claim is variance and drawdown reduction from
  volatility targeting with a cap.
- The external comparison reproduces InvestorBench's protocol and matches its buy-and-hold numbers,
  but it is not a full run of their harness end to end.
- Action selection by the LLM is non-deterministic.

Future work:
- A multi-seed, multi-asset, out-of-sample evaluation, and running inside a full external benchmark
  harness end to end.
- Live or testnet settlement rather than forked settlement, and MEV-protected execution for larger
  orders.
- Richer regime inputs (funding rates, open interest, on-chain flows, macro signals).
- A multi-agent decision layer and a model A/B comparison.

The upstream Spartan fork is not deployed live; this work is a proposal plus a fork-verified first
implementation.
