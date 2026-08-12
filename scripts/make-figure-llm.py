#!/usr/bin/env python3
"""Render the LLM-in-the-loop benchmark figure from paper/data/llm_results.json.

Two panels for the FULL window: max drawdown and annualized volatility by arm, grouped by model.
Design: brand-neutral, colorblind-safe, print-legible.
Output: paper/figures/llm_benchmark.pdf (+ .png).
"""
import json
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

os.makedirs("paper/figures", exist_ok=True)
data = json.load(open("paper/data/llm_results.json"))
models = list(data.keys())  # gpt-4o-mini, gpt-4o, claude-haiku-4-5-...
arms = ["buy-and-hold", "fixed-fraction", "vol-target+cap", "llm-raw", "llm+risk"]
labels = ["buy &\nhold", "fixed\nfrac", "vol-tgt\n+cap", "llm\nraw", "llm\n+risk"]
PALETTE = ["#E69F00", "#0072B2", "#009E73", "#CC79A7"]  # Okabe-Ito, colorblind-safe
mcolors = {m: PALETTE[i % len(PALETTE)] for i, m in enumerate(models)}
def short(m):
    return m.replace("-20251001", "").replace("claude-haiku-4-5", "claude-haiku-4.5")

def series(model, key):
    a = data[model]["FULL"]["arms"]
    return [abs(a[arm][key]) * 100 if key == "maxDrawdown" else a[arm][key] * 100 for arm in arms]

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.2, 3.6))
x = np.arange(len(arms))
w = 0.8 / len(models)

for ax, key, title, ylab in [
    (ax1, "maxDrawdown", "Maximum drawdown (full year)", "drawdown (%)"),
    (ax2, "annVol", "Annualized volatility (full year)", "volatility (%/yr)"),
]:
    for i, m in enumerate(models):
        vals = series(m, key)
        ax.bar(x + (i - (len(models) - 1) / 2) * w, vals, w, label=short(m),
               color=mcolors[m], edgecolor="white", linewidth=0.5)
    ax.set_title(title, fontsize=11)
    ax.set_ylabel(ylab, fontsize=9)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color="#e6e6e6", linewidth=0.8)
    ax.set_axisbelow(True)
    ax.tick_params(axis="y", labelsize=8)

ax1.legend(fontsize=8, frameon=False, loc="upper right")
fig.suptitle("LLM-in-the-loop vs deterministic sizing on ETH (Sep 2025 - Aug 2026, a bear year)",
             fontsize=11, y=1.02)
fig.tight_layout()
fig.savefig("paper/figures/llm_benchmark.pdf", bbox_inches="tight")
fig.savefig("paper/figures/llm_benchmark.png", dpi=150, bbox_inches="tight")
print("wrote paper/figures/llm_benchmark.pdf/.png")
for m in models:
    print(m, "maxDD%:", [round(v, 1) for v in series(m, "maxDrawdown")])
