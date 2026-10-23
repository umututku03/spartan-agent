import { describe, it, expect } from 'vitest';
import { TransactionReceiptNotFoundError, WaitForTransactionReceiptTimeoutError, type Hex } from 'viem';
import { EthereumTxPendingError, checkUnresolvedTransaction, waitForReceiptOrPending } from '../ethPending';

const HASH = `0x${'ab'.repeat(32)}` as Hex;

// Fake client: the wait times out; getTransactionReceipt returns the queued results in order.
function client(receipts: Array<{ status: string } | 'not-found'>) {
  return {
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => { throw new WaitForTransactionReceiptTimeoutError({ hash }); },
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const next = receipts.shift();
      if (!next || next === 'not-found') throw new TransactionReceiptNotFoundError({ hash });
      return next;
    },
  };
}

describe('waitForReceiptOrPending', () => {
  it('returns the receipt when it arrives', async () => {
    const ok = { waitForTransactionReceipt: async () => ({ status: 'success' }), getTransactionReceipt: async () => ({ status: 'success' }) };
    await expect(waitForReceiptOrPending(ok, HASH, '0x1')).resolves.toEqual({ status: 'success' });
  });

  it('turns a receipt timeout into EthereumTxPendingError carrying the hash', async () => {
    const err = await waitForReceiptOrPending(client([]), HASH, '0x2').catch(e => e);
    expect(err).toBeInstanceOf(EthereumTxPendingError);
    expect(err.hash).toBe(HASH);
  });

  it('passes other errors through unchanged', async () => {
    const boom = new Error('rpc down');
    const failing = { waitForTransactionReceipt: async () => { throw boom; }, getTransactionReceipt: async () => ({ status: 'success' }) };
    await expect(waitForReceiptOrPending(failing, HASH, '0x3')).rejects.toBe(boom);
  });
});

describe('checkUnresolvedTransaction', () => {
  it('returns null when the wallet has no timed-out transaction', async () => {
    expect(await checkUnresolvedTransaction(client([]), '0x4')).toBeNull();
  });

  it('reports pending until the receipt appears, then the outcome once, then forgets it', async () => {
    const c = client(['not-found', { status: 'success' }]);
    await waitForReceiptOrPending(c, HASH, '0xAbC5').catch(() => {});
    expect(await checkUnresolvedTransaction(c, '0xabc5')).toEqual({ hash: HASH, status: 'pending' });
    expect(await checkUnresolvedTransaction(c, '0xABC5')).toEqual({ hash: HASH, status: 'success' });
    expect(await checkUnresolvedTransaction(c, '0xabc5')).toBeNull();
  });

  it('reports a reverted earlier transaction', async () => {
    const c = client([{ status: 'reverted' }]);
    await waitForReceiptOrPending(c, HASH, '0x6').catch(() => {});
    expect(await checkUnresolvedTransaction(c, '0x6')).toEqual({ hash: HASH, status: 'reverted' });
  });
});
