# Codex review of the proposed Opus / Sol API replication

21 October 2026 local time. Review only: **no paid requests and no live experiments executed**. Original implementation and dry-run artifacts were left unchanged. API protocol remains unapproved for paid execution. No experimental API results for either new model were found during this review.

## Verdict

The documented provider differences and no-fallback policy are sensible. Both original dry-run folders pass the supplied Python audit, and all 11 adapter tests pass (seven new plus four previous). However, the independent audit has material provenance and accounting gaps. Resolve these before trusting new paid results. The successful five tampering checks reported by Opus do not cover the cases below.

`review-api-verifier.py` independently reproduces six additional mutations against temporary copies of the Opus dry-run fixtures. The existing verifier accepted all six. These are demonstrated audit gaps, not evidence that the original harness actually manufactured observations, leaked labels or misstated real charges.

## Required corrections

### 1. Link the complete request → response → executed action → next observation chain

`verify-api-replication-results.py:104` checks action counts, and its loop at line 111 binds `step` but never compares it with the model trace. It validates model output against `parsedAction` and independently replays `toolTrace`, without proving they describe the same executed action/result. Changing a recorded executed swap minimum to 49 while the corresponding model call remains 50, and updating the local receipt metadata, is accepted.

The blinding check only validates field names and forbidden terms; it does not establish that visible values came from the actual task and preceding execution. Consistently changing the first planner observation to an invented cash balance of 999 is accepted. Adding a fabricated task record to every history-condition request is also accepted.

Required: reconstruct every request from the frozen task, condition, prior exact responses and recorded actual tool results, under the declared envelope. Check exact action/argument/result/observation equality, call IDs and receipt correspondence; original requirement values; record presence only in task_record; record contents derived from visible state; rounds remaining; initial observation; and assistant replay. A term/field allow-list is an additional label screen, not a substitute for provenance.

### 2. Reconcile each budget entry with the corresponding returned usage

`verify-api-replication-results.py:91` sums ledger figures, while line 124 separately prices model-trace usage. It never equates the individual ledger entries with those usage-derived costs. Setting every settled ledger cost to zero and cumulative usage to its prior amount passes. Check per-call identity, state, reservation formula, actual payload byte calculation, usage, pricing and settlement delta, plus the prior-ledger link and both approved caps. Do not trust recorded byte counts alone.

Also fix `run-api-replication.ts:161`: known usage is checked against its reservation assumptions before the ledger is settled. If returned valid usage exceeds the bound, the run stops retaining the reservation, potentially understating the known cost. Account for known usage first, then flag the exceeded assumption/cap and stop before another request. Unknown transport charges remain separately reserved. This needs a deliberately over-bound mock test.

### 3. Preserve and audit interrupted episodes and every attempted request

`run-api-replication.ts:179` appends an episode only after its loop returns normally. HTTP/transport/blinding/budget exceptions bypass that append, losing the current episode's in-memory successful trace and tool history. Request/response files may survive, but are not sufficient for the claimed complete outcome trace.

Persist in-progress episode state after each action and on the failure path, including current balances/receipts and a clear fatal termination. The verifier must enumerate all ledger/request/response artifacts, handle unknown-response transport attempts explicitly and reject unexplained orphan/missing/duplicate entries. Currently it visits requests only through completed episode traces: an orphan failed request containing a private scenario label is accepted, contradicting the stated check of every request.

### 4. Validate completion markers and cohort coverage

`verify-api-replication-results.py:133` treats complete.json's existence as completion without validating its contents. A marker claiming 999 episodes with all filesUnchanged flags false passes. Verify frozen hashes against the actual source and reference contract/helper, exact planned IDs/order and repetition counts, uniqueness, expected controls, attempt limits, completion/error consistency and all declared unchanged flags. Preserve partial-run coverage without calling it a completed cohort.

### 5. Correct comparison wording and clarify the cost proposal

Sol versus Luna does not isolate only model plus reasoning: output limits, replayed reasoning, visible-input limits and caching policy also differ. Describe these as comparisons of complete configurations. Opus's immutable history additionally retains previous continuation/task-record text. An apparent task-record effect would need a future matched-history/control study; do not change this developmental cohort post hoc and call it causal.

The saved US$1.53 central cost is an assumption-driven scenario, not measured new-model usage or a guaranteed price. The high scenario is about US$3.90 and the conservative full-study reservation about US$12.65. A US$2 additional-spend proposal can require an explicitly labelled partial study; it does not guarantee sixteen completed model episodes. No budget increase has been approved in this review.

## API compatibility review

Official OpenAI documentation supports explicit caching mode without breakpoints as disabling cache reads/writes, and documents required tool selection in the Responses API. These settings have documentation support; account/model acceptance of the exact combined payload remains untested. Do not describe an offline mock as endpoint validation and do not make an unapproved paid compatibility call.

References checked during review:
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://developers.openai.com/api/docs/guides/function-calling

## Acceptance before paid execution

Ask Opus to fix the above in a new revision, preserve the old dry-run record or a clearly identified copy, and regenerate hashes and offline fixtures. Require all existing positive tests plus rejection of the six mutations, tests for invalid-response continuation and fatal-error partial persistence, per-call ledger reconciliation and the known-usage-over-reservation path. Codex can then re-audit. The user still needs to explicitly authorize any revised budget and paid execution; this review authorizes neither.
