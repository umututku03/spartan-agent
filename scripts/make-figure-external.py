#!/usr/bin/env python3
"""Comparison figure for the InvestorBench ETH task: our policy vs their published agents.
Reads paper/data/investorbench_eth.json. Output: paper/figures/investorbench_eth.pdf (+ .png).
"""
import json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

os.makedirs("paper/figures", exist_ok=True)
d = json.load(open("paper/data/investorbench_eth.json"))

rows = []  # (label, CR, SR, is_ours)
for name, m in d["ours"].items():
    if "long/flat" in name:  # equals buy-and-hold here; skip the duplicate
        continue
    rows.append((name.replace(" (repro)", "").replace(" (contaminated)", "*"), m["cr"], m["sr"], True))
for name, m in d["published"].items():
    if "Buy&Hold" in name:
        continue  # already shown via our reproduced buy-and-hold
    rows.append((name.replace(" (theirs)", ""), m["cr"], m["sr"], False))

rows.sort(key=lambda r: r[1])  # by cumulative return
labels = [r[0] for r in rows]
cr = [r[1] for r in rows]
sr = [r[2] for r in rows]
colors = ["#0072B2" if r[3] else "#BBBBBB" for r in rows]

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.6, 4.2), sharey=True)
y = range(len(rows))
for ax, vals, title, xl in [(ax1, cr, "Cumulative return (%)", "CR (%)"), (ax2, sr, "Sharpe ratio", "SR")]:
    ax.barh(list(y), vals, color=colors, edgecolor="white", linewidth=0.5)
    ax.axvline(0, color="#444", linewidth=0.8)
    ax.set_title(title, fontsize=11)
    ax.set_xlabel(xl, fontsize=9)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(labelsize=8)
ax1.set_yticks(list(y))
ax1.set_yticklabels(labels, fontsize=8)
from matplotlib.patches import Patch
ax2.legend(handles=[Patch(color="#0072B2", label="ours"), Patch(color="#BBBBBB", label="InvestorBench (published)")],
           fontsize=8, frameon=False, loc="lower right")
fig.suptitle("InvestorBench ETH task (2023-04-03 to 2023-11-05): ours vs published agents", fontsize=11, y=1.01)
fig.text(0.5, -0.03, "* our LLM arm is contamination-prone (2023 in training) and omits their news/memory; see docs/BENCHMARK_EXTERNAL.md", ha="center", fontsize=7, color="#666")
fig.tight_layout()
fig.savefig("paper/figures/investorbench_eth.pdf", bbox_inches="tight")
fig.savefig("paper/figures/investorbench_eth.png", dpi=150, bbox_inches="tight")
print("wrote paper/figures/investorbench_eth.pdf/.png")
