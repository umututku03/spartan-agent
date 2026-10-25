import { describe, it, expect } from 'vitest';
import {
  completedSwapsSection, findRepeatInRequest, getCompletedSwaps, recordCompletedSwap, type CompletedSwap,
} from '../swapRequestLedger';

// In-memory stand-in for the runtime cache.
function cacheRuntime() {
  const store = new Map<string, unknown>();
  return {
    getCache: async <T>(k: string) => store.get(k) as T | undefined,
    setCache: async <T>(k: string, v: T) => { store.set(k, v); return true; },
  };
}
const W = '0x6FF2e0DA2E0bcb67e7F5a7Cf55B2D2Fe92046aE0';
const sale: CompletedSwap = { requestId: 'msg-1', wallet: W, inputToken: 'ETH', outputToken: 'USDC', amount: '0.1', txid: '0xabc', at: 1 };

describe('swap request ledger', () => {
  it('records swaps per room', async () => {
    const rt = cacheRuntime();
    await recordCompletedSwap(rt, 'room-a', sale);
    expect(await getCompletedSwaps(rt, 'room-a')).toEqual([sale]);
    expect(await getCompletedSwaps(rt, 'room-b')).toEqual([]);
  });

  it('finds an exact repeat within the same request, whatever the formatting', () => {
    const candidate = { wallet: W.toLowerCase(), inputToken: '$eth', outputToken: 'usdc', amount: '0.10' };
    expect(findRepeatInRequest([sale], 'msg-1', candidate)).toEqual(sale);
  });

  it('allows the same swap on a new user request, and a different step in the same request', () => {
    expect(findRepeatInRequest([sale], 'msg-2', { wallet: W, inputToken: 'ETH', outputToken: 'USDC', amount: '0.1' })).toBeUndefined();
    expect(findRepeatInRequest([sale], 'msg-1', { wallet: W, inputToken: 'USDC', outputToken: 'DAI', amount: '59.4' })).toBeUndefined();
    expect(findRepeatInRequest([sale], 'msg-1', { wallet: W, inputToken: 'ETH', outputToken: 'USDC', amount: '0.07' })).toBeUndefined();
  });

  it('lists completed swaps for the extraction prompt, and nothing when there are none', () => {
    expect(completedSwapsSection([])).toBe('');
    const text = completedSwapsSection([sale]);
    expect(text).toContain('0.1 ETH -> USDC');
    expect(text).toContain('tx 0xabc');
  });
});
