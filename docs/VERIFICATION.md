# Verification — Ethereum DeFi layer

Reproducible evidence that the Spartan Ethereum DeFi layer works. Three artifacts, each with the
exact command, expected output, and a real captured result. Artifacts 1–2 run on any machine with
`bun` + `viem` (no monorepo); artifact 3 is the on-chain write path on a mainnet fork.

Code under test: `src/plugins/multiwallet/utils/ethereum.ts` (viem). Scripts: `scripts/demo-readonly.ts`,
`scripts/smoke.ts`. See also `docs/SETUP_FROM_SCRATCH.md` for the full end-to-end run.

---

## 1. Unit tests — pure helpers (offline)

Covers the network-free helpers: private-key/address detection, normalization, address derivation,
and known-token resolution.

**Command** (scratch dir, since the repo root uses `workspace:*` and can't `bun install`
standalone):
```bash
mkdir -p /tmp/eth-verify/__tests__ && cd /tmp/eth-verify
cp <repo>/src/plugins/multiwallet/utils/ethereum.ts ethereum.ts
cp <repo>/src/plugins/multiwallet/utils/__tests__/ethereum.test.ts __tests__/ethereum.test.ts
echo '{ "name":"eth-verify","type":"module","private":true }' > package.json
npm install viem@^2.21.0
bun test
```

**Expected:** `21 pass, 0 fail`.

**Captured result:**
```
bun test v1.3.14 (0d9b296a)

 21 pass
 0 fail
 26 expect() calls
Ran 21 tests across 1 file. [189.00ms]
```

---

## 2. Live read-only mainnet demo

Runs the agent's own `ethereum.ts` against **live Ethereum mainnet** (no funds): derives an address
from a key, reads a real wallet's balances via `getEthereumWalletSummary`, resolves a token, and
pulls a **live Uniswap V2 quote** via the same router/call the swap path uses.

**Command:**
```bash
ETHEREUM_RPC_URL="https://ethereum-rpc.publicnode.com" bun run scripts/demo-readonly.ts
```

**Expected:** correct derived address; a live balance summary for the target wallet; a USDC token
resolution; and a live `1 WETH -> ~N USDC` quote. Balances and the quote are **live values** — they
differ every run; the point is that the calls execute against real mainnet contracts.

**Captured result** (sample run):
```
RPC in use (ETHEREUM_RPC_URL): https://ethereum-rpc.publicnode.com

[1] privateKeyToEthereumAddress -> 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

[2] getEthereumWalletSummary (LIVE) for 0x28C6c06298d514Db089934071355E5743bf21d60
Wallet Address: 0x28C6c06298d514Db089934071355E5743bf21d60
  Chain: ethereum
  ETH balance: 189934.374052766568979892
  0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 ($WETH) balance: 91.779280701265653748
  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 ($USDC) balance: 50810.846175
  0xdAC17F958D2ee523a2206206994597C13D831ec7 ($USDT) balance: 768734287.001764
  0x6B175474E89094C44Da98b954EedeAC495271d0F ($DAI) balance: 15120.572124459178040567

[3] resolveEthereumToken("USDC") -> { address: "0xA0b8…eB48", symbol: "USDC", decimals: 6, isNative: false }

[4] LIVE Uniswap V2 quote: 1 WETH -> 1876.297008 USDC
```

---

## 3. On-chain write path — mainnet fork (Foundry Anvil)

The full state-changing flow: native transfer → Uniswap V2 swap → Aave V3 supply → Aave V3 borrow,
executed against a **local mainnet fork** (real Uniswap/Aave contracts and liquidity, a throwaway
pre-funded key, zero real funds). Runs where `anvil` is available (e.g. macOS).

**Command:**
```bash
# Terminal A — fork mainnet:
anvil --fork-url https://eth-mainnet.g.alchemy.com/v2/<YOUR_KEY>

# Terminal B — run the smoke test against the fork:
export ETHEREUM_RPC_URL="http://127.0.0.1:8545"
bun run scripts/smoke.ts
```

**Expected:** four transaction hashes (transfer, swap, supply, borrow) and an "after" wallet
summary showing USDC (from the swap) and 10 DAI (from the borrow). Order matters: swap before
supply (need an ERC-20), supply before borrow (need collateral).

**Captured result** — transaction hashes from the successful run (on the fork):

| Flow | Transaction hash |
|---|---|
| Transfer (native ETH) | `0xc523e4f5b90f2e0fb211f87108290630e9848a78b6f198f0fe91334a67046883` |
| Swap ETH → USDC (Uniswap V2) | `0x04bbdc3d5e94582719e00e46c832395b2b2d5bf83a40a25b8be7b2759c277c61` |
| Supply USDC (Aave V3) | `0x277510c23006ff3bf1f2543b05409c9c4c01346cdcceed7d4a0159ab30542b6c` |
| Borrow DAI (Aave V3) → 10 DAI | `0x5774d1bd62d4fd4ad6df86f7ad190c7f23b940a8e86163c2768c628261ba9882` |

Inspect any hash on the fork with `cast receipt <hash> --rpc-url http://127.0.0.1:8545` (status 1).
Full re-run instructions: `docs/SETUP_FROM_SCRATCH.md`.

---

## Bugs found by running it end-to-end

Executing the full flow (rather than only reading the code) surfaced four real bugs, all fixed:

| Bug | Fix | Commit |
|---|---|---|
| Aave V3 pool address had an invalid EIP-55 checksum → viem rejected it | Corrected to the canonical checksummed address | `fd54fce` |
| `ensureAllowance` always approved the Uniswap router → Aave supply reverted (pool had no allowance) | Added a `spender` param (swap→router, supply→pool) | `fd54fce` |
| Aave borrow ran out of gas (viem under-estimated the health-factor/oracle path) | Pinned an explicit gas limit on supply/borrow | `1fbc728` |
| Calls didn't check `receipt.status` → a reverted tx returned a "success" hash | Throw on non-success | `19d28bc` |

---

## Summary

| Artifact | Where it runs | Status |
|---|---|---|
| Unit tests (pure helpers) | any machine (`bun`) | ✅ 21/21 |
| Live read-only mainnet (reads + Uniswap quote) | any machine + public RPC | ✅ live |
| On-chain write path (transfer/swap/supply/borrow) | mainnet fork (Anvil) | ✅ 4 tx hashes |

The Ethereum DeFi execution layer is verified end-to-end on real contracts. The agent/LLM layer
(driving these from chat) is documented in `docs/PHASE2_AGENT_CHAT.md` and `docs/PHASE3_ACTIONS.md`.
