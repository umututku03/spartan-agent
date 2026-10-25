/**
 * Chain selection for MULTIWALLET_SWAP.
 *
 * The ElizaOS 1.x JSON normalizer turns a JSON `null` into the string "null", and models also emit
 * "undefined" or "". All of these mean "not specified". Treating them as a chain name sent Ethereum
 * swaps down the Solana path ("Non-base58 character").
 */
const UNSET_VALUES = new Set(['', 'null', 'undefined']);

export function selectSwapChain(
  requestedChain: unknown,
  walletChain: string | undefined,
  walletIsEthereum: boolean
): string {
  const requested = typeof requestedChain === 'string' ? requestedChain.trim().toLowerCase() : '';
  if (!UNSET_VALUES.has(requested)) return requested;
  return walletChain || (walletIsEthereum ? 'ethereum' : 'solana');
}
