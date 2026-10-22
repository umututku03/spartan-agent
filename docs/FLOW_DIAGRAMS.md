# Spartan flow diagrams (Ethereum MVP)

Visual companion to [ARCHITECTURE.md](ARCHITECTURE.md), [PHASE3_ACTIONS.md](PHASE3_ACTIONS.md) and
[PHASE4_2_AGENT_RISK.md](PHASE4_2_AGENT_RISK.md). The diagrams follow the code on `ethereum-amm-agent`
(`src/index.ts`, `src/plugins/multiwallet/**`, `src/plugins/autonomous-trader/utils.ts`) and the run setup
verified in the phase documents: the web UI or Sessions API on `:3000`, OpenAI models, PGlite via
`plugin-sql`, and an Anvil mainnet fork as the Ethereum RPC. Discord, Telegram, Solana and Jupiter are
disabled in the Ethereum MVP character and appear dashed.

Diagrams are Mermaid and render on GitHub. Following the CSC490 architecture-diagram guidance (Lecture 3),
each one shows the system through one lens, names the actual components, and should be specific enough
to build from:

| Section | Lens | Question it answers |
|---|---|---|
| 1. Runtime overview | High level | Which processes, plugins and external systems exist, and how do they connect? |
| 2. One chat turn | Mid level (sequence) | What happens between a user message and an on-chain transaction? |
| 3. `MULTIWALLET_SWAP` | Component level | What exactly does the swap handler check, compute and send? |
| 4. Onboarding | User flow | What must a user do before wallet actions become available? |
| 5. Risk layer | Component level | Where is risk advisory, and where is it enforced? |

Evidence status: sections 1, 2 and 4 match the flows exercised live in [PHASE2_AGENT_CHAT.md](PHASE2_AGENT_CHAT.md)
and [PHASE3_ACTIONS.md](PHASE3_ACTIONS.md). Sections 3 and 5 are read from the code; the risk path is verified in
[PHASE4_2_AGENT_RISK.md](PHASE4_2_AGENT_RISK.md). The internals of `plugin-bootstrap` in section 2 are summarized at
the level the Spartan code depends on (providers, `validate()`, model selection, handler, callback). They are
not a line-by-line trace of the ElizaOS core.

Legend for section 1: solid boxes are enabled in the Ethereum MVP. Dashed boxes are present in the code or
character but disabled. Cylinders are data stores.

## 1. Runtime overview

```mermaid
flowchart TB
  subgraph Clients
    UI["Web UI :3000"]
    API["Sessions API<br/>/api/messaging/sessions"]
    DC["Discord / Telegram<br/>(disabled in MVP)"]
  end

  subgraph Server["ElizaOS AgentServer"]
    BUS["Message bus"]
  end

  subgraph Runtime["ElizaOS runtime: Spartan character"]
    BOOT["plugin-bootstrap<br/>message handling, action selection"]
    LLM["plugin-openai<br/>TEXT_LARGE / OBJECT_LARGE / embeddings"]
    DB[("plugin-sql<br/>PGlite: entities, components, memories, cache")]
    subgraph Plugins["Spartan plugins (src/index.ts)"]
      ACC["account<br/>register / verify"]
      AT["autonomous-trader<br/>account and wallet services, utils"]
      INTEL["degenIntel"]
      MW["multiwallet<br/>wallet actions, providers, RiskService"]
      TR["trading"]
      OTHER["kol, coin_marketing"]
    end
  end

  subgraph Chain["Ethereum JSON-RPC (ETHEREUM_RPC_URL)"]
    FORK["Anvil mainnet fork<br/>(or mainnet)"]
    UNI["Uniswap V2 router"]
    AAVE["Aave V3 pool"]
  end

  UI --> BUS
  API --> BUS
  DC -.-> BUS
  BUS --> BOOT
  BOOT <--> LLM
  BOOT <--> DB
  BOOT --> Plugins
  MW <--> DB
  ACC <--> DB
  MW -->|"viem: ethereum.ts"| FORK
  FORK --- UNI
  FORK --- AAVE
  BOOT -->|"reply via callback"| BUS

  classDef disabled stroke-dasharray: 5 5,color:#777
  class DC disabled
```

Concrete values from the verified setup: server port `3000`; `OPENAI_LARGE_MODEL=gpt-4o`;
`ETHEREUM_RPC_URL=http://127.0.0.1:8545` pointing at the Anvil fork; PGlite state under `packages/spartan/.eliza`.
Spartan runs as `packages/spartan` inside the ElizaOS `develop` monorepo ([SETUP_FROM_SCRATCH.md](SETUP_FROM_SCRATCH.md)).

## 2. One chat turn: message to action

Providers run before the model chooses. An action is only offered if its `validate()` passes. For
wallet actions, that requires a registered and verified account (see section 4). The model can still
reply conversationally or choose `IGNORE` even when an action is available ([PHASE3_ACTIONS.md](PHASE3_ACTIONS.md) §4).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant S as AgentServer / bus
  participant B as Bootstrap handler
  participant P as Providers
  participant M as LLM (OpenAI)
  participant A as Action
  participant C as Ethereum RPC

  U->>S: message, e.g. "swap 0.05 ETH to USDC using my wallet 0x..."
  S->>B: message received (stable sender id from metadata.raw.senderId)
  B->>P: compose state
  P-->>B: wallet summary, token info, RISK_GOVERNANCE budget (every turn)
  B->>A: validate() for candidate actions
  A-->>B: offered actions (wallet actions need a verified account)
  B->>M: prompt with character, state and offered actions
  M-->>B: reply text and chosen actions (or REPLY / IGNORE)
  alt a wallet action was chosen
    B->>A: handler(runtime, message, state, callback)
    A->>M: parameter extraction (askLlmObject, up to 3 retries)
    A->>C: reads, transaction, waitForTransactionReceipt
    C-->>A: receipt
    A-->>S: callback with result text (tx hash, risk note)
  else conversational reply or IGNORE
    B-->>S: reply text, or no reply on IGNORE
  end
  S-->>U: response
