# Phase 2 — Full Spartan agent chat (talking + understanding) — VERIFIED on the Linux VM

**Status: ✅ complete.** The full Spartan/ElizaOS agent boots on this Cerebras Linux VM, loads the
**Spartan** character (not the default Eliza), registers the multiwallet (custodial-wallet) service,
serves the web UI on `:3000`, and responds coherently to chat via OpenAI — demonstrating it
understands Ethereum wallet / DeFi requests.

> Scope note: this phase is **talking + understanding**. Getting the wallet **actions to fire**
> (an on-chain tx driven from chat) is Phase 3 — see the "IGNORE action" note below. The DeFi
> execution itself is independently verified on the Anvil fork (`docs/VERIFICATION.md`).

Runs entirely on the VM: agent natively via `bun`; the mainnet fork via **Docker-anvil**.

---

## 1. Boot evidence (captured)

```
 Info       Loaded character: Spartan
 Info       Web UI enabled
 Info       [STATIC] Serving static files from: .../packages/server/dist/client
AgentServer is listening on port 3000
 Info       Started 1 agents
```

Services registered by the Spartan project (from the runtime log):

```
"@elizaos/plugin-sql", "openai", "bootstrap", "account registration",
"autonomous-trader", "spartan-intel", "multitenant wallet", "trader", "KOL", "coin_marketer"
```

`"multitenant wallet"` is the **multiwallet** plugin (the Ethereum custodial-wallet layer —
`src/plugins/multiwallet`). Health check + agent list:

```bash
curl -s http://127.0.0.1:3000/api/server/health
# {"status":"OK", ... "dependencies":{"agents":"healthy"}}
curl -s http://127.0.0.1:3000/api/agents
# {"success":true,"data":{"agents":[{"id":"479233fd-...","name":"Spartan","status":"active"}]}}
```

## 2. Chat evidence (captured, live OpenAI responses)

Driven through the ElizaOS **Sessions API** (the scriptable equivalent of the web-UI chat):

```bash
AID=<agent id from /api/agents>
USERID=22222222-2222-2222-2222-222222222222     # any UUID v4 (must be valid UUID)
SID=$(curl -s -X POST http://127.0.0.1:3000/api/messaging/sessions \
  -H 'content-type: application/json' -d "{\"agentId\":\"$AID\",\"userId\":\"$USERID\"}" \
  | grep -oE '"sessionId":"[^"]+"' | cut -d'"' -f4)
curl -s -X POST http://127.0.0.1:3000/api/messaging/sessions/$SID/messages \
  -H 'content-type: application/json' -d '{"content":"<your message>"}'
# poll for the reply:
curl -s http://127.0.0.1:3000/api/messaging/sessions/$SID/messages
```

Transcript:

```
[USER]    Hey Spartan! Can you introduce yourself and tell me what you can help me do
          with my crypto wallet?
[SPARTAN] I am Spartan, your DeFi warlord. I can help you manage LP positions, execute
          trades, and deploy autonomous trading strategies. All about winning on-chain,
          even for the memes. What's your battle plan with your crypto wallet?

[USER]    I have some ETH. Walk me through how you would swap 0.5 ETH into USDC on
          Uniswap and what a health factor means if I later borrow on Aave.
[SPARTAN] To swap 0.5 ETH into USDC on Uniswap, head to the Uniswap interface, connect
          your wallet, select ETH as the input and USDC as the output. Input 0.5 ETH and
          execute the swap. A health factor on Aave represents the safety of your
          collateral against your borrowed amount. Above 1 means safe, below 1 means
          danger of liquidation. Keep it high to avoid trouble.
```

The second reply shows the agent **understands** the exact Uniswap-swap and Aave-health-factor
concepts our execution engine implements.

## 3. The "IGNORE action" on a bare command (why Phase 3 exists)

Sending the terse command `import my ethereum wallet 0x...` produced, in the log:

```
[Spartan] Agent generated response for message. Preparing to send back to bus.
[Spartan] MessageBusService: Skipping response (reason: IGNORE action)
```

