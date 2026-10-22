# DeFi agent recovery: exploratory experiments

This folder contains three reproducible local-EVM experiments and a separate optional low-cost model decision screen. Start with [findings.md](findings.md), then [protocol.md](protocol.md). The conventional baselines solve the scoped recovery cases; no novel AI method is claimed.

## Completed experiments

- 171 synthetic local-chain episodes; no LLM or mainnet calls.
- Exact source function extracted from `src/plugins/multiwallet/utils/ethereum.ts`; checksums in the run manifest.
- Results: [summary.csv](results/summary.csv), [episodes.json](results/episodes.json), [traces.json](results/traces.json), and [transactions.json](results/transactions.json).
- [amendments.md](amendments.md) records the sandbox failure and harness improvements. Prior completed runs remain available for comparison.
- CSC490 connections and the distinction between exploratory and later evaluation data are documented in the protocol.

## Reproduce the local-EVM run

Requirements: Bun, Node/npm and a supported Anvil platform. The project-wide agent dependency tree is not needed.

```sh
cd research/recovery-experiments-20261021
npm ci --no-audit --no-fund
# Preserve the shipped results before rerunning. Choose a new archive name if it exists.
mv results results-published
bun run-experiments.ts ../../src/plugins/multiwallet/utils/ethereum.ts
```

The runner starts a fresh local node on 127.0.0.1:18547 and stops it on exit. No funded wallet or RPC subscription is used. Do not point it at a public chain. The read-only manifest can be checked against the files before a rerun. Reruns are deterministic robustness checks, not new independent trials.

## Configure the inexpensive model screen

Use the existing OpenAI API balance. Only an OpenAI key is needed for the first screen; Claude is deferred. The selected model is `gpt-6-luna`, standard Responses endpoint, reasoning `none`, at most 12 requests and 256 output tokens per request. Expected usage is below US$0.01 at the documented rates; the script reserves US$0.06 and enforces a US$0.10 local estimate cap. This is not a provider billing limit. Pricing reference: https://developers.openai.com/api/docs/models/gpt-6-luna.

1. Open https://platform.openai.com/api-keys and create a project API key if you do not already have one. No need to add credits just to configure the file.
2. From this folder, copy the example without overwriting an existing file:

   ```sh
   cp -n .env.example .env
   chmod 600 .env
   ```

3. Open `.env` in your editor. Fill only the value after `OPENAI_API_KEY=` with your key. The complete file should have these settings:

   ```dotenv
   OPENAI_BASE_URL=https://api.openai.com/v1
   OPENAI_MODEL=gpt-6-luna
   OPENAI_API_KEY=YOUR_KEY_GOES_HERE
   MAX_PILOT_USD=0.10
   MAX_API_REQUESTS=12
   MAX_OUTPUT_TOKENS=256
   OPENAI_REASONING_EFFORT=none
   ```

4. Validate configuration without making a model request:

   ```sh
   bun --env-file=.env run-micro-pilot.ts
   ```

   Expected output includes `mode: dry-run` and `apiCallsMade: 0`. This checks configuration, not whether your key has credit or model access.
5. Once configured, tell the research collaborator. The live command is:

   ```sh
   bun --env-file=.env run-micro-pilot.ts --live
   ```

   It makes at most 12 calls, has no automatic retries or fallback model, and stops on API errors. The default command is always an offline dry run. Results are saved in `model-results`; an existing results directory prevents accidental reruns.

The key stays in the ignored `.env` file. Keep `.env.example` free of credentials. See [micro-pilot-protocol.md](micro-pilot-protocol.md): these six hand-designed development cases are a decision screen, not a held-out test or an autonomous-agent benchmark.

## Completed model pilot

See [model-findings.md](model-findings.md) for the 24-request developmental screen and the local replay of one recorded proposal. All calls used GPT-6 Luna; total estimated usage was approximately US$0.0011. This does not establish a general model error rate or a new method. The inexpensive setup above remains available for reproducing the original screen in a newly labeled results directory.

The follow-up is documented in [followup-model-protocol.md](followup-model-protocol.md). Run its offline configuration check with `bun --env-file=.env run-followup-screen.ts`; its live mode refuses to overwrite existing results. After `npm ci`, the local replay can be repeated with `bun replay-model-actions.ts`. It makes no model API calls and uses a fresh local EVM.


