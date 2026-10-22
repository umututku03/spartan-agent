# Novelty boundaries for the agent-recovery direction

Checked 21 October 2026. This is a targeted comparison accompanying exploratory experiments, not an exhaustive novelty proof. Experiments can reveal a failure or boundary; they cannot establish the absence of a prior solution.

| Closest work | What it already addresses | Consequence for our claim |
|---|---|---|
| PACE, August 2026 preprint | Deterministic authorization of typed DeFi intents, bound to execution bytes, with limits concerning subsequent economic state | Separating the LLM from approval or adding a transaction record is insufficient differentiation. |
| CheckpointAgent, author manuscript marked IEEE Access accepted | Checks within multi-step DeFi workflows, including on-chain and attested predicates and iterative correction | A claim that earlier systems only check isolated actions would be incorrect. Compare equivalent predicates and assumptions. |
| Cordon, June 2026 preprint | Task-level transactional boundaries, staged effects, validation and recovery metadata | Task-level execution boundaries and delayed commitment are established concepts in agent research. |
| ACRFence, March 2026 preprint | Regenerated actions after restore can bypass request-identity duplicate detection; proposes semantic replay-or-fork handling | Regeneration after an irreversible effect is already an explicit research problem. Its mitigation is proposed rather than implemented in that paper, which is an evaluation opportunity but does not make the concept new. |
| REVISE, September 2026 preprint | Dependency-based invalidation/reuse of partially completed workflows and revalidation before commit | Checking validity during recovery, retaining unaffected work, and revalidating before effects are committed are existing approaches. |
| Resume Means Resume, August 2026 preprint | Formal properties and pinned-framework measurements of interruption, persistence and repeated effects | Exactly-once and resume-semantics testing already have detailed systems precedents. |
| Structured Feedback Improves Repair, July 2026 preprint | Tests informative repair feedback against raw diagnostics and representation controls | A status-summary ablation needs a narrower substantive finding; formatting a record alone is a weak novelty claim. |

## What the current experiments can decide

The deterministic experiments establish baselines for this prototype. The model screens motivate testing actual tool behavior rather than trusting explanations. The native-tool loop tests whether failures persist after serialization is addressed, and whether a task record changes behavior under identical guards. None of these alone establishes a new enforcement algorithm.

A defensible next contribution could be a scoped empirical study of task-level requirement preservation during recovery, if it reveals a reproducible limitation that existing evaluations and protections do not already cover. It would need several independently verified task structures, meaningful conventional baselines, fresh evaluation cases, resource sensitivity and enough models or repetitions to bound the claim. A new-method claim requires an additional mechanism and a comparison under equivalent policies; an ordinary guard plus ordinary resizing is not sufficient.

The exact predicate matters: a user may constrain total ETH sold, the final DAI amount, a cash reserve and allowed action order. Individual transaction success does not establish that this combined task was completed. Before proposing a new architecture, determine whether existing workflow predicates already encode these requirements. If they do, focus on a substantive measurement result or change direction.

## Primary sources

- Karanjai et al. [PACE](https://arxiv.org/html/2608.17220v1), preprint.
- Lee. [Checkpointed DeFi Agents with On-Chain Accountability and Early Policy Enforcement](https://www.researchgate.net/publication/408569712_Checkpointed_DeFi_Agents_with_On-Chain_Accountability_and_Early_Policy_Enforcement), author-uploaded accepted manuscript; publisher metadata not independently rechecked here.
- Chen et al. [Cordon](https://arxiv.org/html/2606.17573v1), preprint.
- Zheng et al. [ACRFence](https://arxiv.org/html/2603.20625v1), Sections 3–6, including its implementation limitation.
- Qi et al. [REVISE](https://arxiv.org/html/2609.00643v1), Sections 3–4, including its in-process boundary.
- Khan. [Resume Means Resume](https://arxiv.org/abs/2608.03836), v3; abstract-level inspection for this additional comparison.
- Ray and Goyal. [Structured Feedback Improves Repair in an LLM Agent Loop](https://arxiv.org/html/2607.14167v1), preprint.
