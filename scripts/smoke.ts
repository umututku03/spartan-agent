/**
 * On-chain smoke test for the Ethereum flows — runs the state-changing paths
 * (transfer -> swap -> Aave supply -> Aave borrow) against a LOCAL MAINNET FORK.
 *
 * Prereqs:
 *   1. Start a fork:   anvil --fork-url https://eth-mainnet.g.alchemy.com/v2/<KEY>
 *   2. Point at it:    export ETHEREUM_RPC_URL="http://127.0.0.1:8545"
 *   3. Run:            bun run scripts/smoke.ts
 *
 * Uses Anvil dev account #0 (pre-funded on the fork). Order matters: swap first
 * to obtain USDC, supply before borrow (borrowing with no collateral reverts).
 * Prints a real transaction hash for each step.
 */
import {
  privateKeyToEthereumAddress,
  getEthereumWalletSummary,
  transferEthereumAsset,
  swapEthereumExactIn,
  executeEthereumLendingAction,
} from '../src/plugins/multiwallet/utils/ethereum';

const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Anvil #0
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // Anvil #1

const me = privateKeyToEthereumAddress(PK);
console.log('wallet:', me);
console.log('RPC:', process.env.ETHEREUM_RPC_URL || '(default)');
console.log('\n--- before ---\n' + (await getEthereumWalletSummary(me)));

const t = await transferEthereumAsset({ privateKey: PK, recipient: RECIPIENT, token: null, amount: '0.1' });
console.log('transfer tx:', t.hash);

const s = await swapEthereumExactIn({ privateKey: PK, inputToken: 'ETH', outputToken: 'USDC', amount: '0.5' });
console.log('swap tx:', s.hash, '| ~USDC out:', s.quotedAmountOut);

const sup = await executeEthereumLendingAction({ privateKey: PK, action: 'supply', token: 'USDC', amount: '100' });
console.log('Aave supply tx:', sup.hash);

const bor = await executeEthereumLendingAction({ privateKey: PK, action: 'borrow', token: 'DAI', amount: '10' });
console.log('Aave borrow tx:', bor.hash);

console.log('\n--- after ---\n' + (await getEthereumWalletSummary(me)));
console.log('Smoke test complete — inspect any hash with: cast tx <hash> --rpc-url $ETHEREUM_RPC_URL');
