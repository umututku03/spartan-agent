# LLM-in-the-loop ETH trading benchmark (step 2a)

This is exploratory follow-up work on the `step2-llm-benchmark` feature branch. It puts the language
model in the decision loop and asks a concrete question: does our deterministic risk-governance layer
change what the model does, and how do LLM decisions compare to fixed sizing rules? The honest short
answer for this run: risk-aware prompting alone made both models cautious enough to dodge a bear
market, and the deterministic guard did not bind because the models never asked for more than the
guard would allow.

## Setup
- Harness: `scripts/backtest-llm.ts`, sharing the no-lookahead stepping, cost model, and metrics with
  the deterministic backtest via `scripts/lib/backtest-core.ts`.
- Data: one year of daily ETH prices, `paper/data/eth_daily.csv` (12 Sep 2025 to 12 Aug 2026, a year
  in which ETH fell about 58%).
- Each day the model sees only information available up to that day: the last 30 daily returns (as
  percentages, no dates or price levels) and the trailing 30-day annualized volatility. It returns a
  target ETH exposure in [0,1] as JSON. `temperature=0`. Decisions are cached per (model, date) in
  `paper/data/llm_decisions_<model>.json`, so re-runs are offline and deterministic.
- Models: `gpt-4o-mini` and `gpt-4o`.
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

Recent 90-day slice (15 May to 12 Aug 2026), the least-contaminated window: buy-and-hold returned
-17.5% at 48.8% vol and -31.5% max drawdown; `gpt-4o-mini` llm-raw returned -6.3% at 14.3% vol and
-10.8% drawdown; `gpt-4o` llm-raw returned -5.6% at 15.9% vol and -11.4% drawdown. Both models stayed
cautious here too.

![LLM benchmark](figures/llm_benchmark.png)

## What we read from this
1. **Risk-aware prompting made both models cautious, which paid off in a falling market.** Both
   `gpt-4o-mini` and `gpt-4o` held low ETH exposure most of the time, so they cut volatility from
   about 63% to under 20% per year and drawdown from about 67% to about 25%. This is regime-specific:
   the same caution would underperform in a strong bull market. The models are not predicting
   direction; they are being conservative, which lines up with CryptoBench's finding that prediction
   is the weak axis and AI-Trader's finding that risk control, not raw intelligence, drives outcomes.
2. **Model size barely mattered.** `gpt-4o` and `gpt-4o-mini` produced very similar risk and drawdown
   profiles. The behavior came from the prompt and the task, not the backbone.
3. **The deterministic guard was a no-op in this run.** `llm+risk` equals `llm-raw` for both models,
   because the models' exposures never exceeded the volatility-targeted budget the guard enforces. The
   guard is a backstop against oversizing; it binds and helps only when the agent is aggressive. The
   binding case is visible in the deterministic backtest (`docs/PHASE4_RISK.md` and
   `scripts/backtest-sizing.ts`), where capping an always-on position cuts volatility and drawdown.

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
python3 scripts/make-figure-llm.py
```
Re-running with the committed decision caches needs no API key and reproduces the numbers exactly.
