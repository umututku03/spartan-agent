# LLM-in-the-loop ETH trading benchmark (step 2a)

This is exploratory follow-up work on the `step2-llm-benchmark` feature branch. It puts the language
model in the decision loop and asks a concrete question: does our deterministic risk-governance layer
change what the model does, and how do LLM decisions compare to fixed sizing rules? The honest short
answer for this run: risk-aware prompting alone made both models cautious enough to dodge a bear
market, and the deterministic guard did not bind because the models never asked for more than the
guard would allow.

## Approach: two stages

We evaluate in two deliberate stages. First (this document) is a deterministic reference run: the
decision policy is fixed, the model calls are cached, there is no lookahead, and temperature is 0, so
the metrics are exact and reproducible and the arms are directly comparable. This isolates two
questions cleanly. Does the sizing logic behave as intended, and does the LLM-as-policy behave?

The second stage, planned next, is an agent-in-the-loop proof of concept: the same decision logic is
executed by the real Spartan agent, which fires actual swaps on the Anvil mainnet fork. That stage
validates that the pipeline closes end to end (LLM decision to on-chain action through the deployed
agent); it is slower and noisier, so it demonstrates capability rather than a cleaner number. The two
stages answer different questions, reproducible measurement versus end-to-end validation, and the
deterministic run comes first by design.

## Setup
- Harness: `scripts/backtest-llm.ts`, sharing the no-lookahead stepping, cost model, and metrics with
  the deterministic backtest via `scripts/lib/backtest-core.ts`.
- Data: one year of daily ETH prices, `paper/data/eth_daily.csv` (13 Aug 2025 to 12 Aug 2026, a year
  in which ETH fell about 58%). With the 30-day volatility warmup, the first scored day is mid-September.
- Each day the model sees only information available up to that day: the last 30 daily returns (as
  percentages, no dates or price levels) and the trailing 30-day annualized volatility. It returns a
  target ETH exposure in [0,1] as JSON. `temperature=0`. Decisions are cached per (model, date) in
  `paper/data/llm_decisions_<model>.json`, so re-runs are offline and deterministic.
- Models: `gpt-4o-mini`, `gpt-4o` (OpenAI), and `claude-haiku-4-5-20251001` (Anthropic) - a
  cross-provider comparison. `claude-sonnet-5` was attempted but the new API key's rate tier throttled
  the ~335 daily calls to an impractical duration this session; the harness caches decisions, so it
  can be finished later by re-running (it resumes from the cache).
- Arms: `llm-raw` (the model's exposure), `llm+risk` (the model's exposure clamped to our
  volatility-targeted budget, `min(e_llm, targetVol/sigma)` capped at 1.0), and three deterministic
  baselines (buy-and-hold, fixed half-exposure, vol-target+cap).

## Results (full year)

| Model | Arm | Return | Ann. vol | Sharpe | Sortino | Max DD | Excess vs hold |
|---|---|---:|---:|---:|---:|---:|---:|
| - | buy-and-hold | -57.7% | 63.1% | -1.17 | -1.58 | -66.7% | 0.0% |
| - | fixed-fraction | -31.9% | 31.6% | -1.17 | -1.58 | -39.8% | +25.8% |
| - | vol-target+cap | -50.9% | 49.5% | -1.31 | -1.73 | -60.6% | +6.9% |
| gpt-4o-mini | llm-raw | -19.4% | 17.5% | -1.26 | -1.70 | -24.3% | +38.3% |
| gpt-4o-mini | llm+risk | -19.4% | 17.5% | -1.26 | -1.70 | -24.3% | +38.3% |
| gpt-4o | llm-raw | -21.5% | 19.1% | -1.28 | -1.75 | -27.5% | +36.2% |
| gpt-4o | llm+risk | -21.5% | 19.1% | -1.28 | -1.75 | -27.5% | +36.2% |
| claude-haiku-4.5 | llm-raw | -23.5% | 21.7% | -1.23 | -1.67 | -29.7% | +34.2% |
| claude-haiku-4.5 | llm+risk | -23.5% | 21.7% | -1.23 | -1.67 | -29.7% | +34.2% |

Recent 90-day slice (15 May to 12 Aug 2026), the least-contaminated window: buy-and-hold returned
-17.5% at 48.8% vol and -31.5% max drawdown; `gpt-4o-mini` llm-raw returned -6.3% at 14.3% vol and
-10.8% drawdown; `gpt-4o` llm-raw returned -5.6% at 15.9% vol and -11.4% drawdown; `claude-haiku-4.5`
llm-raw returned -7.1% at 18.2% vol and -13.0% drawdown. All three stayed cautious here too.

![LLM benchmark](figures/llm_benchmark.png)