## Closed-loop agent studies

Read [agent-findings.md](agent-findings.md) first: 24 LLM episodes and eight deterministic controls in two completed cohorts, with both interrupted collection attempts retained separately. The agent autonomously chooses tools and executes local-chain transactions; the full Eliza/Spartan server is not booted. [research-proposal.md](research-proposal.md) is the updated short discussion draft. [novelty-check.md](novelty-check.md) records the closest overlaps and limits on the contribution claim.

Protocols were saved before their respective requests: [original interface diagnostic](agent-loop-protocol.md), [native tools](agent-native-protocol.md), [transport replication](agent-native-replication-protocol.md), and [eight-round resource sensitivity](agent-budget-sensitivity-protocol.md). The common environment is `agent-environment.ts`; controller and protocol hashes are recorded in each results manifest. The first two results directories are incomplete and must not be pooled into the completed cohorts.

Audit the recorded native runs offline without a key or API calls:

```sh
python3 verify-agent-results.py
```

After `npm ci` in this experiment folder, scripted local-chain conformance can be run with `bun agent-conformance.ts`. It makes no model requests. The native runners default to offline configuration/budget checks:

```sh
bun --env-file=.env run-native-replication.ts
bun --env-file=.env run-agent-budget-sensitivity.ts
```

Do not add `--live` to rerun the existing artifacts: the runners refuse to overwrite them. A fresh experiment needs a labelled results path, an updated cumulative ledger reference and a protocol saved before requests. The five-round protocol permits up to 80 calls; the sensitivity protocol permits up to 64, both under the same cumulative US$0.10 estimate cap. These are separate studies from the original 12-call static screens. No per-request retries or fallback models are used. Unknown-charge requests retain their budget reservation. No further credit purchase is needed for reviewing or auditing these saved results.


## Claude comparison setup

The prepared second-provider screen uses Claude Haiku 5.5, the same eight-round task/prompt/guards and eight LLM episodes plus four deterministic controls. See [agent-claude-protocol.md](agent-claude-protocol.md) for the fixed comparison and decision rules. The completed run is saved in `agent-claude-results`, with eight LLM episodes, four controls and 47 model requests. See [cross-model-findings.md](cross-model-findings.md) for the comparison and decision: Claude resolved all episodes, but one reserve-breaking proposal was blocked; the executed DAI-goal reduction did not replicate. Claude usage was approximately US$0.0109 and cumulative estimated spend approximately US$0.0337. Do not infer novelty or provider superiority from this small screen.

Open the existing ignored configuration file on macOS:

```sh
open -a TextEdit "/Users/utkueumut/Desktop/utku/apps-projects/defi/spartan-agent/research/recovery-experiments-20261021/.env"
```

Add only `ANTHROPIC_API_KEY=YOUR_KEY_HERE`, replacing the placeholder locally, and save. Preserve the existing settings. The runner defaults to `ANTHROPIC_MODEL=claude-haiku-5-5` and `ANTHROPIC_BASE_URL=https://api.anthropic.com`, so neither is required in `.env`. Do not paste a secret into chat or copy `.env.example` over a configured `.env`. If needed, create a key in the [Claude Console](https://platform.claude.com/settings/keys).

Offline checks from this experiment folder after installing its dependencies:

```sh
bun test claude-agent-client.test.ts
bun --env-file=.env run-claude-agent.ts
```

The dry run reports `keyConfigured` without showing the key and makes zero API calls. Live execution uses `bun --env-file=.env run-claude-agent.ts --live`, refuses to overwrite prior results, allows up to 64 requests with no per-request retries/fallbacks, and retains the cumulative US$0.10 estimate cap across providers. The initial worst-case cumulative reservation is US$0.0998479; typical usage should be much smaller. A dry run does not validate account credit or model access. Review the saved results with `python3 verify-agent-results.py`.

Reproduce the matched eight-round comparison offline with `python3 compare-model-results.py`. It checks shared task/environment/schema contents before reporting counts and submitted cash trades. Saved outputs are in `cross-model-comparison.json` and `agent-audit.json`; no API calls are needed to inspect or verify the evidence.
