# Project workbook: the Ethereum Spartan agent

This is the logbook for the whole project, written after the fact but kept honest to how it actually
went. It covers where the idea came from, what I read, the decisions I made and why, the things that
broke, and what I deliberately left for later. If you only read the paper (`paper/main.pdf`) you get
the tidy version. This is the messy version, which is the useful one.

Two people are behind it: me (the developer, doing this as a school project) and my advisor, Srisht,
who set the milestone. The work is learner-level. The honest framing that runs through everything is
that this is a proposal plus a first implementation, fork-verified, not a result proven at scale.

## Where it started

The assignment was milestone 4: take the ElizaOS "Spartan" trading agent, which is built for Solana,
and get it working on Ethereum, starting with basic AMM swaps and then lending and borrowing. The
pipeline I wanted was narrow and concrete: import an Ethereum wallet, detect it in chat, do ETH
transfers, then Uniswap V2 swaps, then Aave V3 supply and borrow.

The first real commit (`9fe396f`, 29 Mar 2026) added the Ethereum primitives in
`src/plugins/multiwallet/utils/ethereum.ts` using viem, wired into the import, swap, transfer, and
lending actions. So the code to do the on-chain work existed early. The actual gap, which took the rest
of the project, was making it run, proving it ran, and then building something on top worth writing
about.

## Decisions I made early, and why

A few choices set the shape of everything after them. They are logged in full in
`docs/ETH_MVP_DECISIONS.md`; here is the short version with the reasoning.

Run path. Spartan only builds inside the eliza monorepo (its `package.json` uses `workspace:*` deps and
`../cli` scripts, so it does not install standalone). I stopped fighting that and ran it as
`packages/spartan` inside a checkout of eliza. This cost me a lot of build-order pain later but it was
the correct call; the alternative was rewriting the dependency graph.

Test network. I used a local mainnet fork with Foundry's Anvil (`anvil --fork-url ...`) rather than a
testnet. The reason is that the code has real mainnet contract addresses baked in (Uniswap router, Aave
pool, token addresses) and viem's `mainnet` chain, so a fork keeps all of that working with real
liquidity and real prices, free test ETH, and zero real money. This decision is also the honest limit
of the whole project: a fork is not live trading. State is pinned, there is no MEV, and there are no
adversarial counterparties.

Wallets. Import-only for the MVP. Key generation is a nice-to-have I skipped.

Model. This is where the reading started to matter, so it gets its own section below. In practice I ran
the agent on OpenAI's gpt-4o because the Groq free tier rate-limited hard against Spartan's very large
prompt, and it needed a paid key with headroom.

## What I read, and what I took from each

I did not want to invent a "novel" angle out of thin air, so I spent real time reading the recent
literature on LLM trading agents before committing to a direction. The papers below are the ones that
actually changed a decision. All of them are cited in the paper's bibliography.

CryptoBench (Guo et al., arXiv:2512.00417). A dynamic benchmark of LLM agents on crypto analysis,
scored across simple/complex crossed with retrieval/prediction. Two things stuck. First, agentic
results differ from direct-prompting results, so how a model is used is its own skill. Second, and more
important for me, no model is good at crypto prediction (the best complex-prediction score was around
18.6%). That is a strong hint that betting the design on the model predicting direction is a bad bet.

LLM-Powered Multi-Agent System for Automated Crypto Portfolio Management (Luo et al.,
arXiv:2501.00826). A multi-agent setup (a market agent, a news agent, and a trading supervisor) with a
52-week 2025 backtest. What I took: multi-agent beat single-agent regardless of the backbone model, the
hierarchical configuration gave the best risk-adjusted return, and the news agent mostly acted as a
volatility damper rather than a return driver. The line that mattered most: the best full-period,
best-bull, and best-bear configurations were three different setups, so regime switching is unsolved.
That is a gap I could actually aim at.

Those two together pushed me to a thesis I could defend, which I wrote up in the risk-governance
direction note: crypto agents are usually either signal generators (what to trade) or execution bots
(how to trade), and the missing middle is risk governance, meaning how much to risk given current
conditions. Being right about direction but three times oversized in a volatility spike still loses
money. The statistical reason this is sound is that returns are close to unforecastable but volatility
is forecastable, because it clusters and is autocorrelated, so you size on the quantity you can actually
predict. This is the Moreira and Muir volatility-managed-portfolios idea (Journal of Finance) applied to
a crypto agent, with fractional Kelly (Kelly 1956) as the sizing backbone.