```

## 3. `MULTIWALLET_SWAP` on Ethereum

From `src/plugins/multiwallet/actions/act_wallet_swap.ts` and `swapEthereumExactIn` in
`src/plugins/multiwallet/utils/ethereum.ts`. The Solana branch is omitted (disabled in the MVP).

```mermaid
flowchart TD
  START(["MULTIWALLET_SWAP selected"]) --> V{"validate():<br/>entity and verified account?"}
  V -- no --> NOTOFFERED["Action not offered"]
  V -- yes --> SRC["Detect addresses in message text<br/>(getWalletsFromText)"]
  SRC --> ONE{"Exactly one matches<br/>the user's wallets?"}
  ONE -- no --> E1["Reply: Can't determine source wallet"]
  ONE -- yes --> CTX["Build wallet context<br/>(getEthereumWalletSummary)"]
  CTX --> EXTRACT["LLM extracts swap object<br/>tokens, amount, chain<br/>(askLlmObject, retries if amount missing)"]
  EXTRACT --> PARSED{"Parsed?"}
  PARSED -- no --> E2["Reply: Could not figure out the request"]
  PARSED -- yes --> CLEAN["Normalize symbols and 'null' addresses<br/>default input ETH"]
  CLEAN --> RISK["RiskService.assessSwap<br/>vol-target, half-Kelly, 25% wallet cap"]
  RISK --> ENF{"enforce on?<br/>(RISK_ENFORCE, default on)"}
  ENF -- yes --> CLAMP["Amount := recommended<br/>(may differ from the request)"]
  ENF -- no --> KEEP["Amount := extracted amount"]
  CLAMP --> QUOTE
  KEEP --> QUOTE["getAmountsOut quote<br/>amountOutMin = quote x (1 - 3% default slippage)<br/>deadline now + 20 min"]
  QUOTE --> SEND["swapExactETHForTokens / TokensForETH / TokensForTokens<br/>(approve first for ERC-20 input)"]
  SEND --> WAIT["waitForTransactionReceipt"]
  WAIT --> OK{"status success?"}
  WAIT -- "throws: timeout or RPC error" --> E3
  OK -- no --> E3["Reply: Ethereum swap failed"]
  OK -- yes --> DONE["Reply: amount, quoted output, risk note, tx hash"]
```

Notes:
- **What the user can control.** The user's request becomes one extracted object: tokens, amount and an optional chain. A minimum output, a reserve to keep, or a multi-step goal has no field in that object. Those constraints rely on the model's reply and on later turns.
- **Risk clamping.** With enforcement on, the executed amount can be smaller than requested. The reply states the executed amount and the risk note.
- **Slippage.** Slippage protection is a fixed 3% `amountOutMin` derived from the router quote at send time.
- **Failures after sending.** Every exception after the transaction is sent is reported as `Ethereum swap failed`, including a receipt wait that times out or an RPC error. The reply copies the library's error text, which may contain the hash. The handler itself records no submission and does not check the receipt again. A transaction that later mines is therefore reported as a failure.

## 4. Account and wallet onboarding

Wallet actions only become available after this sequence (verified in [PHASE3_ACTIONS.md](PHASE3_ACTIONS.md) §2).

```mermaid
stateDiagram-v2
  [*] --> Unregistered
  Unregistered --> CodeSent: USER_REGISTRATION with email
  CodeSent --> Verified: VERIFY_REGISTRATION_CODE with correct code
  CodeSent --> CodeSent: wrong code
  Verified --> WalletReady: WALLET_IMPORT (private key)
  WalletReady --> WalletReady: MULTIWALLET_SWAP / MULTIWALLET_TRANSFER / MULTIWALLET_ETHEREUM_LENDING / RISK_ASSESS / USER_METAWALLET_LIST
  note right of Verified
    account component verified:true in PGlite
    wallet actions' validate() now passes
  end note
```

## 5. Risk layer: advisory every turn, enforced at execution

```mermaid
flowchart LR
  subgraph Every_turn["Every turn (non-dynamic provider)"]
    RP["riskProvider (RISK_GOVERNANCE)"] --> CTXT["Context: regime, max swap,<br/>borrow headroom, 'Do NOT propose...'"]
  end
  subgraph On_request["On request"]
    RA["RISK_ASSESS action<br/>(read-only advisory)"]
  end
  subgraph At_execution["At execution (hard backstop)"]
    SW["MULTIWALLET_SWAP"] --> AS["assessSwap: clamp amount"]
    LD["MULTIWALLET_ETHEREUM_LENDING"] --> AB["assessBorrow: refuse if HF would fall below 1.5"]
  end
  RS[("RiskService<br/>regime cached 5 min<br/>vol fallback 0.8")]
  RP --> RS
  RA --> RS
  AS --> RS
  AB --> RS
  RS -->|"balances, Aave account data"| RPC["Ethereum RPC"]
```