i.e. the LLM ran and chose the **IGNORE** action rather than firing `WALLET_IMPORT`. That is the
expected Phase-2 boundary: the wallet action's `validate()` gates (entity + registered/verified
account) aren't satisfied for a raw session user, so the model has no wallet action to select and
falls back to IGNORE for a bare command (while it answers conversational messages normally). Making
the action actually fire is **Phase 3** (`docs/PLAN_PROMPTS.md`).

The `Error creating entities … duplicate key value violates unique constraint "entities_pkey"`
lines in the log are **benign** — the session layer already created the author entity via
`ensureConnection`, so core's follow-up create is a no-op duplicate. It does not block responses.

---

## 4. Exact run sequence on this VM (what actually worked)

Prereqs already in place: eliza on `develop` at `/cb/home/utkuu/repos/eliza`; Spartan copied to
`packages/spartan`; `.env` with `OPENAI_API_KEY` (+ `OPENAI_LARGE_MODEL=gpt-4o`, small/embedding
models) and `ETHEREUM_RPC_URL=http://127.0.0.1:8545`.

```bash
export PATH="$HOME/.bun/bin:$PATH"

# Fork (Terminal A) — Docker-anvil (native anvil needs glibc 2.35; VM has 2.34):
docker run --rm -d --name anvil -p 8545:8545 ghcr.io/foundry-rs/foundry:latest \
  "anvil --host 0.0.0.0 --fork-url https://eth-mainnet.g.alchemy.com/v2/<KEY>"

# Build the workspace packages the runtime needs — run each build.ts DIRECTLY (see fixes below):
cd /cb/home/utkuu/repos/eliza
for p in core plugin-sql plugin-bootstrap api-client server cli; do (cd packages/$p && bun run build.ts); done
(cd packages/client && bun --bun x vite build)       # client needs bun runtime, not node16
(cd packages/server && bun run build.ts)             # rebuild AFTER client so the web UI is bundled

# Run the agent (Terminal B) — from packages/spartan, absolute CLI path:
cd /cb/home/utkuu/repos/eliza/packages/spartan
bun /cb/home/utkuu/repos/eliza/packages/cli/dist/index.js start
```

Then open the web UI via SSH tunnel from your laptop:
`ssh -L 3000:localhost:3000 utkuu@172.31.51.116` → http://localhost:3000.

## 5. VM-specific fixes discovered in Phase 2 (added to SETUP_FROM_SCRATCH.md troubleshooting)

| Symptom | Root cause | Fix |
|---|---|---|
| `bun run build` (npm-script) no-ops, no `dist` | the `bun run build → bun run build.ts` indirection silently no-op'd | invoke `bun run build.ts` **directly** per package |
| `bun: Exec format error: node_modules/.bin/bun` | the `bun` npm dep installed a **Windows** `bun.exe` as the `.bin` shim | `ln -sf $HOME/.bun/bin/bun node_modules/.bin/bun` (same for `bunx`) |
| `elizaos start` fails: `ENOEXEC posix_spawn 'bunx'` in spartan `build.ts` | spartan's `build.ts` shells out to `bunx vite` (Windows shim + node16) | replaced the staged `packages/spartan/build.ts` with a node-only `Bun.build` (the runtime only loads `dist/index.js`; the standard `@elizaos/client` UI is already bundled in the server) |
| client `vite build`: `crypto.getRandomValues is not a function` / "Node 16" | vite ran under the system Node 16 | `bun --bun x vite build` (force bun runtime) |
| runtime tries to auto-install `@elizaos/plugin-solana` then aborts on `.cursor` submodule clone | character listed Solana-stack plugins we trimmed; auto-install ran root `postinstall` (`init-submodules.sh`) which clones `.cursor` (no git creds/display) | comment `plugin-solana/jupiter/evm/birdeye` in `src/index.ts` `character.plugins`; make `scripts/init-submodules.sh` a no-op (`.cursor` is Cursor IDE rules, not needed) |
| stale character (old plugin list) after edits | old character cached in `packages/spartan/.eliza` (PGlite) | `rm -rf packages/spartan/.eliza` before restart |

See `docs/SETUP_FROM_SCRATCH.md` for the consolidated runbook.