The benchmark literature shaped the evaluation, not the design: When Agents Trade / Agent Market Arena
(arXiv:2510.11695), AI-Trader (arXiv:2512.10971), InvestorBench (Li et al., arXiv:2412.18174, ACL 2025),
STOCKBENCH (arXiv:2510.02209), the agentic-trading survey (arXiv:2605.19337), an execution-realism audit
(Yao and Zheng, arXiv:2606.08285), and CryptoTrade (EMNLP 2024). AI-Trader's finding that risk control
rather than raw model strength drives robustness is the one I leaned on most. InvestorBench turned out to
be the one I could compare against directly, because it has an ETH task with open data and published
numbers.

For the risk reads themselves I picked concrete data sources rather than hand-waving: CoinGlass for
funding, open interest, and liquidations; DefiLlama for TVL; and FRED for macro. For execution at size I
noted CoW Protocol on Ethereum for MEV protection, but flagged it as a rebuild that is not justified for
a fork demo. The near-term concrete piece of the thesis was the Aave health-factor floor on borrow, which
is just the lending version of "do not get oversized."

One more decision came out of the reading. Risk governance had to be deterministic, not delegated to the
LLM. The model proposes intent; fixed rules compute the size and can veto it. CryptoBench and the
multi-agent paper both say, in different ways, that the model is the unreliable part, so I did not want
the safety layer to depend on it.

## Building it, phase by phase

The work splits into a first burst in early July and the main runtime push in mid-August.

Verifying the DeFi layer (2 Jul 2026). Before trusting the code I ran the whole flow against the Anvil
fork end to end: native transfer, ETH to USDC swap on Uniswap V2, USDC supply to Aave V3, and a DAI
borrow that actually delivered 10 DAI to the wallet. Running it, rather than reading it, surfaced four
real bugs, all now fixed and merged (PRs #1, #3, #4): an invalid EIP-55 checksum on the Aave pool
address; token approvals going to the Uniswap router even when supplying to Aave, fixed by adding a
spender parameter; the borrow running out of gas from an under-estimated limit, fixed by pinning gas;
and calls not checking `receipt.status`, so reverts were returning fake success hashes, fixed by
throwing on non-success. I also added unit tests on the pure helpers. This is the part I am most
comfortable defending, because it is verifiable and it found real problems.

Phase 2, the agent boots and talks (11 Aug 2026). Getting the full Spartan runtime to start on a fresh Linux machine was its own saga, all written up in
`docs/SETUP_FROM_SCRATCH.md`. The short list of things that
bit me: the `bun run build` npm indirection silently no-ops, so you build each package with `bun run
build.ts` directly; the `node_modules/.bin/bun` shims were Windows `.exe` files that had to be
repointed; and the character kept loading as default Eliza until I learned to launch from
`packages/spartan`. One correction worth recording: the `Error creating entities` log is benign, a
duplicate-key from the Sessions layer already creating the author entity, and it does not block
responses. I almost downgraded a dependency to chase it, which would have been a mistake.

Phase 3, actions fire from chat (12 Aug 2026). This is where a chat message turns into a real on-chain
transaction, and it needed three fixes. The identity one was subtle: the message bus set a per-message
source id, so register, verify, and account never resolved to the same user; I keyed off the stable
session user id instead. The persistence one was a real bug in the monorepo's `updateComponent`, which
threw because callers passed a numeric `createdAt` and bogus foreign-key fallbacks; I made it write only
the mutable fields. The third was the LLM returning the literal string "null" for a token address, which
I now treat as absent. After that, register, verify, import, swap, and supply all fired from chat, with
the swap and supply confirmed on-chain. The honest caveat I hit here and never fully solved: action
selection is non-deterministic, so even a valid command sometimes gets a conversational reply instead of
the action, and you re-send.

Phase 4, the risk layer (12 Aug 2026). This is the novel part, and it is deliberately plain math:
volatility targeting (size proportional to target-vol over realized-vol), fractional Kelly, a hard
wallet cap, and the Aave health-factor floor with a max-safe-borrow helper. All pure functions with unit
tests. Phase 4.2 wired it into the agent as a service (one source of truth, with a cached regime read), a
provider that injects the user's risk budget into every turn so the agent is risk-aware before you ask,
and a read-only advisory action. The swap path clamps the LLM's requested amount to the sized budget,
which is what corrects an absurd number if the model produces one.

Phase 5, the paper (12 Aug 2026). I wrote a technical whitepaper in LaTeX (`paper/main.tex`), with
moderate math for the Uniswap output and price impact, the Aave health factor and borrow floor, and the
volatility targeting and Kelly sizing. It ships with a deterministic, no-lookahead sizing backtest on a
year of ETH prices and a colorblind-safe figure. The honest result I reported: on a volatile window,
volatility targeting with a cap cut realized volatility from about 88% to 60% a year and drawdown from
about 43% to 35% versus holding ETH, with no claim of excess return.

## Step 2, the future-work benchmarks (12 Aug 2026)

Everything past the paper lives on a feature branch, `step2-llm-benchmark`, kept off the core branch on
purpose so step 1 stays clean. It never got merged. It changed zero runtime code; it is all scripts,
docs, and paper additions, so there was nothing to gate behind a flag.

Step 2a put a language model in the decision loop: each day the model sees only past returns and
trailing volatility and picks a target exposure, cached per model and date so runs are reproducible. I
ran gpt-4o-mini, gpt-4o, and claude-haiku-4.5. In a bear year all three stayed cautious and cut drawdown
sharply, and the model and provider barely mattered. The deterministic risk guard did not bind, because
the models never asked for more than the guard would allow, which is an honest null result rather than a
win.

Step 2a.2 closed the loop: I replayed the model's own cached decisions through the real deployed agent,
which executed each one as an actual swap on the fork. Six decisions became six confirmed transactions.
I was careful to frame this as a capability demonstration at a single forked block, not a backtest, and
to explain the two-stage methodology: a deterministic reference run first, then the live agent.

Step 2b was the external comparison. Running InvestorBench's own harness was not possible here (it needs
a multi-GPU serving stack, a vector database, a memory agent, and an embedding model), so I reproduced
its ETH task on its exact data, window, and metric formulas and compared to its published numbers. The
check that this was faithful: my reproduced buy-and-hold matches their published number to three
decimals, with nothing tuned to hit it. My contamination-free policy landed mid-pack, between their GPT-4
and buy-and-hold. A stripped-down price-only LLM arm lost money, close to their weakest backbone, which
is consistent with their finding that small models struggle and with the whole thesis that risk control
beats naive directional calls. I wrote an honesty ledger of what matched and what did not.

