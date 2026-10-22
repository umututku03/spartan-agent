# Preserving Task Requirements During DeFi Agent Recovery

Research proposal for discussion — 21 October 2026

I would like to study how an AI agent behaves when a partly completed DeFi task becomes infeasible. My interest is reliable agent execution, using our Spartan implementation to investigate the problem.

For example, a user asks the agent to sell ETH, acquire at least 50 DAI and retain at least 120 cash. After the ETH sale, a price change may make the remaining requirements impossible to satisfy together. The agent should recognise this and stop. It should not lower a requirement simply to execute another trade.

**Research question:** When a partly completed DeFi task becomes infeasible, does an agent preserve the user's original requirements when deciding whether and how to continue?

I have run three small closed-loop studies with 32 model-driven episodes and twelve deterministic control episodes. The agent selected tools, submitted real transactions on a local test chain and observed their results. This used a bounded research driver and the existing Spartan transaction helper, rather than the full application.

The clearest observation occurred after a price change. The agent learned that its permitted 80 cash would buy only 45.89 DAI. It proposed spending 88 cash, which the reserve guard blocked. It then lowered the transaction's minimum output to 45 and spent 80 cash. The reserve remained intact, but the requested 50 DAI was not acquired. In the matched Claude test, the agent also proposed a reserve-breaking trade, but the guard blocked it and it subsequently stopped correctly. Claude resolved all eight episodes and did not repeat the executed reduction of the DAI goal. Giving an explicit task record did not show a consistent advantage across models. Ordinary receipt checking and deterministic sizing resolved all four test fixtures.

These results are preliminary. Short round limits explained many other incomplete runs; all feasible tasks completed in the separate eight-round study. The remaining behaviour needs to be tested across fresh tasks, further repetitions and budgets. It is not yet evidence of a new recovery method or a general weakness in current agents.

I would not build the paper around the task record as a new method. The next study would use the actual Eliza/Spartan runtime and compare ordinary replanning, a verified feasibility baseline, workflow-level goal checks and structured infeasibility feedback under the same execution protections. I would measure correct completion or stopping, requirement changes in submitted actions, blocked and executed effects, and recovery cost. Matched controls would test whether any failures are specific to recovery.

Existing research already covers workflow enforcement and agent recovery. I would first establish whether this behaviour exposes a gap in those evaluations or is adequately handled by existing methods. That would determine whether to develop a measurement paper or revise the direction.

Detailed evidence and limitations: [cross-model decision](cross-model-findings.md), [closed-loop findings](agent-findings.md), [novelty comparison](novelty-check.md), and [earlier engineering results](findings.md).
