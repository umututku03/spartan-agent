/**
 * Live verification of the borrow health-factor guard against REAL Aave v3 state on the fork.
 * Decoupled from the LLM: reads the wallet's actual getUserAccountData and runs guardBorrow for a
 * small (allowed) and a large (refused) borrow.
 *
 *   ETHEREUM_RPC_URL=http://127.0.0.1:8545 bun run scripts/verify-hf-guard.ts <walletAddress>
 */
import { getAaveUserAccountData } from '../src/plugins/multiwallet/utils/ethereum';
import { guardBorrow } from '../src/plugins/multiwallet/risk';

const wallet = process.argv[2] || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const BASE = 1e8; // Aave base currency = USD, 8 decimals

const acct = await getAaveUserAccountData(wallet);
console.log('Live Aave account data (fork) for', wallet);
console.log(`  totalCollateralBase = $${(acct.totalCollateralBase / BASE).toFixed(2)}`);
console.log(`  totalDebtBase       = $${(acct.totalDebtBase / BASE).toFixed(2)}`);
console.log(`  liquidationThreshold= ${(acct.liquidationThreshold * 100).toFixed(1)}%`);
console.log(`  Aave healthFactor   = ${acct.healthFactor === Infinity ? 'inf' : acct.healthFactor.toFixed(3)}`);

for (const borrowUsd of [20, 50, 300]) {
  const d = guardBorrow({
    accountData: {
      totalCollateralBase: acct.totalCollateralBase,
      totalDebtBase: acct.totalDebtBase,
      liquidationThreshold: acct.liquidationThreshold,
    },
    newBorrowBase: borrowUsd * BASE,
  });
  console.log(
    `  borrow $${String(borrowUsd).padStart(3)} -> ${d.allowed ? 'ALLOWED' : 'REFUSED'}  (${d.reason})`
  );
}
