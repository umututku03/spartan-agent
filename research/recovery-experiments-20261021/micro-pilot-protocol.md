# Model micro-pilot: development screening only

This is a separate, inexpensive development screen. It is not an agent benchmark or a confirmatory experiment. No model API calls have been made when this protocol is written. The existing 171 local-EVM episodes have already been inspected.

Six hand-designed decision cases cover an unresolved submission, a settled first action, a feasible change in price, an infeasible remaining task, an external cash reduction, and a task already completed. Each has a natural-language task, the visible state and a small menu of actions. A deterministic answer key is kept outside the request payload. Case construction is explicitly informed by the engineering experiments and is not a held-out test set.

Send each case once in each of two representations: original JSON records and a labeled text record containing the same facts and action menu. The task, action menu, model, API settings and output cap remain identical. Only presentation changes. Alternate representation order between cases to avoid complete confounding with run order. Twelve requests is the entire first run. No repetitions or population-level uncertainty claims are justified from this screen. Its purpose is to check the adapter and identify error types for a later interactive study.

Use `gpt-6-luna`, the standard OpenAI Responses endpoint, reasoning effort `none`, and at most 256 output tokens. Do not silently substitute another model, change settings after a poor response, or automatically retry a failed request. Retain usage, response model, request ID, status and complete response text. Treat invalid JSON, unknown options, refusals, incomplete output and API failures as separate outcomes. Do not remove them from the run.

Budget: at most 12 requests, at most 8,000 UTF-8 prompt bytes per request, and reserve $0.005 from a local $0.10 estimate budget before every request. At the documented standard prices of $0.10/M input tokens and $0.50/M output tokens, this small run is expected to cost less than one US cent; the reservation is deliberately much larger. This is a local estimate guard, not a provider billing limit. No background tools, paid searches, automatic retries or fallback models are enabled. Use the existing API balance; this protocol does not require adding $5 of credits. Stop on authentication, credit or model-access errors rather than trying other paid services.

Cost/model references checked 21 October 2026:
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/pricing

The later interactive evaluation remains subject to a fresh protocol, development/test grouping, repeated paired episodes and stronger recovery baselines. Success on these six choices would not establish reliable autonomous execution; failure would motivate investigation, not establish a general model ranking.
