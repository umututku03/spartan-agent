import { describe, it, expect } from 'vitest';
import {
  detectEthereumPrivateKeysFromText,
  detectEthereumAddressesFromText,
  normalizeEthereumPrivateKey,
  privateKeyToEthereumAddress,
  isEthereumAddress,
  resolveEthereumToken,
} from '../ethereum';

// Well-known deterministic vectors (no network needed):
// - Anvil / Hardhat dev account #0
const ANVIL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
// - secp256k1 base point (private key = 1)
const ONE_PK = '0x0000000000000000000000000000000000000000000000000000000000000001';
const ONE_ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

describe('normalizeEthereumPrivateKey', () => {
  it('adds the 0x prefix when missing', () => {
    expect(normalizeEthereumPrivateKey(ANVIL_PK.slice(2))).toBe(ANVIL_PK);
  });

  it('passes through an already-prefixed key', () => {
    expect(normalizeEthereumPrivateKey(ANVIL_PK)).toBe(ANVIL_PK);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEthereumPrivateKey(`  ${ANVIL_PK}  `)).toBe(ANVIL_PK);
  });

  it('throws on the wrong length', () => {
    expect(() => normalizeEthereumPrivateKey('0xdeadbeef')).toThrow('Invalid Ethereum private key');
  });

  it('throws on non-hex characters', () => {
    const bad = '0x' + 'z'.repeat(64);
    expect(() => normalizeEthereumPrivateKey(bad)).toThrow('Invalid Ethereum private key');
  });
});

describe('privateKeyToEthereumAddress', () => {
  it('derives the Anvil account #0 address', () => {
    expect(privateKeyToEthereumAddress(ANVIL_PK)).toBe(ANVIL_ADDR);
  });

  it('derives the base-point address from key = 1', () => {
    expect(privateKeyToEthereumAddress(ONE_PK)).toBe(ONE_ADDR);
  });

  it('works without the 0x prefix', () => {
    expect(privateKeyToEthereumAddress(ANVIL_PK.slice(2))).toBe(ANVIL_ADDR);
  });
});

describe('isEthereumAddress', () => {
  it('accepts a valid checksummed/lowercase 40-hex address', () => {
    expect(isEthereumAddress(ANVIL_ADDR)).toBe(true);
    expect(isEthereumAddress(ANVIL_ADDR.toLowerCase())).toBe(true);
  });

  it('rejects malformed / empty values', () => {
    expect(isEthereumAddress('0x123')).toBe(false);
    expect(isEthereumAddress('f39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe(false); // no 0x
    expect(isEthereumAddress(undefined)).toBe(false);
    expect(isEthereumAddress(null)).toBe(false);
    expect(isEthereumAddress('')).toBe(false);
  });
});

describe('detectEthereumPrivateKeysFromText', () => {
  it('extracts a key embedded in a sentence (with 0x)', () => {
    const text = `please import my wallet ${ANVIL_PK} thanks`;
    expect(detectEthereumPrivateKeysFromText(text)).toEqual([ANVIL_PK]);
  });

  it('normalizes a key given without the 0x prefix', () => {
    const text = `key is ${ANVIL_PK.slice(2)}`;
    expect(detectEthereumPrivateKeysFromText(text)).toEqual([ANVIL_PK]);
  });

  it('deduplicates repeated keys', () => {
    const text = `${ANVIL_PK} and again ${ANVIL_PK}`;
    expect(detectEthereumPrivateKeysFromText(text)).toEqual([ANVIL_PK]);
  });

  it('returns empty when there is no 64-hex string', () => {
    expect(detectEthereumPrivateKeysFromText('no keys here, just 0xdeadbeef')).toEqual([]);
  });
});

describe('detectEthereumAddressesFromText', () => {
  it('extracts a 40-hex address', () => {
    const text = `send to ${ANVIL_ADDR} now`;
    expect(detectEthereumAddressesFromText(text)).toEqual([ANVIL_ADDR]);
  });

  it('deduplicates repeated addresses', () => {
    const text = `${ANVIL_ADDR} ${ANVIL_ADDR}`;
    expect(detectEthereumAddressesFromText(text)).toEqual([ANVIL_ADDR]);
  });

  it('does not mistake a 64-hex private key for an address', () => {
    // a 64-hex key has no word boundary after 40 hex chars, so it must not match
    expect(detectEthereumAddressesFromText(ANVIL_PK)).toEqual([]);
  });
});

describe('resolveEthereumToken (known tokens, no network)', () => {
  it('resolves native ETH', async () => {
    const t = await resolveEthereumToken('ETH');
    expect(t).toMatchObject({ symbol: 'ETH', decimals: 18, isNative: true });
  });

  it('resolves USDC with the correct address and decimals', async () => {
    const t = await resolveEthereumToken('usdc');
    expect(t).toMatchObject({
      symbol: 'USDC',
      decimals: 6,
      isNative: false,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
  });

  it('resolves WETH case-insensitively', async () => {
    const t = await resolveEthereumToken('WeTh');
    expect(t).toMatchObject({ symbol: 'WETH', decimals: 18, isNative: false });
  });

  it('throws on an unknown non-address token', async () => {
    await expect(resolveEthereumToken('NOTATOKEN')).rejects.toThrow('Unsupported Ethereum token');
  });
});
