# Spartan Ethereum agent — setup from scratch (reproducible on any laptop)

End state: the full Spartan/ElizaOS agent boots on the elizaOS monorepo (**`develop`** branch,
core 1.6.5-alpha), serves the web chat UI at http://localhost:3000, and responds via OpenAI.
Every blocker we hit is fixed inline, in order.

> Honest scope: at this state the agent **boots, serves the UI, and understands** wallet commands.
> Getting the wallet **actions to fire from chat** is covered in `docs/PHASE3_ACTIONS.md`. The DeFi
> execution itself is independently verified via the Anvil fork smoke test (`scripts/smoke.ts`, real
> tx hashes — see `docs/VERIFICATION.md`).

Assumed local paths (adjust to yours — examples are macOS):
- eliza clone:        `~/dev/eliza`
- this repo (Spartan): `~/dev/spartan-agent`
- fixed `ethereum.ts`: from this repo, `src/plugins/multiwallet/utils/ethereum.ts`

Related docs: `PHASE2_AGENT_CHAT.md` (agent boot + chat), `PHASE3_ACTIONS.md` (actions fire on-chain),
`VERIFICATION.md` (fork verification evidence), `ETH_MVP_DECISIONS.md` (decision log).

---

## 0. Prerequisites (one-time)
```bash
curl -fsSL https://bun.sh/install | bash && exec $SHELL          # bun (runtime + pkg manager)
curl -L https://foundry.paradigm.xyz | bash && foundryup          # anvil + cast
# OpenAI API key WITH a little credit (platform.openai.com) — most reliable model provider
# A mainnet RPC to fork from — free Alchemy key: https://eth-mainnet.g.alchemy.com/v2/<KEY>
```

## 1. Clone elizaOS on `develop` (core 1.6.5-alpha)
```bash
cd ~/dev
git clone git@github.com:umututku03/eliza.git        # or the elizaOS upstream / your fork
cd eliza
git checkout develop
grep '"version"' packages/core/package.json           # sanity: 1.6.5-alpha.x
```
> **Do NOT** `git checkout v1.0.0-beta.57` to "match versions" — it triggers a langchain / `zod/v3`
> transitive-dependency cascade. Stay on `develop`.

## 2. Add Spartan as `packages/spartan` — REAL COPY, not a symlink
A symlink breaks both the `../cli` relative path in Spartan's `start` script AND Node module
resolution (e.g. `dotenv`) because it resolves from the symlink's real location.
```bash
cd ~/dev/eliza
rm -rf packages/spartan
rsync -a --exclude node_modules --exclude .git ~/dev/spartan-agent/ packages/spartan/
```

## 3. Trim the 7 workspace plugins not in this monorepo
They are never imported by Spartan source (only `@elizaos/core` is); left in, `bun install` fails
with `workspace dependency @elizaos/plugin-X not found`. `npm pkg delete` mishandles scoped names,
so edit the JSON directly — **run this inside `packages/spartan`**:
```bash
cd ~/dev/eliza/packages/spartan
pwd    # must end in /packages/spartan
bun -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));["@elizaos/plugin-birdeye","@elizaos/plugin-evm","@elizaos/plugin-farcaster","@elizaos/plugin-jupiter","@elizaos/plugin-knowledge","@elizaos/plugin-mysql","@elizaos/plugin-solana"].forEach(k=>delete p.dependencies[k]);fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");console.log("remaining @elizaos deps:",Object.keys(p.dependencies).filter(k=>k.startsWith("@elizaos")))'
# keep: @elizaos/cli, @elizaos/core, @elizaos/plugin-bootstrap, @elizaos/plugin-sql (+ "latest" ones)
```

## 4. Edit `packages/spartan/src/index.ts` → `character.plugins`
Use OpenAI for the model (it does text AND embeddings); comment everything needing a key/token/
DB-server you don't have. Make those lines read:
```ts
    '@elizaos/plugin-sql',          // local DB (SQLite/PGlite) — no server needed
    // '@elizaos/plugin-mysql',     // needs a MySQL server
    // '@elizaos/plugin-anthropic', // no key
    // '@elizaos/plugin-groq',      // free tier rate-limits fast
    '@elizaos/plugin-openai',       // model + embeddings (needs OPENAI_API_KEY w/ credit)
    // '@elizaos/plugin-discord',   // no bot token
    // '@elizaos/plugin-telegram',  // no bot token
```

