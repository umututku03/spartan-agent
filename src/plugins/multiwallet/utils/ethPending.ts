import { WaitForTransactionReceiptTimeoutError, type Hex } from 'viem';

/**
 * A transaction was broadcast but its receipt did not arrive within the wait. It may still be mined,
 * so callers must not report it as failed or retry it blindly.
 */
export class EthereumTxPendingError extends Error {
  constructor(readonly hash: Hex, readonly walletAddress: string) {
    super(`Transaction ${hash} was submitted but is not confirmed yet; its outcome is unknown`);
    this.name = 'EthereumTxPendingError';
  }
}

type ReceiptClient = {
  waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: string }>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{ status: string }>;
};

export type PendingCheck = { hash: Hex; status: 'pending' | 'success' | 'reverted' };

// Transactions whose receipt wait timed out, by lower-cased sender address. In-memory: one agent process.
const unresolved = new Map<string, Hex>();

/** Wait for the receipt; on a timeout, remember the hash and throw EthereumTxPendingError instead of a generic failure. */
export async function waitForReceiptOrPending(client: ReceiptClient, hash: Hex, walletAddress: string) {
  try {
    return await client.waitForTransactionReceipt({ hash });
  } catch (error) {
    if (error instanceof WaitForTransactionReceiptTimeoutError) {
      unresolved.set(walletAddress.toLowerCase(), hash);
      throw new EthereumTxPendingError(hash, walletAddress);
    }
    throw error;
  }
}

/**
 * Status of an earlier timed-out transaction from this wallet, or null if there is none. A confirmed or
 * reverted transaction is forgotten once reported; a still-unknown one stays recorded.
 */
export async function checkUnresolvedTransaction(client: ReceiptClient, walletAddress: string): Promise<PendingCheck | null> {
  const key = walletAddress.toLowerCase();
  const hash = unresolved.get(key);
  if (!hash) return null;
  let receipt: { status: string } | null = null;
  try {
    receipt = await client.getTransactionReceipt({ hash });
  } catch {
    // viem throws TransactionReceiptNotFoundError while the transaction is not mined.
  }
  if (!receipt) return { hash, status: 'pending' };
  unresolved.delete(key);
  return { hash, status: receipt.status === 'success' ? 'success' : 'reverted' };
}
