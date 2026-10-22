# Continuation plan: two additional model variants

Status: **PLAN ONLY. Do not run experiments or model API requests until the user explicitly resumes execution.** Written 21 October 2026 local time, after commit `0848c73`. The subsequent user request names Opus 5.5 through their Claude subscription; use that as the additional Claude variant, rather than adding both Sonnet and Opus.

## Current evidence and workspace

Repository: `/Users/utkueumut/Desktop/utku/apps-projects/defi/spartan-agent`.
Experiment folder: `research/recovery-experiments-20261021`.
Branch: `research/recovery-experiments-20261021`; origin `git@github.com:umututku03/spartan-agent.git`.

Read `cross-model-findings.md`, `research-proposal.md`, `agent-claude-protocol.md` and `novelty-check.md` before designing the next study. The existing `.env` contains OpenAI and Anthropic keys; it is ignored and must not be printed, uploaded or committed. No new credentials should be needed for the planned API provider. The existing agent is a bounded decision/action driver on an actual local EVM, using a Spartan helper body; the full Eliza/Spartan application has not been booted.

In the matched eight-round cohorts, GPT-6 Luna resolved 7/8 episodes and Claude Haiku 5.5 resolved 8/8. Each produced one reserve-breaking proposal, blocked by the same guard. Only Luna executed a cash trade with minimum DAI lowered to 45, leaving the original 50 DAI task unmet. Each deterministic cohort resolved all four fixtures. Records have no demonstrated consistent advantage. Earlier five-round and interrupted runs are preserved separately, not pooled.

Current cumulative estimated **API** spend: US$0.0337477, including US$0.0011996 of unknown-charge reservations. Current authorized local cumulative estimate cap: US$0.10. Do not silently raise it. Keys being present does not override the user's instruction to plan only.

## Model choices

1. **Claude Opus 5.5 (`claude-opus-5-5`)**, through normal Claude Code subscription use if the user's account supports it. Verify subscription authentication and actual model via Claude Code status. The coding agent can implement the harness; its planner must itself choose each experimental action. Running the existing Haiku API script from Opus would still test Haiku and incur API charges. Never describe that as an Opus subscription experiment.
2. **OpenAI GPT-6.1 Sol (`gpt-6.1-sol`)**, using the existing OpenAI API setup, later and only after the budget is settled. It provides an additional, more capable OpenAI variant beyond Luna. Official short-context Standard prices checked during planning: $2/M input and $10/M output. Use Responses API tool calls and supported low reasoning; `none` is unsupported.

These produce four tested model configurations across two providers, not four independent provider families. Model, reasoning mode, runtime and tool interface are potential confounds. Do not promise a ranking from one repetition per cell.

Official references:
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5
- https://support.claude.com/en/articles/11940350-claude-code-model-configuration
- https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan

## Freeze before collecting new data

Reuse the exact original task, four scenarios, numerical fixtures, two conditions, tools, guard policies and eight domain-action rounds from the completed eight-round manifest. Plan eight LLM episodes per model: one history and one task_record episode for each family, plus four scripted deterministic controls per execution route. Thus the initial expansion would add sixteen model episodes and eight control episodes. Retain the previous condition order; predeclare the order of model cohorts. This is developmental replication on known cases, not a new held-out benchmark.

Freeze and hash a new protocol, adapter, model/reasoning configuration, tool interface and scoring before any experimental action. Preserve every prior artifact. New result directories should be descriptive, e.g. `agent-opus-subscription-results` and `agent-sol-results`, with refusal to overwrite. Keep external Opus implementation changes in new files or an isolated branch so current code hashes remain valid.

Opus 5.5 cannot simply inherit Haiku's configuration: its API does not support disabled thinking or forced `tool_choice:any`. Its subscription runtime also adds system instructions and tool handling. Verify the available normal Claude Code controls, declare the actual settings, and classify this as a separate runtime/model replication. Do not force artificial parity by using unsupported parameters. Never extract subscription tokens or call private OAuth endpoints to imitate an API service.

