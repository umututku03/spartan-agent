# Native-tool replication after transport interruption

Written before the replication requests. Preserve both earlier incomplete runs. The plain-JSON run stopped on HTTP 400 and is not retried. The first native-tool run stopped on a 60-second transport timeout at call 12; its third LLM episode is incomplete. Keep its unknown-charge reservation in the cumulative budget.

Start a separately labelled fresh cohort: the same four deterministic cases and sixteen LLM episodes, same five-round limit, prompts, model, tool schemas, condition order and environment as agent-native-protocol.md. The sole execution change is a 120-second timeout. Save each outgoing payload before transmission, excluding credentials. There are no per-request retries or model fallbacks. This is an operational replication, not a new independent task distribution. Do not pool partial earlier episodes into the primary counts, or omit the interruptions from reporting.

Charge all earlier usage and outstanding conservative reservations from agent-native-results/budget-ledger.json. The eighty-call worst-case reservation must still fit the cumulative US$0.10 estimate cap. A completed balance goal and an explicit truthful finish are separate endpoints; report round-budget exhaustion rather than treating it as an unsafe execution. No prompt or policy changes after observing the new results.
