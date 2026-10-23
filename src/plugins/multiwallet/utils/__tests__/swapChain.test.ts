import { describe, it, expect } from 'vitest';
import { selectSwapChain } from '../swapChain';

describe('selectSwapChain', () => {
  it('uses an explicitly requested chain, case-insensitively', () => {
    expect(selectSwapChain('Ethereum', 'solana', false)).toBe('ethereum');
    expect(selectSwapChain(' solana ', 'ethereum', true)).toBe('solana');
  });

  it('treats null-like model output as unspecified and falls back to the wallet chain', () => {
    for (const unset of [null, undefined, '', 'null', 'NULL', 'undefined']) {
      expect(selectSwapChain(unset, 'ethereum', true)).toBe('ethereum');
    }
  });

  it('falls back to the wallet address type when the wallet has no chain', () => {
    expect(selectSwapChain('null', undefined, true)).toBe('ethereum');
    expect(selectSwapChain(null, undefined, false)).toBe('solana');
  });
});