For Sol, plan low reasoning and a bounded output budget that includes reasoning. A prospective ceiling is 2,048 output tokens per request, eight rounds and 64 requests. Validate the model's requirements offline/documentation-first; do not silently retry an exhausted or truncated response with more tokens. The old 256-token, no-reasoning condition is not equivalent. Report that difference and classify format/refusal/truncation failures separately from agent decisions.

## Subscription experiment integrity

A normal chat without repository, terminal and persistent local-chain access cannot claim to execute the experiment. Use Claude Code if available; otherwise Opus can review files and prepare a protocol, but results remain unrun.

Build a small local bridge around the existing environment that exposes only inspect, quote, sell_eth, receipt, swap_cash and finish. Keep the EVM alive across calls. The experiment controller privately owns reset, fixtures, ground truth and trace export. Domain-action attempts, including invalid/non-tool responses, need a predeclared round-counting rule. Do not count coding commands as agent-domain actions or give the planner unrestricted shell access to bypass the tool boundary.

Keep harness development and evaluation separate. Start every planner trial with a genuinely fresh context containing only the original task, allowed tool schemas, initial observation, the appropriate condition information and subsequent observed results. The planner must not inherit the developer conversation, previous findings, scenario IDs, feasibility labels, evaluator code or deterministic solution. A restricted working directory alone is insufficient if the planner inherited this conversation. If such separation cannot be verified using supported Claude Code features, stop the blinded experiment and report the limitation; a manual run can only be labelled an unblinded demonstration.

Save actual planner output, tool arguments/results, matched call IDs, complete action traces, receipts, balances and stop reason. Store actual model identity/settings and subscription usage metadata where exposed. Do not invent unavailable token/cost fields or report subscription usage as free/unlimited. No parallel blind trials against one shared EVM instance; use sequential resets or separate instances.

## Budget gate for later execution

The two stronger variants must not be assumed to cost the same as the first screen. For Sol alone, the conservative byte-based reservation at 10,240 input bytes plus 512 overhead tokens and 2,048 output tokens is:

`64 × (((10240 + 512) × $2 + 2048 × $10) / 1,000,000) = US$2.686976`.

This is a worst-case reservation, not an expected bill; it already exceeds the current US$0.10 cap. A possible proposed cumulative cap is US$3 for the Sol cohort, but **that increase is not authorized**. Recompute against current official pricing and the actual final configuration before requesting any later budget decision. Do not change `.env` during planning. Opus subscription usage has account limits; do not switch to paid API fallback or extra usage. API-based Opus is a different, separately priced proposal, not an automatic alternative.

## Outcomes and validation

Retain independent completion/infeasibility scoring and integer token/pool replay. Separately report goal balances, truthful finish, unsafe proposals, blocks, executed reserve violations, executed non-completing trades, unnecessary stops and resource exhaustion. A minimum below 50 on an intermediate swap is not automatically a violation: inspect the complete task and whether a valid continuation remains.

Audit that fixtures, user task, policies and shared tool contents match the previous study. Validate receipt ambiguity and no invented confirmation before live use. Preserve errors, incomplete episodes, outgoing requests when applicable and protocol deviations. Do not retry until success, substitute models, tune prompts after results or turn repeated tool calls into independent samples. Where subscription metadata cannot be verified, state the limitation rather than manufacture an API-style manifest.

For the later handoff, require `report.md`, `manifest-before.json`, `episodes.json`, receipt/action logs, `summary.json`, and either `complete.json` or `run-error.json` in the new results directory. Include source files and a human-readable deviations section. No `.env`, keys or account tokens. Codex should audit these artifacts and actual traces before incorporating external counts.

## Discussion after the two variants

Stop further model collection after the initial expansion and discuss:

- Whether errors persist in more capable configurations, and which are blocked versus executed.
- Whether resource limits, reasoning or runtime explain the differences; do not attribute effects solely to model size or records.
- Whether the real contribution could be a measurement of task-level requirement preservation, rather than another summary/guard architecture.
- Whether existing goal-aware workflow checks and conventional solvers already address the observed cases. If so, revise the method claim.
- Whether to implement actual Spartan workflows with distinct task structures, matched controls without faults, fresh evaluation families and predefined repetitions.

The current strongest recommendation remains: do not present the task record as a novel effective solution. Additional models can test the scope of the observation; they cannot establish novelty on their own.
