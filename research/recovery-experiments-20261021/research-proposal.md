# Preserving User Constraints When a DeFi Agent Revises Its Plan

Research proposal for discussion — 21 October 2026

I would like to study whether an AI agent preserves the user's original requirements when it needs to revise a partly completed DeFi task. My interest is in reliable agent execution, using our Eliza/Spartan implementation to investigate the problem.

For example, a user asks the agent to sell ETH, buy a minimum amount of DAI, and retain a minimum cash balance. After the first transaction succeeds, a change in price may make the remaining trade infeasible. The agent should find a permitted alternative or explain why the task cannot be completed. It should not make the trade succeed by quietly reducing the required DAI amount or cash reserve.

**Initial research question:** How reliably do DeFi agents preserve the user's original constraints when revising an interrupted plan?

I have started with engineering controls and a small model pilot. In 171 local-chain test episodes, ordinary receipt checking, deterministic trade resizing and execution-time checks handled the cases they were designed for. These results make those mechanisms useful baselines rather than sufficient new contributions.

The model pilot then tested a small number of decision cases. In one response, the model proposed spending 85 cash from a balance of 220 despite a required reserve of 140. Its explanation correctly stated that the remaining 135 cash would violate the requirement and that it should stop. Replaying that proposal on the local test chain confirmed the violation; an existing execution-time check blocked it. Another response stopped on a feasible task. These are preliminary decision tests, not evidence about a complete autonomous agent or a general model failure rate.

The next experiment would use actual multi-step agent interactions. I would compare ordinary receipt-aware replanning with checks that retain the original task requirements across completed and remaining actions. I would measure valid task completion, unsafe proposals, blocked or executed violations, unnecessary stops and recovery cost. The evaluation would use fresh tasks, repeated paired runs and independent checks of final transaction outcomes.

Existing work already covers agent recovery, workflow enforcement and repair feedback. The research contribution therefore remains to be established. I would first investigate whether the observed problems persist in realistic agent tasks and whether existing methods already address them adequately. Those results would determine whether to develop a measurement study, investigate a further mechanism, or revise the direction.

See [the model findings](model-findings.md), [engineering findings](findings.md), and [experimental protocol](protocol.md) for the evidence and limitations.
