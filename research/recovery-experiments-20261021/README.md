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
