# External benchmark comparison: InvestorBench ETH task (step 2b)

This is follow-up work on the `step2-llm-benchmark` feature branch. Step 2a put our own harness around
the agent; this step measures the same policy against an external, published benchmark so the numbers
are anchored to something we did not design ourselves.

The benchmark is **InvestorBench** (repo `felis33/INVESTOR-BENCH`, arXiv:2412.18174, ACL 2025). It
evaluates LLM trading agents on several assets, one of which is an Ethereum (ETH-USD) task with open
price data and published per-model results. That crypto task is the natural fit for an ETH agent, so
it is the one we target here.

## What we ran, and what we did not

We did **not** run InvestorBench's own harness. It needs a multi-GPU VLLM server
(`tensor_parallel_size=2`), a Qdrant vector database, the FinMem memory agent, OpenAI embeddings, and a
HuggingFace token. None of that fits this environment. So instead of pretending to reproduce their
leaderboard, we did the honest alternative: **reproduce their ETH task protocol on their exact data,
and compare our policy to their published numbers.**

Concretely we used:
- **Their price series** (`data/eth.json` from the repo), extracted to `paper/data/eth_2023_investorbench.csv`.
- **Their test window**: 2023-04-03 to 2023-11-05 (186 daily returns), with 30 trailing days of warmup
  for our volatility estimate.
- **Their metric formulas, ported verbatim** from `src/eval_pipeline.py`: daily reward
  `r_i = action_i * ln(p_{i+1}/p_i)`; cumulative return `CR = sum(r_i)`; annualized volatility
  `AV = sample_std(r) * sqrt(365)`; Sharpe `= (CR * 252 / n_prices) / AV` (their code mixes a 252-day
  numerator with a 365-day volatility, and we mirror that exactly rather than "fixing" it); max
  drawdown over the running product of `(1 + r_i)`.

**Validation that the reproduction is faithful:** running buy-and-hold through this pipeline reproduces
InvestorBench's published ETH buy-and-hold to three decimals: CR 4.528%, SR 0.146, AV 41.817%,
MDD 29.889%. Since we did not tune anything to hit those, the exact match is evidence the window,
data, and formulas line up with theirs.

## Results

Test window 2023-04-03 to 2023-11-05. Our arms in **bold**; the rest are InvestorBench's published
Table 3 ETH numbers.

| Agent | CR (%) | Sharpe | Ann. vol (%) | Max DD (%) |
|---|---:|---:|---:|---:|
| Qwen2.5-72B (theirs) | 11.98 | 0.58 | 18.55 | 27.64 |
| Palmyra-Fin-70B (theirs) | 4.80 | 0.24 | 26.92 | 16.41 |
| GPT-4o (theirs) | 4.67 | 0.19 | 33.05 | 22.54 |
| **buy-and-hold (our repro)** | **4.53** | **0.15** | **41.82** | **29.89** |
| **ours vol-target** | **2.28** | **0.08** | **40.89** | **29.14** |
| GPT-4 (theirs) | 1.52 | 0.05 | 39.81 | 32.54 |
| **ours LLM gpt-4o-mini*** | **-11.70** | **-0.68** | **23.28** | **19.20** |
| Llama-3.1-70B (theirs) | -11.89 | -0.41 | 39.05 | 36.42 |

\* contamination-prone and handicapped; see the ledger below. Not a like-for-like model verdict.

![InvestorBench ETH comparison](figures/investorbench_eth.png)

## What we read from this

1. **Our deterministic policy lands mid-pack, and it is contamination-free.** On this window our
   volatility-targeted sizing returns 2.3% (Sharpe 0.08), between GPT-4 (1.5%) and buy-and-hold (4.5%),
   and it cuts drawdown slightly below buy-and-hold. The window was gently rising, so a policy whose
   whole job is to trim exposure when volatility spikes gives up a little upside; that is the expected
   cost of the guard in a calm-to-up regime, and it is the same trade-off step 2a showed paying off in
   a falling one. The point is not that we beat their best model. We didn't. It is that a simple,
   auditable, contamination-free rule sits in the same range as their proprietary LLM agents on their
   own task and metrics.

2. **Our small LLM agent lost money, and so did theirs.** gpt-4o-mini making daily buy/sell/hold calls
   from a price-only prompt returned -11.7%, almost exactly matching InvestorBench's own Llama-3.1-70B
   (-11.9%). Both of the worst results on the board are small-model directional agents. This lines up
   with InvestorBench's headline finding that smaller backbones struggle on this task, and with our
   step 2a read that a naive directional LLM is fragile without a risk layer around it. On this window
   our deterministic policy (2.3%) beat our own LLM agent (-11.7%) by a wide margin.

3. **The comparison is directional, not a leaderboard entry.** We are comparing on the same asset,
   window, and metric code, which is the honest core of it. But our LLM arm sees only prices, while
   their agents get news and a memory module. So the -11.7% is a floor on what a stripped-down agent
   does, not a fair measurement of gpt-4o-mini against their GPT-4o. The deterministic arm is the one
   to take seriously.

## Honesty ledger

**What matches InvestorBench (like-for-like):**
- Asset: ETH-USD, their exact price series (`data/eth.json`).
- Test window: 2023-04-03 to 2023-11-05, 30-day warmup.
- Cadence: one daily long/flat/short decision, next-day return.
- Metrics: their CR / AV / Sharpe / MDD formulas ported verbatim, including their 252-vs-365
  annualization mismatch. Verified by exact buy-and-hold reproduction.

**What differs (why this is not their leaderboard):**
- We did **not** run their harness (no VLLM / Qdrant / FinMem / embeddings). This is a
  protocol-and-data reproduction plus comparison to their published numbers.
- Our LLM arm is **price-only**. InvestorBench feeds its agents news headlines and a FinMem memory
  module; we omit both. That handicap alone can explain a large gap, so the LLM arm is not a model
  comparison.
- **Contamination.** The 2023 window predates the training cutoffs of gpt-4o-mini, so the LLM arm may
  be recalling the regime rather than reasoning from the prompt. InvestorBench's own LLM results share
  this limitation. Our **deterministic** arm has no such issue and is therefore the headline.
- Their published Sortino is not included here because we did not want to depend on a value we could
  not cross-check against their code; we report the four metrics their eval pipeline computes directly.

**Bottom line:** on an external benchmark's own ETH task, data, and metrics, our contamination-free
sizing policy performs comparably to published proprietary-LLM agents, while a stripped-down LLM agent
without their news and memory performs as poorly as their weakest backbone. That is a modest,
defensible claim, and it is the one the numbers support.

## Reproduce

```bash
git checkout step2-llm-benchmark
# offline: uses the committed price CSV + cached LLM decisions, no API key needed
bun run scripts/investorbench-eth.ts
python3 scripts/make-figure-external.py
```

To re-fetch the LLM arm instead of using the cache, set `OPENAI_API_KEY`; the buy-and-hold and
deterministic arms never call an API. Published InvestorBench numbers are hard-coded from their Table 3
in `scripts/investorbench-eth.ts` for side-by-side display.