## 5. Create `packages/spartan/.env`
```bash
cat > ~/dev/eliza/packages/spartan/.env <<'EOF'
OPENAI_API_KEY=sk-...yourkey...
OPENAI_LARGE_MODEL=gpt-4o
OPENAI_SMALL_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
ETHEREUM_RPC_URL=http://127.0.0.1:8545
EOF
```

## 6. Install (from the monorepo root)
`--ignore-scripts` skips a dead `.cursor` git-submodule postinstall that otherwise aborts install.
```bash
cd ~/dev/eliza
rm -rf node_modules bun.lock
bun install --ignore-scripts
```

## 7. Build the workspace packages the runtime needs
Each `bun run build` may print trailing `tsc`/`.d.ts` type errors — **ignore them**; the ESM JS
bundle emits regardless, and that's all the runtime uses.
```bash
cd ~/dev/eliza
for p in core plugin-sql plugin-bootstrap api-client server cli client; do
  if [ -d "packages/$p" ]; then
    echo "=== building $p ==="
    (cd "packages/$p" && bun run build) || echo "!! $p exited non-zero (ok if dist emitted)"
    cd ~/dev/eliza
  fi
done
cd packages/server && bun run build; cd ../..     # rebuild AFTER client so the web UI is bundled
for p in core plugin-sql plugin-bootstrap cli; do
  ls packages/$p/dist/index.js >/dev/null 2>&1 && echo "  ok $p" || echo "  MISSING $p"
done
```

## 8. Start the mainnet fork (Terminal A — leave running)

**On this Cerebras Linux VM (glibc 2.34), the native `anvil` binary won't run** (it needs
glibc 2.35). Docker is installed, so run `anvil` in a container — same deterministic accounts,
exposed on `127.0.0.1:8545`:
```bash
docker run --rm -d --name anvil -p 8545:8545 ghcr.io/foundry-rs/foundry:latest \
  "anvil --host 0.0.0.0 --fork-url https://eth-mainnet.g.alchemy.com/v2/<YOUR_KEY>"
docker logs -f anvil     # watch it fork; Ctrl-C to stop watching (container keeps running)
```
On a machine with glibc ≥ 2.35 (recent macOS/Linux) you can instead run it natively:
```bash
anvil --fork-url https://eth-mainnet.g.alchemy.com/v2/<YOUR_KEY>
```
Either way, account (0) — the throwaway wallet used below — is:
`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`.
Stop the container later with `docker rm -f anvil`.

## 9. Run Spartan (Terminal B)
Run **from `packages/spartan`** (so it loads the Spartan character, not the default Eliza) and use
the **absolute** CLI path (the relative `../cli` breaks through the copy).
```bash
cd ~/dev/eliza/packages/spartan
bun ~/dev/eliza/packages/cli/dist/index.js start
# watch for:  "Loaded character: Spartan"  ->  "Started 1 agents"  ->  ":3000"
```

