import { describe, it, expect } from 'vitest';
import { executedAmountFields } from '../swapResult';

describe('executedAmountFields', () => {
  it('reports the executed amount and the request when the risk layer clamped it', () => {
    expect(executedAmountFields('0.1', '0.0998')).toEqual({ amount: '0.0998', requestedAmount: '0.1', clamped: true });
  });

  it('marks an unclamped swap whatever the number formatting', () => {
    expect(executedAmountFields(0.1, '0.1')).toEqual({ amount: '0.1', requestedAmount: 0.1, clamped: false });
    expect(executedAmountFields('0.10', '0.1').clamped).toBe(false);
  });
});
