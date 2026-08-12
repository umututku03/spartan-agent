# Demo runbook (Phase 6)

A timed, copy-paste script for showing the Ethereum Spartan agent end to end: the working product first,
then the evaluation and the whitepaper. Total time about 10 minutes.

Honest framing to say out loud once: this runs on a local mainnet fork, not live trading; it is a
proposal and a first implementation, not a result proven at scale.

## The two sections map to the two branches

- **Section 1 - the core product** lives on `ethereum-amm-agent` (the shippable branch): boot, chat,
  proactive risk governance, and real on-chain actions (Uniswap V2 swap, Aave supply) on the fork.
- **Section 2 - evaluation and future work** lives on `step2-llm-benchmark`: the deterministic sizing
  backtest, the LLM-in-the-loop and external-benchmark studies, the agent-in-the-loop proof of concept,
  and the paper.

The demo files themselves (`docs/DEMO.md`, `scripts/demo-e2e.ts`) live on `step2-llm-benchmark`, which
is a superset of the core branch, so you can run the whole demo from there without switching. If you
want the branch switch as a talking point ("this is what ships; here is the research on top"), the
core-agent code exercised in Section 1 is byte-identical to `ethereum-amm-agent`.

---

## One-time setup

Full instructions: `docs/SETUP_FROM_SCRATCH.md`. In short, two terminals:

Terminal A - the Docker-anvil mainnet fork on port 8545:
```bash
docker run --rm -d --name anvil -p 8545:8545 ghcr.io/foundry-rs/foundry:latest \
  "anvil --host 0.0.0.0 --fork-url https://eth-mainnet.g.alchemy.com/v2/<YOUR_KEY>"
```

Terminal B - the agent, run from `packages/spartan` with the absolute CLI path, teeing stdout to a log
(the log is needed only for the registration code in a fresh onboarding):
```bash
cd ~/dev/eliza/packages/spartan          # .env has ETHEREUM_RPC_URL=http://127.0.0.1:8545 + an OpenAI key
bun ~/dev/eliza/packages/cli/dist/index.js start 2>&1 | tee /tmp/agent.output
# watch for:  "Loaded character: Spartan"  ->  "Started 1 agents"  ->  ":3000"
```

Remote VM only: tunnel the web UI to your laptop with `ssh -L 3000:localhost:3000 <host>`, then open
`http://localhost:3000`.

## T-5 pre-flight checklist

```bash
# 1. fork is up (returns a block number)
curl -s -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://127.0.0.1:8545

# 2. agent is up (lists the Spartan agent)
curl -s http://127.0.0.1:3000/api/agents

# 3. read-only liveness of the Ethereum layer (derives an address, reads balances, pulls a live quote)
ETHEREUM_RPC_URL=http://127.0.0.1:8545 bun run scripts/demo-readonly.ts
```

---

## Section 1 - the core product (branch `ethereum-amm-agent`, ~5 min)

Optional narration: `git checkout ethereum-amm-agent` to show that everything here is on the shippable
branch. (You can stay on `step2-llm-benchmark`; the agent code is the same.)

Drive it live in the web UI at `http://localhost:3000` (pick the Spartan agent), typing the messages
below. Expected replies are in italics.

1. **Greet.** `hey there`
   *In-character intro. Notice the risk posture in its framing: the RISK_GOVERNANCE provider injects the
   user's risk budget into every turn, so the agent is risk-aware before you ask.*
2. **Register.** `Please register my account. My email is spartan@warlord.eth`
   *Fires USER_REGISTRATION. The code is printed to the agent log, no email needed:*
   `grep 'sending' /tmp/agent.output` shows `sending <CODE> to email spartan@warlord.eth`.
3. **Verify.** `my verification code is <CODE>`
   *Fires VERIFY_REGISTRATION_CODE; the account is now verified.*
4. **Import a wallet.** `import my ethereum wallet 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
   *Anvil dev account #0. Reply: made a wallet, public key `0xf39Fd6...2266`.*
5. **Swap (real on-chain tx).** `Execute a swap now: 0.05 ETH to USDC using my wallet 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
   *Fires MULTIWALLET_SWAP. Reply: swap completed, Transaction ID `0x...`.* Verify it on the fork:
   ```bash
   curl -s -X POST -H 'content-type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["<HASH>"],"id":1}' \
     http://127.0.0.1:8545        # status 0x1 = success
   ```
6. **Risk budget.** `how much ETH can I safely swap right now, and how much can I borrow on Aave?`
   *Fires RISK_ASSESS (read-only). Private reply: the volatility-targeted max swap size and the safe
   Aave borrow headroom before the health-factor floor. This is the novel layer, deterministic sizing
   under the current regime.*
