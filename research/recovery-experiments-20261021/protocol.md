# Exploratory protocol: recovery of partially completed DeFi tasks

Protocol v1, written before running the comparisons. This is a registered local exploration, not an externally preregistered or confirmatory study. The prior mocked helper diagnostic is already known and motivates E1. Parameter grids are synthetic design choices, not sampled market observations.

## Question and falsifiable expectations

We are investigating which recovery failures remain after capable conventional controls. We will not infer novelty from an improvement over blind retry.

- E1: A transaction journal and receipt reconciliation should handle ordinary uncertainty after submission. If so, timeout handling alone is engineering groundwork, not our method contribution.
- E2: Under changed prices, refreshing an unchanged plan may stop unnecessarily. A deterministic inverse-quote calculation should solve every feasible single-pool task in the defined action space. If it does, ordinary trade resizing is insufficient differentiation.
- E3: A balance check at planning time, or immediately before submission, may cease to hold before execution. An equivalent execution-time predicate should prevent action-induced reserve violations. We will also test ordinary replanning after a guard rejection. This is an enforcement-location comparison, not evidence of a new guard mechanism.

## Environment and scope

Use a fresh local Anvil EVM, isolated from mainnet and real wallets. Compile transparent test tokens and a test exchange. ETH-to-cash uses a fixed synthetic rate of 2,000 cash units per ETH; cash-to-DAI uses an explicitly implemented constant-product pool with a 0.3% input fee. Test cash has six decimals; test DAI has eighteen. These are testing contracts, not deployed Uniswap or Aave. Their state perturbations are controlled interventions. Token faucet permissions are deliberately unrestricted and cannot be used by controllers.

E1 executes the existing `swapEthereumExactIn` function body, with source checksums. Address and client factories bind it to the test deployment, and normal viem transaction submission/receipt handling remains real. Fault injection changes receipt visibility; chain execution and final outcomes are checked independently over an unaffected connection. This is stronger than the prior mocked diagnostic but is not a full-agent test or mainnet-fork study.

Each episode starts from an identical suite snapshot. Snapshot rollback is available to the evaluator only between episodes. Controllers cannot reset settled actions. Transactions remain serialized from the controller's perspective. E3 introduces a second, already authorized spender as the explicitly controlled source of balance changes. The final verifier and feasibility oracle are not controller tools.

## Comparisons and scenarios

E1: normal completion, rejection before submission, pending receipt timeout, successful transaction with hidden receipt, confirmed revert. Compare explicit fresh retry, stop-on-error, and conventional journal/reconciliation. Repeated invocation is deliberately scripted, not an observed LLM mistake. Record viem error metadata; test whether the earlier generic-mock conclusion about hash availability survives actual library behavior.

E2: the first trade has already produced 200 cash. Acquire at least 50 DAI and retain the requested cash reserve. Pool cash reserve is 10,000. Cross DAI/cash reserve ratios [0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.90, 1.00, 1.10] with minimum cash reserves [110, 120, 130, 140]. Compare a fixed 60-cash suffix, refreshing that same amount and stopping if inadequate, and deterministic resizing. All use a common minimum-output requirement and reserve rule. The deterministic method uses the standard inverse constant-product formula. An independent exhaustive search over cent-sized inputs establishes feasibility in that finite action space.

E3: begin with 200 cash and reserve floor 120, target at least 50 DAI. Propose spending 80 cash, then have an authorized external spender transfer [0,10,20,40] cash away before execution. Cross these amounts with reserve ratios [0.75,1.00,1.25]. Compare a planning-time check, an immediate-pre-submission check followed by the same scheduled race, an execution-time floor assertion, and that assertion followed by deterministic resizing after rejection. Distinguish external state changes from any additional violation caused by the tested action.

## Outcomes and fairness

Primary outcomes are task completion within constraints and action-induced reserve violations. Report completion separately for independently feasible and infeasible episodes. Report safe stops, repeated effects, recovery calls and included-transaction gas. Reverts consume gas and do not count as successful actions. No-fault cases measure unnecessary obstruction. Full receipts, balances and call traces supply ground truth; no LLM judge is used.

Record all policies on the same scenario parameters and initial state. All can inspect the same ordinary state and quotes. A controller's stopped or reverted episode is never silently dropped. Purely deterministic grid repetitions do not supply independent evidence; report counts and per-scenario differences, not population confidence intervals or p-values. Timing numbers describe this local harness only.

Freeze this protocol, contract source, code, dependency lockfile and scenario definitions by hashes before the first measured run. Harness conformance failures must be fixed and logged with the old hash; any resulting rerun is labeled. Save full machine-readable results and a small falsification ledger. Mark exploration-derived hypotheses as new hypotheses requiring fresh tests.

## Later LLM comparison

API access is not yet configured. Prepare a separate model phase with identical tools, guards, action/query budgets and task information. Compare raw information, a compact report containing the same information, and an explicit repair suggestion as separate conditions. Never give one condition privileged future state or feasibility labels. Include the deterministic controller and an established recovery baseline. Record exact provider/model versions, prompts, decoding, request IDs when available, usage, latency and every tool call. Temperature zero is not assumed deterministic.

Use a development set to debug prompts; keep scenario families and their numerical variants together when splitting. Freeze controller code and prompts before opening the evaluation partition. Repeat model episodes and pair conditions on identical states and fault schedules. Resample scenario families, not individual tool calls, for uncertainty estimates. A small pilot estimates variability and cost; it does not establish cross-model generality. Report all planned outcomes and any failures or missing runs. Do not choose the final question solely because one comparison happens to look favorable.

## CSC490 grounding

- Lecture 1 (Sept 9), PDF pp.71 and 80: research requires experimentation and iteration; record how a system breaks and the corresponding tests.
- Lecture 3 (Sept 23), PDF pp.36–41: compare implementation choices and costs, and specify architecture concretely enough to build.
- Lecture 4 (Sept 30), PDF pp.10–19: temperature zero does not guarantee determinism; valid constrained output does not by itself establish correct task behavior.
- Lecture 4, PDF pp.29–30 and 54: model explanations require caution; use observable behavior and tasks with checkable answers.
- Lecture 5 (Oct 7), PDF pp.26–27: distinguish throughput and latency.
- The CSC490 project checklist and literature-review protocol add matched source IDs, label separation, grouping related variants, provenance and paired analysis. The statistical and split rules above are our application of those practices, not quotations from the lecture slides.

## Decision rule

An ordinary baseline solving its intended cases rules out a simple novelty claim; it does not invalidate the whole field. Identify a substantive residual failure before proposing a new architecture. A plausible next research direction must state the unmet requirement, why the strongest baseline fails, and what evidence could refute the proposed solution. These experiments alone cannot establish a novel AI method or a publication outcome.
