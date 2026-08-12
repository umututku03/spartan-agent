#!/usr/bin/env python3
"""Render the sizing-ablation figure for the paper from paper/data/backtest_results.json.

Two panels for the VOLATILE window: annualized realized volatility and max drawdown by policy.
Design: brand-neutral, colorblind-safe categorical colors, print-legible, no chartjunk.
Output: paper/figures/sizing_ablation.pdf (+ .png).
"""
import json
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

os.makedirs("paper/figures", exist_ok=True)
data = json.load(open("paper/data/backtest_results.json"))

policies = ["buy-and-hold", "fixed-fraction", "vol-target", "vol-target+cap"]
labels = ["buy &\nhold", "fixed\nfraction", "vol\ntarget", "vol-target\n+cap"]
# Okabe-Ito colorblind-safe palette
colors = ["#999999", "#E69F00", "#0072B2", "#009E73"]

win = data["windows"]["VOLATILE"]
vol = [win["policies"][p]["annVol"] * 100 for p in policies]
mdd = [-win["policies"][p]["maxDrawdown"] * 100 for p in policies]  # positive magnitude

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(8.2, 3.4))
x = range(len(policies))

for ax, vals, title, ylab in [
    (ax1, vol, "Annualized realized volatility", "volatility (%/yr)"),
    (ax2, mdd, "Maximum drawdown", "drawdown (%)"),
]:
    bars = ax.bar(x, vals, color=colors, width=0.68, edgecolor="white", linewidth=0.6)
    ax.set_title(title, fontsize=11)
    ax.set_ylabel(ylab, fontsize=9)
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(axis="y", labelsize=8)
    ax.grid(axis="y", color="#e6e6e6", linewidth=0.8)
    ax.set_axisbelow(True)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v, f"{v:.0f}", ha="center", va="bottom", fontsize=8)
    ax.margins(y=0.15)

r = win["range"]
fig.suptitle(f"Sizing policies on the volatile ETH window ({r[0]} to {r[1]})", fontsize=11, y=1.02)
fig.tight_layout()
fig.savefig("paper/figures/sizing_ablation.pdf", bbox_inches="tight")
fig.savefig("paper/figures/sizing_ablation.png", dpi=150, bbox_inches="tight")
print("wrote paper/figures/sizing_ablation.pdf/.png")
print("volatile-window vol %:", [round(v, 1) for v in vol])
print("volatile-window maxDD %:", [round(v, 1) for v in mdd])