## What we read from this
1. **Risk-aware prompting made both models cautious, which paid off in a falling market.** Both
   `gpt-4o-mini` and `gpt-4o` held low ETH exposure most of the time, so they cut volatility from
   about 63% to under 20% per year and drawdown from about 67% to about 25%. This is regime-specific:
   the same caution would underperform in a strong bull market. The models are not predicting
   direction; they are being conservative, which lines up with CryptoBench's finding that prediction
   is the weak axis and AI-Trader's finding that risk control, not raw intelligence, drives outcomes.
2. **Model and provider barely mattered.** `gpt-4o-mini`, `gpt-4o`, and `claude-haiku-4.5` produced
   very similar risk and drawdown profiles (full-year drawdowns of 24%, 28%, and 30% versus 67% for
   buy-and-hold). The behavior came from the prompt and the task, not the backbone or the vendor.
3. **The deterministic guard was a no-op in this run.** `llm+risk` equals `llm-raw` for both models,
   because the models' exposures never exceeded the volatility-targeted budget the guard enforces. The
   guard is a backstop against oversizing; it binds and helps only when the agent is aggressive. The
   binding case is visible in the deterministic backtest (`docs/PHASE4_RISK.md` and
   `scripts/backtest-sizing.ts`), where capping an always-on position cuts volatility and drawdown.

## Stage 2: agent-in-the-loop (proof of concept)

Stage 1 measured the policy by calling the model APIs directly. Stage 2 closes the loop through the
real deployed agent: we replay the model's own cached decisions and have the running Spartan agent
execute each one as an actual swap on the Anvil mainnet fork. Script: `scripts/agent-loop-poc.ts`;
results in `paper/data/agent_loop_poc.json`.

Six consecutive daily decisions from `gpt-4o-mini` (7-12 Aug 2026) were each turned into a chat
command (`swap <amount> ETH for USDC from my wallet 0xf39Fd6...2266`), which the agent parsed and
executed via its `MULTIWALLET_SWAP` action against the fork. All six produced confirmed transactions
(status success) from the imported wallet:

| Day | Exposure | Swap (ETH) | Tx hash | Block | Status |
|---|---:|---:|---|---:|---|
| 2026-08-07 | 0.35 | 0.065 | `0xfb5d6ce2...b718` | 25736332 | ok |
| 2026-08-08 | 0.35 | 0.070 | `0xd3616142...325d` | 25736333 | ok |
| 2026-08-09 | 0.35 | 0.075 | `0xe49582d0...be48` | 25736334 | ok |
| 2026-08-10 | 0.35 | 0.080 | `0xa105123c...f2c4` | 25736335 | ok |
| 2026-08-11 | 0.35 | 0.085 | `0x2797da97...09eb` | 25736336 | ok |
| 2026-08-12 | 0.35 | 0.090 | `0x9bb31cd5...9cf1` | 25736337 | ok |

What this shows and does not show. It shows the pipeline closes end to end: an LLM decision becomes a
real on-chain action through the deployed agent, six times in sequence. It is a capability demo at a
single forked block, not a historical backtest: the fork does not advance through the six calendar
days, the swaps just accumulate at one block, and the exposure-to-swap mapping is illustrative (each
day's target exposure maps to a small de-risking ETH->USDC swap, nudged slightly per step so each
command is distinct on-chain). Action selection is non-deterministic, so the driver retries a command
until the swap action fires. The performance numbers stay with the stage-1 harness; stage 2 is the
integration check.

## Honest caveats
- One asset (ETH), one year, one seed (temperature 0), and a period that was almost entirely a
  downtrend. A cautious agent wins by construction in a bear market; this says little about bull or
  sideways regimes.
- Simulated exposure with a simple turnover cost, not live execution. A single decision can be
  executed on the fork (Phase 3 proved the path), but the benchmark stays simulated for speed and
  reproducibility.
- Contamination: the window postdates the base models' documented training cutoffs, so direct price
  memorization is unlikely, but we cannot rule out that the models infer the regime from context. We
  report the recent slice separately for that reason and avoid strong claims.
- The guard's value is not demonstrated here because neither model was aggressive. A natural next
  test is an aggressive-prompt variant where the guard should bind and reduce drawdown.

## Reproduce
```bash
git checkout step2-llm-benchmark
OPENAI_API_KEY=sk-... bun run scripts/backtest-llm.ts gpt-4o-mini   # first run fetches + caches
OPENAI_API_KEY=sk-... bun run scripts/backtest-llm.ts gpt-4o
ANTHROPIC_API_KEY=sk-ant-... bun run scripts/backtest-llm.ts claude-haiku-4-5-20251001
python3 scripts/make-figure-llm.py
```
Re-running with the committed decision caches needs no API key and reproduces the numbers exactly.