## Step 2 model-selection notes (for later)

The model choice for a future advisory layer is not settled, and the two benchmarks I trust disagree,
which is the point. CryptoBench crowns Grok-4 agentically on analysis and shows prediction is the weak
axis for everyone. The multi-agent portfolio paper gives Claude Sonnet 4.5 the highest mean return in its
setup and shows multi-agent beats single-agent regardless of model. The reading I take from the
disagreement is that model ranking is task and harness dependent, so the plan is to A/B rather than
commit, and to keep a human in the loop for any advisory output given nobody is expert-level at
prediction. This is logged as Decisions 6 and 7.

## The demo, and how it is organized

Phase 6 packaged the whole thing into a demo (`docs/DEMO.md`) plus a one-command driver
(`scripts/demo-e2e.ts`) that drives the real agent through onboarding, a real swap, a risk assessment,
and an Aave supply, retrying past the non-deterministic action selection and confirming every
transaction against the fork. The demo has two sections that map to the two branches: section 1 is the
shippable core product on `ethereum-amm-agent`, and section 2 is the evaluation and the paper on
`step2-llm-benchmark`. The branch split is the talking point, because it makes the core-versus-future-work
line visible.

## What I got wrong along the way

Worth recording, because the mistakes were instructive. I almost downgraded a dependency to chase a log
line that turned out to be benign. My first agent-in-the-loop run produced six identical transaction
hashes because the agent deduped byte-identical commands and my capture reused the first hash; I fixed it
by nudging each command and only accepting new hashes. I hit a rate-limit wall running gpt-4o at high
concurrency and had to add backoff and lower the concurrency. And I spent time reverse-engineering
InvestorBench's exact test window because my first reproduction of their buy-and-hold did not match,
which turned out to be a window and annualization-constant issue.

## What is deliberately not done

All of the on-chain work so far is fork-based. Real or live execution is future work: live or testnet
settlement, MEV-protected orders through something like CoW, and larger order sizes where slippage and
execution realism actually matter. The evaluation is one asset over one year with single windows and a
single seed, so a multi-seed, multi-asset, out-of-sample study, and running inside a full external
harness end to end, are the honest next steps. Beyond that sit the multi-agent decision layer and a real
model A/B, which is milestone 5.

## Pointers

- Setup and troubleshooting: `docs/SETUP_FROM_SCRATCH.md`
- Fork verification evidence: `docs/VERIFICATION.md`
- Decision log: `docs/ETH_MVP_DECISIONS.md`
- Risk layer: `docs/PHASE4_RISK.md`, `docs/PHASE4_2_AGENT_RISK.md`
- Benchmarks: `docs/BENCHMARK_LLM.md`, `docs/BENCHMARK_EXTERNAL.md`
- Demo: `docs/DEMO.md`
- Paper: `paper/main.pdf` (source `paper/main.tex`)