### Accessing the web UI (when the agent runs on a remote VM)
The agent serves on the VM's `localhost:3000`, which your laptop browser can't reach directly.
Open an **SSH tunnel from your laptop** (add `-L 3000:localhost:3000` to your normal ssh command):
```bash
ssh -L 3000:localhost:3000 utkuu@utkuu-vm.cerebras.aws     # or utkuu@172.31.51.116
```
Keep that session open, then open **http://localhost:3000** in your laptop browser and pick the
Spartan agent. (On a fully local machine, just open http://localhost:3000 directly — no tunnel.)

## 10. Test in the web UI (anvil running)
```
import my ethereum wallet 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
show my balance
swap 0.5 ETH to USDC
supply 100 USDC to Aave
borrow 10 DAI from Aave
```
The agent responds via OpenAI and understands the requests. (Wallet-action firing is the open item;
DeFi execution is separately proven via `scripts/smoke.ts` on the fork.)

## 11. Troubleshooting (exactly what bit us)
| Symptom | Fix |
|---|---|
| `bun install`: `workspace dependency @elizaos/plugin-X not found` | Step 3 didn't run inside `packages/spartan`, or missed one — re-run the `bun -e` edit there. |
| `bun install` aborts on `.cursor` submodule / "Failed to initialize git submodules" | Use `bun install --ignore-scripts` (step 6). |
| cli build: "Bun's postinstall script was not run" | Happens without a normal install; on `develop` the step-6 install + step-7 build works. If needed: `(cd node_modules/bun && bun install.js)`. |
| runtime: `Cannot find module '@elizaos/plugin-sql'` (or `server`/`api-client`) | That package's `dist` isn't built — build it (step 7). |
| Loads `Eliza (Default)` instead of Spartan | You launched from the eliza root; launch from `packages/spartan` (step 9). |
| `module not found ../cli/dist/index.js` | Use the **absolute** CLI path (step 9), not the relative one. |
| Model error: Anthropic/OpenAI "API key missing" | Ensure ONLY `plugin-openai` is active (step 4) and `OPENAI_API_KEY` is set. |
| Model error: Groq `model_not_found` | Use `llama-3.3-70b-versatile` / `llama-3.1-8b-instant`. |
| Model error: OpenAI `429 insufficient_quota` | Add credit to the OpenAI account. |
| Tried to "match versions" with beta.57 and hit `zod/v3` not found | Don't — stay on `develop`. |
| `bun run build` no-ops (no `dist`, no error) | The `bun run build → bun run build.ts` npm-script indirection silently no-op'd on this VM. Run **`bun run build.ts` directly** in each package. |
| `bun: Exec format error: node_modules/.bin/bun` (or `bunx`) | The `bun` npm dep shipped a **Windows** `bun.exe`/`bunx.exe` as the `.bin` shim. `ln -sf $HOME/.bun/bin/bun node_modules/.bin/bun` and same for `bunx`. |
| client `vite build`: `crypto.getRandomValues is not a function` / "Node 16" | vite ran under the system Node 16 (needs 20+). Use **`bun --bun x vite build`** to force the bun runtime. |
| `elizaos start`: `ENOEXEC posix_spawn 'bunx'` from spartan `build.ts` | spartan's original `build.ts` shells out to `bunx vite`. Use this repo's node-only `build.ts` (only `dist/index.js` is needed at runtime; the web UI is already bundled in `@elizaos/server`). |
| runtime auto-installs `@elizaos/plugin-solana` then aborts on `.cursor` submodule clone | The character listed Solana-stack plugins. Comment `plugin-solana/jupiter/evm/birdeye` in `src/index.ts` `character.plugins`; make `scripts/init-submodules.sh` a no-op (the `.cursor` submodule is Cursor IDE rules, unused). |
| Edited plugins but the old list still loads | Old character cached in PGlite. `rm -rf packages/spartan/.eliza` before restart. |
| Chat: greetings answered but bare `import my wallet 0x…` gets no reply (`IGNORE action` in log) | Expected Phase-2 boundary — the wallet action's `validate()` gates aren't met, so the LLM picks IGNORE for the bare command. Conversational replies work. Firing the action is Phase 3. |
| Account never becomes verified over web-UI/Sessions; register→verify resolve to different users | The central bus sets `metadata.sourceId` per-MESSAGE. This repo's `getEntityIdFromMessage` (Phase 3) keys off the stable `metadata.raw.senderId` instead — pull the latest `ethereum-amm-agent`. |
| `updateComponent error … value.toISOString is not a function` / `violates foreign key constraint` on verify | **Required monorepo patch:** in `packages/plugin-sql/src/base.ts` `updateComponent`, replace the `.set({ ...component, updatedAt: new Date() })` with `.set({ data: component.data, updatedAt: new Date() })` (a component is updated by id; identity/FK/createdAt columns are immutable and callers pass numeric createdAt / bogus fallback FKs). Rebuild plugin-sql. See `docs/PHASE3_ACTIONS.md` §3. |
| Swap fails `Unsupported Ethereum token: null` | The LLM returned the string `"null"` for a token CA. Fixed in this repo's `act_wallet_swap.ts` (`cleanTok`). Pull latest. |
| Action offered but agent replies instead of firing it | LLM tool-selection is non-deterministic — re-send the same command 1–3×. Not a bug. See `docs/PHASE3_ACTIONS.md` §4. |

## Fast checks that don't need the full agent (run in this repo, no monorepo)
```bash
# unit tests (pure helpers, offline)      — needs viem in a scratch dir
bun test
# live read-only mainnet demo (address + balances + Uniswap quote)
ETHEREUM_RPC_URL=https://ethereum-rpc.publicnode.com bun run scripts/demo-readonly.ts
# on-chain e2e on a fork (transfer/swap/supply/borrow, real tx hashes)
anvil --fork-url <rpc>   # then, with ETHEREUM_RPC_URL=http://127.0.0.1:8545:
bun run scripts/smoke.ts
```