7. **Aave supply (real on-chain tx).** `supply 100 USDC to Aave from my wallet 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
   *Fires MULTIWALLET_ETHEREUM_LENDING; another confirmed on-chain tx.*

**Fallback (important).** LLM action-selection is non-deterministic: the agent sometimes replies
conversationally instead of firing the action. Just re-send the same message. If the live chat is
misbehaving during the demo, run the whole section headless from a terminal, which retries each command
until the action fires and confirms every tx against the fork:
```bash
SKIP_ONBOARDING=1 bun run scripts/demo-e2e.ts     # wallet already imported on this box
# fresh box (does register->verify->import too, reads the code from the log):
AGENT_LOG=/tmp/agent.output bun run scripts/demo-e2e.ts
```
Example output (real run on the fork):
```
[1] swap 0.05 ETH -> USDC (real tx on the fork)
    attempt 1: no new tx (agent replied without acting), retrying
    tx 0x9c829a53...42cd  status 0x1  block 25736341
[summary] confirmed on-chain tx (status 0x1): swap 0x9c829a53...  supply 0x080438b7...
```
It writes a transcript to `paper/data/demo_e2e.json`.

---

## Section 2 - evaluation and future work (branch `step2-llm-benchmark`, ~4 min)

`git checkout step2-llm-benchmark`. Everything here is deterministic and offline (no API key, no fork),
so it always runs the same.

1. **Regime-aware sizing, the novelty.** `bun run scripts/demo-risk.ts`
   *Position size shrinks about 1/vol as realized volatility rises, then the wallet cap binds in calm
   regimes; and the Aave health-factor floor deterministically refuses a borrow that would push HF below
   1.5 (for example a $700 borrow -> HF 1.143 REFUSED).*
2. **Deterministic sizing backtest.** `bun run scripts/backtest-sizing.ts`
   *No-lookahead, one year of ETH. On the volatile window, volatility targeting with a cap cuts realized
   volatility from 87.6% to 59.9% per year and maximum drawdown from 42.8% to 35.5% versus holding ETH,
   with no claim of excess return.*
3. **External benchmark comparison.** `bun run scripts/investorbench-eth.ts`
   *Reproduces InvestorBench's ETH task on their data, window, and metrics. Buy-and-hold reproduces
   their published numbers exactly (CR 4.528%, Sharpe 0.146), which validates the setup. Our
   contamination-free policy lands mid-pack (CR 2.28%), between their GPT-4 and buy-and-hold; a
   price-only LLM arm is among the weakest. Details and the honesty ledger: `docs/BENCHMARK_EXTERNAL.md`.*
4. **LLM-in-the-loop and agent-in-the-loop.** Point at `docs/BENCHMARK_LLM.md`: three models across two
   providers all stayed cautious in a bear year (drawdowns 24/28/30% versus 67%), and six LLM decisions
   were executed as real swaps on the fork through the deployed agent (tx-hash table in that doc).
5. **The whitepaper.** Open `paper/main.pdf` (9 pages): the gap, the system, the math (Uniswap output
   and impact, Aave HF and a borrow floor, volatility targeting and fractional Kelly), results, the
   external comparison, and honest limitations.

---

## Future work (closing, ~1 min)

State plainly what is not done yet, mirroring the paper's future-work section:
- A multi-seed, multi-asset, out-of-sample evaluation, and running inside a full external benchmark
  harness end to end (not just reproducing its protocol).
- Richer regime inputs: funding rates, open interest, on-chain flows, and macro signals.
- MEV-protected execution for larger orders, and live rather than forked settlement.
- A multi-agent decision layer and a model A/B comparison (milestone 5).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agent replies but does not act (no tx) | Re-send the same message; action-selection is non-deterministic. Or run `scripts/demo-e2e.ts` (it retries). |
| Model rate-limited / slow | Use OpenAI (`OPENAI_API_KEY`) rather than the Groq free tier; the Spartan prompt is large. |
| Loads "Eliza (Default)" not Spartan | Launch from `packages/spartan`, not the eliza root. |
| Stale identity / wallet between runs | `rm -rf packages/spartan/.eliza` and restart, then re-onboard. |
| Web UI unreachable on a remote VM | Open the SSH tunnel `-L 3000:localhost:3000` and browse to `http://localhost:3000`. |
| RISK_ASSESS text not in the driver output | Expected: it replies privately (DM). Show it live in the web UI. |

## Caveats to keep honest

A fork is not live trading: state is pinned, there are no adversarial counterparties, and MEV is absent.
The backtest is one asset over one year with single windows and a single seed. Action selection is
non-deterministic. The demo driver is a capability check at a single forked block, not a backtest; the
performance numbers come from the Section-2 scripts.
