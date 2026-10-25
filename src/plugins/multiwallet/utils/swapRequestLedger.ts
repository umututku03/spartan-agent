/**
 * Swaps executed per conversation room, tagged with the user message (request) that triggered them.
 *
 * MULTIWALLET_SWAP re-extracts its parameters from the recent conversation each time it runs. In a
 * multi-step task the extractor kept returning the first step after it had executed, and the agent sold
 * again (issue #9). The ledger gives the extractor the list of swaps already done, and lets the handler
 * refuse an exact repeat within the same request. A new user message can still ask for the same swap.
 */
type CacheRuntime = {
  getCache<T>(key: string): Promise<T | undefined>;
  setCache<T>(key: string, value: T): Promise<boolean>;
};

export interface CompletedSwap {
  requestId: string;
  wallet: string;
  inputToken: string;
  outputToken: string;
  amount: string;
  txid: string;
  at: number;
}

export type SwapCandidate = Pick<CompletedSwap, 'wallet' | 'inputToken' | 'outputToken' | 'amount'>;

const cacheKey = (roomId: string) => `multiwallet_completed_swaps:${roomId}`;

export async function getCompletedSwaps(runtime: CacheRuntime, roomId: string): Promise<CompletedSwap[]> {
  return (await runtime.getCache<CompletedSwap[]>(cacheKey(roomId))) ?? [];
}

export async function recordCompletedSwap(runtime: CacheRuntime, roomId: string, swap: CompletedSwap): Promise<void> {
  const swaps = await getCompletedSwaps(runtime, roomId);
  await runtime.setCache(cacheKey(roomId), [...swaps, swap]);
}

const token = (t: string) => String(t ?? '').replace('$', '').trim().toUpperCase();

export function isSameSwap(a: SwapCandidate, b: SwapCandidate): boolean {
  return a.wallet.toLowerCase() === b.wallet.toLowerCase()
    && token(a.inputToken) === token(b.inputToken)
    && token(a.outputToken) === token(b.outputToken)
    && Number(a.amount) === Number(b.amount);
}

/** A swap identical to the candidate that already executed for this same request, if any. */
export function findRepeatInRequest(completed: CompletedSwap[], requestId: string, candidate: SwapCandidate): CompletedSwap | undefined {
  return completed.find(s => s.requestId === requestId && isSameSwap(s, candidate));
}

/** Prompt section listing the swaps already executed in this conversation (empty when there are none). */
export function completedSwapsSection(completed: CompletedSwap[]): string {
  if (!completed.length) return '';
  const lines = completed.map(s => `- ${s.amount} ${token(s.inputToken)} -> ${token(s.outputToken)} from ${s.wallet} (tx ${s.txid})`);
  return `Swaps already executed in this conversation (they are done; do not extract them again, extract the step the user still needs):\n${lines.join('\n')}\n`;
}
