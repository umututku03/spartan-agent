/**
 * Read-only liveness check for the Ethereum utils — no funds, no fork needed.
 *
 * Exercises the agent's own ethereum.ts against a live RPC: derives an address,
 * reads a real wallet's balances, resolves a token, and pulls a live Uniswap V2
 * quote via the same router/call the swap path uses.
 *
 * Usage (from the repo root, with deps installed):
 *   ETHEREUM_RPC_URL="https://ethereum-rpc.publicnode.com" bun run scripts/demo-readonly.ts
 */
import {
  privateKeyToEthereumAddress,
  getEthereumWalletSummary,
  resolveEthereumToken,
} from '../src/plugins/multiwallet/utils/ethereum';
import { createPublicClient, http, parseEther, formatUnits } from 'viem';
import { mainnet } from 'viem/chains';

const RPC = process.env.ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com';
console.log('RPC in use (ETHEREUM_RPC_URL):', RPC);

// [1] offline: derive an address from a private key (Anvil dev key #0)
const pk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
console.log('\n[1] privateKeyToEthereumAddress ->', privateKeyToEthereumAddress(pk));

// [2] LIVE read via the agent's own helper (example: a Binance hot wallet)
const target = process.env.DEMO_ADDRESS || '0x28C6c06298d514Db089934071355E5743bf21d60';
console.log('\n[2] getEthereumWalletSummary (LIVE) for', target);
console.log(await getEthereumWalletSummary(target));

// [3] token resolution used across the swap/lending paths
console.log('[3] resolveEthereumToken("USDC") ->', await resolveEthereumToken('USDC'));

// [4] LIVE Uniswap V2 quote via the same router + call swapEthereumExactIn uses
const ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const client = createPublicClient({ chain: mainnet, transport: http(RPC) });
const amounts = (await client.readContract({
  address: ROUTER,
  abi: [
    {
      type: 'function',
      name: 'getAmountsOut',
      stateMutability: 'view',
      inputs: [
        { name: 'amountIn', type: 'uint256' },
        { name: 'path', type: 'address[]' },
      ],
      outputs: [{ name: 'amounts', type: 'uint256[]' }],
    },
  ],
  functionName: 'getAmountsOut',
  args: [parseEther('1'), [WETH, USDC]],
})) as bigint[];
console.log('\n[4] LIVE Uniswap V2 quote: 1 WETH ->', formatUnits(amounts[amounts.length - 1], 6), 'USDC');

console.log('\nDone — all calls executed against a live Ethereum RPC (read-only).');
