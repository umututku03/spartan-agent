# Staged live real-agent study — 22 October 2026

These are the first paid runs of the frozen real Spartan/ElizaOS agent protocol. Both authorized cohorts finished execution: GPT-6 Luna first, then Claude Haiku 5.5. No Sol or Opus requests were made in this stage. The question is whether the deployed workflow can complete a two-trade task and preserve its requirements when receipts or prices change.

Each model ran 16 episodes: two drivers × two task-record conditions × four scenarios. Each cohort also ran four deterministic controls. The mainnet fork was pinned at block 26250601. Source base: `08ae425` on `ethereum-amm-agent`; execution used the built Eliza copy after checking all 201 source files for parity.

## Results and acceptance

| Cohort / audit | Controls resolved | Valid completions | Correct infeasibility | False completions | Episodes with repeated exact sales | Calls | Estimated US$ |
|---|---:|---:|---:|---:|---:|---:|---:|
| Luna / PASS | 4/4 | 0 | 0 | 0 | 9 | 174 | 0.1048695 |
| Haiku / FAIL | 4/4 | 0 | 0 | 1 | 3 | 244 | 0.2125577 |

**Haiku failed blinding.** A seeded account email encoded the final episode name. Its `USER_DETAILS` action disclosed that email to model requests 224, 225, 227, 228 and 229. The supplied verifier rejected request 224; it was not weakened or edited. The full raw run is retained locally and is not committed. Haiku’s report, descriptive per-episode metrics, manifest, execution-completion marker and audit-failure record are published; no raw requests, responses or episodes are included. Its counts above are diagnostic observations, not an accepted blinded cohort.

Per-episode outcomes, turns, calls, token counts, reasoning/thinking counts, costs and revert reasons are in each cohort’s `report.md` and `episode-metrics.json`. The JSON includes final balances, fault exposure, total successful native value and closing-turn writes. All reported model outcomes retain the frozen definitions.

## What these observations support

The accepted Luna cohort failed to complete the task and repeatedly sold native tokens, while deterministic controls could execute or correctly stop on the same fixtures. Haiku also recorded a completion declaration with zero DAI, but its cohort failed blinding; this is a diagnostic trace, not a clean comparative result. This is evidence for studying task-state preservation, transaction reconciliation and completion checks in the deployed workflow; it does not establish a new method, causal mechanism, model ranking or conference contribution.

Several interpretation limits matter:

- One repetition per cell, one known task and one fork block; these are developmental observations, not general error rates. Driver, provider-plugin and default reasoning differences prevent clean model comparisons. Earlier toy-agent results are not comparable performance baselines.
- The closing question can execute trades. Single-shot and multi-step drivers offer different numbers of action opportunities. Closing writes are reported separately; the frozen procedure was not changed.
- The frozen sale counter counts only successful router writes carrying exactly 0.1 ETH. Risk clamps can cause smaller native-value writes. Supplemental total-value accounting is necessary to assess whether the exact-sale requirement was preserved.
- A fault scenario without a first sale never exposes the agent to that fault. Stock Spartan has no receipt/status action. A missing reserve before a sale does not prove depletion of an existing reserve.
- This is the headless message-service path with seeded account state, deterministic embedding stubs and blocked external market data. The optional HTTP Sessions check was not run. The verifier audits saved records; it does not independently reconstruct fork storage.

## Execution, deviations and validation

The approved limits were US$0.60 per cohort. Both remained under those limits. No prompts, harness code, frozen outcome rules or models were changed after live execution began. No manual retries, fallback models or replacement episodes were used. Haiku’s post-run blinding audit failed; execution was already complete when it was detected. No harness fix or paid rerun was attempted. The account-identity disclosure is a protocol violation, not an agent behavior result. Closing-turn writes and partial-size native writes are newly observed interpretation limits, not retrospective protocol changes.

Luna passes the supplied artifact audit. Haiku fails it on model-visible harness labels and an episode identifier; see `agent-flow-results-haiku/audit-failure.json`. Offline diagnostic enumeration found no other failed assertions, but it is not a passing audit. Before execution, the existing mock audit, 14 verifier tampering cases and 14 egress-proxy cases passed. After each live cohort, exact configured secret values and credential patterns were checked. No mined reverts were observed; therefore there are no untraced reverted transactions. Raw Anvil logs are not committed; local redacted Anvil diagnostics are also excluded. Luna’s raw requests, responses, episodes and required child stderr are kept in a local tar.gz outside Git. Its report records SHA-256 and restoration/audit commands; the extracted archive passes the original verifier. The trimmed Git folder alone cannot reproduce that audit. Haiku’s raw records, including stderr, are retained locally with the rejected requests and are not committed.

The prior estimate was US$0.3688377. Returned probe usage adds US$0.0001558 (Haiku US$0.0000038; Opus US$0.000152), producing starting prior US$0.3689935. Two OpenAI HTTP 400 probes returned no usage; no invoice was checked and no charge is inferred from missing usage. `live-accounting.json` records this settlement.

New Luna + Haiku conservative estimated usage: US$0.31742720. Final cumulative ledger: US$0.68642070. Costs use the frozen proxy rates, including its OpenAI input upper bound, and are not provider invoices.

## Next stage — proposal only

First repair the account-identity leak in a separately recorded stage: use a neutral seeded identity, check every model-visible payload before forwarding, and test USER_DETAILS/ACCOUNT_DETAILS explicitly. Freeze the revised protocol and report the failure before any paid rerun. Then inspect action traces around first-sale recognition, risk-clamped amounts and the closing question. A follow-up intervention should make completion a check of wallet state and enforce the original transaction requirements, then compare it against stock under a newly frozen paired protocol. These runs alone do not identify which change would help.

Measured-usage repricing, using the frozen target-model rates. Haiku usage is retained for resource accounting despite its failed blinding; it is an uncertain basis for forecasting a corrected harness:

| Proposed model | Baseline calls | Input / output tokens | Reported reasoning / thinking tokens | Same usage, all 16 (US$) | Same usage, normal + hidden 8 (US$) | Proposed cap (US$; unapproved) |
|---|---:|---:|---:|---:|---:|---:|
| sol | 174 | 508804 / 82538 | 61689 | 2.0974 | 1.1794 | 4.25 |
| opus | 244 | 1114562 / 202203 | 135603 | 8.5023 | 4.1573 | 5.50 |

Reasoning/thinking counts are reported metadata within output usage, not additional tokens added again to costs. Same-usage repricing is not a forecast: stronger models can change call counts, reasoning and output length. Check provider pricing before any future launch. A budget cap can stop a cohort early and does not guarantee completion.

After the blinding problem is resolved and the corrected stage is frozen, Sol’s proposed cap is US$4.25 for the full design. For Opus, propose a separately predeclared balanced eight-episode stage (both drivers × both conditions × normal/receipt-hidden), capped at US$5.50; the full 16-episode usage estimate leaves insufficient headroom. This subset is a discussion proposal, not a silent change to protocol v1. It needs a new frozen stage definition, suitable runner support and explicit budget approval before any paid request. Neither proposal is authorized by this run.
