# Codex review of the latest Claude Code work

22 October 2026. Read-only inspection and offline verification; no paid requests, application deployment or new live-chain experiments. Source code, prior results and Claude's in-progress runtime scaffolding were not modified.

## Completed evidence

The two new API cohorts are real model runs, distinct from the mock dry runs. Opus 5.5 resolved 8/8 episodes with 28 calls; GPT-6.1 Sol resolved 8/8 with 25 calls. Both had zero unsafe proposals, blocked transactions, executed reserve violations, false completions and incomplete episodes. Deterministic controls resolved 4/4 in each cohort. New estimated API usage totals US$0.33509; the replication ledger reaches US$0.3688377 cumulatively, before any separate compatibility-probe accounting.

I reran the revision-2 audit on both completed paid cohorts, the 36-case Python verifier regression suite, and the 11 current adapter tests. All passed. Revision 2 checks request reconstruction, conditions, exact model-call/action correspondence, replayed balances and pools, per-call usage settlement, partial-run handling, planned coverage and frozen hashes. The six adversarial mutations identified in the previous review are now rejected. This is a successful re-audit of the claimed artifact checks, not a proof that the harness captures all production failure modes.

The first broad Bun filename-filter command also discovered an archived revision-1 test copy whose imports are deliberately incomplete. The precise current-suite command passes:

```sh
bun test ./api-replication-client.test.ts ./claude-agent-client.test.ts
python3 test-api-verifier.py
python3 verify-api-replication-results.py agent-opus-api-results agent-sol-api-results
```

The paid report's substantive caution is appropriate: low reasoning, larger output allowances, retained reasoning, caching settings and Opus's append-only continuation history differ from the earlier cheap configurations. No causal model ranking or task-record benefit follows. These remain known fixtures with one repetition per condition/scenario and one narrow task template in a minimal local-chain driver, not cohorts in the running Eliza/Spartan application.

**Decision:** stop extending the model list on this template. The observations no longer justify pursuing a new task-record recovery mechanism. Keep them as developmental evidence and as a useful test harness.

## What is preparation rather than completed research

`docs/FLOW_DIAGRAMS.md` maps the real application flow; `EXPERIMENT_FLOW.md` maps the bounded experiments. These are useful distinctions. The existing phase documents record earlier chat-driven fork transactions, but those demonstrations are not the new matched recovery cohorts.

`research/agent-flow-cohorts/` currently contains a fork RPC proxy, LLM egress proxy, model-plugin compatibility probe and its output. I did not find a complete cohort controller, a frozen full-agent protocol, an independent full-agent verifier or completed full-agent results in that directory at review time. Treat these as experimental scaffolding.

The compatibility probe records an actual practical mismatch: the plugin-shaped OpenAI requests include temperature 0.7 and received HTTP 400 for Luna and Sol; the Anthropic-shaped requests returned OK with unsupported-setting warnings. The egress proxy removes temperature for GPT-6 models and logs the normalization. This is a configuration compatibility observation, not evidence of poor agent reasoning or a new blockchain method. Future comparisons must record the exact plugin versions, requests, normalizations, model settings and each provider's actual response metadata.

There are two separate working copies: `spartan-agent` and `eliza/packages/spartan`; the latter is not a symlink. Pin the executed source/build/version and verify parity before attributing runtime results to the reviewed repository. At inspection, Spartan is three local commits ahead of its remote; there are also untracked flow/cohort files. No push was performed by this review.

## Most useful next engineering question

**Do the user's task requirements survive the path from conversation to selected action, extracted parameters, risk adjustment and submitted transaction?**

This follows concrete static findings in `src/plugins/multiwallet/actions/act_wallet_swap.ts`:

- `SwapWalletContent` represents token identity, amount, wallet and chain, but no user-required minimum output or retained cash amount. This identifies an interface limitation to test; it does not prove every such instruction is violated.
- The risk layer may change `content.amount` into `execAmount`. The human reply uses the executed amount, but returned `data.amount` retains the originally extracted amount. That creates a measurable consistency question across execution, structured results and subsequent reasoning.
- If the risk assessment throws, the handler adds a 'Risk check skipped' note and proceeds. This is a concrete failure-path behaviour requiring a conventional fail-closed baseline before considering an ML contribution.
- Receipt-wait exceptions are surfaced as swap failures. The library may include a transaction hash, but the action does not itself distinguish unresolved submission from confirmed failure. Full-agent recovery must be evaluated against available receipt tools; do not blame a planner for failing to use a capability it was never given.

These points connect agent engineering to blockchain execution more directly than another prompt summary. They are hypotheses and implementation observations, not newly demonstrated full-agent failures or established novelty.

## Suggested next comparison, for discussion

Compare the existing workflow with (1) a conventional controller that preserves structured task requirements and reconciles receipts, and (2) execution that enforces the same user policy at submission/commit. Include a solver/reference policy when feasibility is tractable. Keep every condition's allowed routes, user requirements, observations and protection policy comparable. Separate task correctness from the location of enforcement, gas overhead, latency and recovery cost.

Use the actual application before generalising: account gates, action selection, parameter extraction, risk sizing and tool results all participate. Include tasks with real structural differences, such as swap-and-supply or repay-and-withdraw, rather than only new numbers in the same swap template. Repeated deterministic demonstrations are not stochastic agent trials; repeated prompts until a desired action fires must not be silently substituted for prespecified episodes.

The new RPC fault proxy needs its own conformance checks before evaluation: confirm the intended sale actually succeeded, identify it by more than ETH value alone, place each market change after confirmed effect and before the designated next observation, and specify receipt hiding/release without wall-clock timing differences changing the effective task across controllers. The LLM egress proxy needs request/action trace verification and failure/limit tests comparable to those just fixed in the smaller harness. Do not run its live mode during this review.

Novelty remains conditional. Existing intent, workflow and recovery systems may already express these policies. A reproducible limitation of the complete execution pipeline, or a substantive architecture trade-off under equal policies, could motivate a paper; ordinary schema additions and fail-closed checks alone do not establish a new research contribution. Consult the existing literature matrix before selecting a mechanism or claiming a gap.
