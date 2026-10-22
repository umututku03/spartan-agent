# What the first recovery experiments establish

Exploratory findings, 21 October 2026. Final instrumented run: 171 episodes on a fresh local Anvil chain, with transparent testing contracts and no LLM calls. The recorded grids are constructed stress cases, not random market samples. Repeated deterministic runs check the harness and are not additional independent evidence.

| Experiment | Comparison | Result on the specified cases |
|---|---|---|
| Uncertain submission outcome | Fresh retry versus ordinary journal and receipt reconciliation | Fresh retry produced two extra successful effects across five scenarios. Reconciliation completed all five without duplicate effects. |
| Remaining trade invalid after a price change | Fixed input, quote refresh at the same input, deterministic resizing | Fixed input and refresh completed 12/23 feasible cases. Resizing completed 23/23; it stopped on all 13 infeasible cases. |
| Cash changes after the off-chain check | Planning/pre-submission checks versus an execution-time floor | Both off-chain checks allowed reserve violations in 9/12 scheduled scenarios. The execution-time check allowed none. |
| Continuing after an execution-time rejection | Reject and stop versus the same guard plus ordinary resizing | Guard-only completed 3/8 feasible cases; guard plus resizing completed 8/8 and stopped on all four infeasible cases. |

Completion means reaching the task's specified balances without violating the reserve. E1 additionally requires a truthful controller acknowledgment of the known result; a stopped controller may leave a trade successfully completed on-chain while reporting failure. The controllers are scripted; none of these numbers describes observed LLM behavior.

## A correction to the earlier mock-based interpretation

The real viem receipt-timeout exception includes the submitted transaction hash in its message. It does not expose a dedicated `hash` field in this tested version, but the identifier is not universally lost. The earlier mocked generic error did not establish that detail. The current helper still lacks an explicit pending/success/revert outcome interface, yet keeping or extracting a hash and checking the receipt are conventional solutions. This reduces the case for treating receipt ambiguity alone as a new method.

## Directions these results weaken

1. A transaction journal by itself: conventional reconciliation handles the scoped cases.
2. Requoting or resizing a single-pool trade: the standard inverse-quote calculation solves every independently feasible case in the grid.
3. An execution-time balance guard by itself: it prevents the tested violations, but it is an existing architectural technique and stops some recoverable tasks.
4. Combining that guard with ordinary resizing: the combination also handles the scoped cases, so the combination alone does not establish novelty.

The experiments therefore narrow the search rather than confirm the original structured-feedback proposal. We should not describe these engineering controls as a new AI method.

## Most useful next investigation

A candidate initial question is:

> When an interrupted DeFi task requires a revised plan, does an LLM agent preserve the user's original requirements, or does it make the next transaction succeed by changing what the task requires?

An example is lowering the minimum DAI amount to make a previously rejected trade execute, or dropping the required cash reserve. A local tool call can succeed while the original task remains unsatisfied. This question connects Q1's constraints to the agent's replanning behavior. It is still a candidate measurement question; no novelty claim is established. Existing intent-enforcement, workflow-verification and repair-feedback work must be compared directly if a substantive failure appears.

First use a very inexpensive six-case decision screen to check the model adapter and identify possible error types. It is development data and does not evaluate autonomous recovery. If useful failures appear, move to an interactive tool environment with stable task specifications, identical guards, an independent goal checker and the strongest deterministic baseline. The original structured-feedback comparison can remain an ablation. The later study must include varied task structures and fresh evaluation cases, not just parameter changes selected after looking at these results.

## Methodology and limitations

The protocol was written and hashed before measured execution. Preserve source hashes, exact dependencies, full receipts, deployment metadata, scenario-level outcomes and the amendment log. One sandbox-blocked attempt ran no episodes. The subsequent runs and instrumentation corrections are recorded; semantic outcomes were unchanged.

The final code reads public pool state and quotes through RPC. Its controller formula and evaluator's finite enumeration are different implementations. The common pool is a deliberately simplified constant-product market; ETH-to-cash is fixed-rate. State changes are evaluator-controlled. Native-token gas, public-chain inclusion, reorgs, real liquidity, real user instructions, agent persistence and private-key signing are not fully modeled. Test-token faucets are not actions available to controllers. Wallets are local unlocked test accounts.

No confidence intervals or significance tests are appropriate for the deterministic grid as a market-population estimate. The results do not show that these failure rates occur in production, that one model is safer than another, or that ICBC novelty has been established. The next decision depends on actual agent evidence.
