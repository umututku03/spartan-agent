# Native-tool closed-loop pilot

Exploratory amendment written after observing formatting failures in the plain-JSON agent loop, before any native-tool requests. Preserve the earlier run as an interface diagnostic. It must not be counted as evidence that transaction recovery itself fails.

Use the same environment, four fixed scenario families, two conditions, and two repetitions as the original closed-loop protocol. Both conditions now use provider-native strict function schemas, require one tool per response, and disable parallel tool calls. Carry the real function-call IDs and function outputs in the model conversation. The state record uses the same visible observations available to the ordinary history condition. No evaluator labels or future events are exposed.

Allow five rounds per episode rather than six, so the worst-case reservation for sixteen episodes fits the same cumulative $0.10 estimate cap after the interface diagnostic. Five rounds accommodate sell, receipt if needed, quote, swap and truthful finish; controllers may use fewer or allocate rounds differently. This is not a controlled estimate of native-tool versus plain-JSON effect because the interface and round budget change together. The controlled comparison remains history versus task_record within this native run.

No prompt tuning occurs after native evaluation begins. The fixed prior case families make this developmental evidence, not a fresh held-out benchmark. Record incorrect arguments, rejected proposals, outcomes and budget exhaustion separately. A strict schema guarantees an allowed call shape; it does not guarantee the selected amounts or decisions satisfy the user's goal.

Use GPT-6 Luna, reasoning none, 256 output tokens, no retries/fallback. Include tool schemas and conversation in the 8,000-byte input bound, reserve 512 additional provider input tokens, and charge earlier settled usage before every request. Refuse the study if the worst-case eighty-call reservation plus prior usage exceeds the existing $0.10 estimate cap. Report the actual usage returned by the provider.

The environment conformance checks remain applicable. Hash this protocol, controller and environment before the first native call. Save every native request/response, tool output, receipt and final goal check. Novelty assessment must consider existing transactional runtimes, checkpoint enforcement, replay-or-fork controls and validity-guided recovery; no new method is presumed.

Official implementation reference: https://developers.openai.com/api/docs/guides/function-calling (strict schemas, required tool choice and disabling parallel calls), checked 21 October 2026.
