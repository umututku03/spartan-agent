import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  maxUint256,
  parseEther,
  parseUnits,
} from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as Address;
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address;
const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as Address;

const UNISWAP_V2_ROUTER_ABI = [
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
  {
    type: 'function',
    name: 'swapExactETHForTokens',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'swapExactTokensForETH',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'swapExactTokensForTokens',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const;

const AAVE_V3_POOL_ABI = [
  {
    type: 'function',
    name: 'supply',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'referralCode', type: 'uint16' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [],
  },
] as const;

const KNOWN_TOKENS: Record<string, { address?: Address; symbol: string; decimals: number; isNative?: boolean }> = {
  ETH: { symbol: 'ETH', decimals: 18, isNative: true },
  WETH: { address: WETH_ADDRESS, symbol: 'WETH', decimals: 18 },
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
  DAI: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
};

export type EthereumToken = {
  address?: Address;
  symbol: string;
  decimals: number;
  isNative: boolean;
};

type SwapRequest = {
  privateKey: string;
  inputToken: string;
  outputToken: string;
  amount: string | number;
  slippageBps?: number;
  recipient?: Address;
  rpcUrl?: string;
};

type SwapResult = {
  hash: string;
  walletAddress: Address;
  chain: 'ethereum';
  inputToken: EthereumToken;
  outputToken: EthereumToken;
  amountIn: string;
  quotedAmountOut: string;
  quotedAmountOutRaw: bigint;
};

type TransferRequest = {
  privateKey: string;
  recipient: Address;
  token: string | null;
  amount: string | number;
  rpcUrl?: string;
};

type TransferResult = {
  hash: string;
  walletAddress: Address;
  recipient: Address;
  token: EthereumToken;
  amount: string;
};

type LendingRequest = {
  privateKey: string;
  action: 'supply' | 'borrow';
  token: string;
  amount: string | number;
  rpcUrl?: string;
};

type LendingResult = {
  hash: string;
  walletAddress: Address;
  action: 'supply' | 'borrow';
  token: EthereumToken;
  amount: string;
  protocol: 'aave-v3';
};

function getRpcUrl(runtime?: { getSetting?: (key: string) => string | undefined }, override?: string): string {
  return (
    override ||
    runtime?.getSetting?.('ETHEREUM_RPC_URL') ||
    runtime?.getSetting?.('EVM_PROVIDER_URL') ||
    process.env.ETHEREUM_RPC_URL ||
    process.env.EVM_PROVIDER_URL ||
    'https://eth.llamarpc.com'
  );
}

function getPublicClient(runtime?: { getSetting?: (key: string) => string | undefined }, rpcUrl?: string) {
  return createPublicClient({
    chain: mainnet,
    transport: http(getRpcUrl(runtime, rpcUrl)),
  });
}

function getWalletClient(
  privateKey: string,
  runtime?: { getSetting?: (key: string) => string | undefined },
  rpcUrl?: string
) {
  const account = privateKeyToAccount(normalizeEthereumPrivateKey(privateKey));
  return createWalletClient({
    account,
    chain: mainnet,
    transport: http(getRpcUrl(runtime, rpcUrl)),
  });
}

export function isEthereumAddress(value?: string | null): value is Address {
  return !!value && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function normalizeEthereumPrivateKey(value: string): Hex {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error('Invalid Ethereum private key');
  }
  return normalized as Hex;
}

export function detectEthereumPrivateKeysFromText(text: string): Hex[] {
  const matches = text.match(/(?:0x)?[a-fA-F0-9]{64}\b/g) || [];
  const keys: Hex[] = [];
  for (const match of matches) {
    try {
      const normalized = normalizeEthereumPrivateKey(match);
      if (!keys.includes(normalized)) {
        keys.push(normalized);
      }
    } catch {
      continue;
    }
  }
  return keys;
}

export function detectEthereumAddressesFromText(text: string): Address[] {
  const matches = text.match(/0x[a-fA-F0-9]{40}\b/g) || [];
  return [...new Set(matches.filter(isEthereumAddress))] as Address[];
}

export function privateKeyToEthereumAddress(privateKey: string): Address {
  return privateKeyToAccount(normalizeEthereumPrivateKey(privateKey)).address;
}

async function readTokenMetadata(
  address: Address,
  runtime?: { getSetting?: (key: string) => string | undefined },
  rpcUrl?: string
): Promise<EthereumToken> {
  const publicClient = getPublicClient(runtime, rpcUrl);
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({
      address,
      abi: erc20Abi,
      functionName: 'symbol',
    }) as Promise<string>,
    publicClient.readContract({
      address,
      abi: erc20Abi,
      functionName: 'decimals',
    }) as Promise<number>,
  ]);

  return {
    address,
    symbol,
    decimals,
    isNative: false,
  };
}

export async function resolveEthereumToken(
  token: string,
  runtime?: { getSetting?: (key: string) => string | undefined },
  rpcUrl?: string
): Promise<EthereumToken> {
  const cleaned = token.trim();
  const upper = cleaned.toUpperCase();
  if (KNOWN_TOKENS[upper]) {
    const known = KNOWN_TOKENS[upper];
    return {
      address: known.address,
      symbol: known.symbol,
      decimals: known.decimals,
      isNative: !!known.isNative,
    };
  }

  if (!isEthereumAddress(cleaned)) {
    throw new Error(`Unsupported Ethereum token: ${token}`);
  }

  return readTokenMetadata(cleaned, runtime, rpcUrl);
}

function buildPath(inputToken: EthereumToken, outputToken: EthereumToken): Address[] {
  const inputAddress = inputToken.isNative ? WETH_ADDRESS : inputToken.address;
  const outputAddress = outputToken.isNative ? WETH_ADDRESS : outputToken.address;

  if (!inputAddress || !outputAddress) {
    throw new Error('Unable to build Ethereum swap path');
  }

  if (inputAddress.toLowerCase() === outputAddress.toLowerCase()) {
    throw new Error('Input and output token cannot be the same');
  }

  if (inputAddress.toLowerCase() === WETH_ADDRESS.toLowerCase() || outputAddress.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
    return [inputAddress, outputAddress];
  }

  return [inputAddress, WETH_ADDRESS, outputAddress];
}

async function ensureAllowance(
  privateKey: string,
  token: EthereumToken,
  amount: bigint,
  spender: Address,
  runtime?: { getSetting?: (key: string) => string | undefined },
  rpcUrl?: string
) {
  if (token.isNative || !token.address) {
    return;
  }

  const publicClient = getPublicClient(runtime, rpcUrl);
  const walletClient = getWalletClient(privateKey, runtime, rpcUrl);

  const allowance = await publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [walletClient.account.address, spender],
  }) as bigint;

  if (allowance >= amount) {
    return;
  }

  const hash = await walletClient.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
    chain: mainnet,
    account: walletClient.account,
  });

  await publicClient.waitForTransactionReceipt({ hash });
}

export async function getEthereumWalletSummary(
  walletAddress: string,
  runtime?: { getSetting?: (key: string) => string | undefined },
  rpcUrl?: string
): Promise<string> {
  if (!isEthereumAddress(walletAddress)) {
    throw new Error('Invalid Ethereum wallet address');
  }

  const publicClient = getPublicClient(runtime, rpcUrl);
  const ethBalance = await publicClient.getBalance({ address: walletAddress });

  let summary = `Wallet Address: ${walletAddress}\n`;
  summary += `  Chain: ethereum\n`;
  summary += `  ETH balance: ${formatEther(ethBalance)}\n`;

  for (const symbol of ['WETH', 'USDC', 'USDT', 'DAI']) {
    const token = KNOWN_TOKENS[symbol];
    if (!token.address) continue;

    try {
      const balance = await publicClient.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletAddress],
      }) as bigint;

      if (balance > 0n) {
        summary += `  ${token.address} ($${token.symbol}) balance: ${formatUnits(balance, token.decimals)}\n`;
      }
    } catch {
      continue;
    }
  }

  return summary;
}

export async function swapEthereumExactIn(
  request: SwapRequest,
  runtime?: { getSetting?: (key: string) => string | undefined }
): Promise<SwapResult> {
  const rpcUrl = getRpcUrl(runtime, request.rpcUrl);
  const publicClient = getPublicClient(runtime, rpcUrl);
  const walletClient = getWalletClient(request.privateKey, runtime, rpcUrl);
  const account = walletClient.account;

  const [inputToken, outputToken] = await Promise.all([
    resolveEthereumToken(request.inputToken, runtime, rpcUrl),
    resolveEthereumToken(request.outputToken, runtime, rpcUrl),
  ]);

  const amountIn = inputToken.isNative
    ? parseEther(String(request.amount))
    : parseUnits(String(request.amount), inputToken.decimals);

  const path = buildPath(inputToken, outputToken);
  const quote = await publicClient.readContract({
    address: UNISWAP_V2_ROUTER,
    abi: UNISWAP_V2_ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: [amountIn, path],
  }) as bigint[];

  const quotedAmountOutRaw = quote[quote.length - 1];
  const slippageBps = BigInt(request.slippageBps ?? 300);
  const amountOutMin = (quotedAmountOutRaw * (10000n - slippageBps)) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  const recipient = request.recipient || account.address;

  let hash: Hex;

  if (inputToken.isNative) {
    hash = await walletClient.writeContract({
      address: UNISWAP_V2_ROUTER,
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: 'swapExactETHForTokens',
      args: [amountOutMin, path, recipient, deadline],
      value: amountIn,
      chain: mainnet,
      account,
    });
  } else if (outputToken.isNative) {
    await ensureAllowance(request.privateKey, inputToken, amountIn, UNISWAP_V2_ROUTER, runtime, rpcUrl);
    hash = await walletClient.writeContract({
      address: UNISWAP_V2_ROUTER,
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: 'swapExactTokensForETH',
      args: [amountIn, amountOutMin, path, recipient, deadline],
      chain: mainnet,
      account,
    });
  } else {
    await ensureAllowance(request.privateKey, inputToken, amountIn, UNISWAP_V2_ROUTER, runtime, rpcUrl);
    hash = await walletClient.writeContract({
      address: UNISWAP_V2_ROUTER,
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [amountIn, amountOutMin, path, recipient, deadline],
      chain: mainnet,
      account,
    });
  }

  await publicClient.waitForTransactionReceipt({ hash });

  return {
    hash,
    walletAddress: account.address,
    chain: 'ethereum',
    inputToken,
    outputToken,
    amountIn: String(request.amount),
    quotedAmountOut: formatUnits(quotedAmountOutRaw, outputToken.decimals),
    quotedAmountOutRaw,
  };
}

export async function transferEthereumAsset(
  request: TransferRequest,
  runtime?: { getSetting?: (key: string) => string | undefined }
): Promise<TransferResult> {
  const rpcUrl = getRpcUrl(runtime, request.rpcUrl);
  const publicClient = getPublicClient(runtime, rpcUrl);
  const walletClient = getWalletClient(request.privateKey, runtime, rpcUrl);
  const account = walletClient.account;

  const token = request.token ? await resolveEthereumToken(request.token, runtime, rpcUrl) : {
    symbol: 'ETH',
    decimals: 18,
    isNative: true,
  };

  let hash: Hex;

  if (token.isNative) {
    hash = await walletClient.sendTransaction({
      account,
      chain: mainnet,
      to: request.recipient,
      value: parseEther(String(request.amount)),
    });
  } else {
    if (!token.address) {
      throw new Error('ERC-20 token address is required');
    }

    hash = await walletClient.writeContract({
      account,
      chain: mainnet,
      address: token.address,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [request.recipient, parseUnits(String(request.amount), token.decimals)],
    });
  }

  await publicClient.waitForTransactionReceipt({ hash });

  return {
    hash,
    walletAddress: account.address,
    recipient: request.recipient,
    token,
    amount: String(request.amount),
  };
}

function getAaveTokenAlias(token: string): string {
  return token.trim().toUpperCase() === 'ETH' ? 'WETH' : token;
}

export async function executeEthereumLendingAction(
  request: LendingRequest,
  runtime?: { getSetting?: (key: string) => string | undefined }
): Promise<LendingResult> {
  const rpcUrl = getRpcUrl(runtime, request.rpcUrl);
  const publicClient = getPublicClient(runtime, rpcUrl);
  const walletClient = getWalletClient(request.privateKey, runtime, rpcUrl);
  const account = walletClient.account;

  const token = await resolveEthereumToken(getAaveTokenAlias(request.token), runtime, rpcUrl);
  if (token.isNative || !token.address) {
    throw new Error('Aave actions require an ERC-20 asset; use WETH instead of native ETH');
  }

  const amount = parseUnits(String(request.amount), token.decimals);
  let hash: Hex;

  if (request.action === 'supply') {
    await ensureAllowance(request.privateKey, token, amount, AAVE_V3_POOL, runtime, rpcUrl);
    hash = await walletClient.writeContract({
      account,
      chain: mainnet,
      address: AAVE_V3_POOL,
      abi: AAVE_V3_POOL_ABI,
      functionName: 'supply',
      args: [token.address, amount, account.address, 0],
    });
  } else {
    hash = await walletClient.writeContract({
      account,
      chain: mainnet,
      address: AAVE_V3_POOL,
      abi: AAVE_V3_POOL_ABI,
      functionName: 'borrow',
      args: [token.address, amount, 2n, 0, account.address],
    });
  }

  await publicClient.waitForTransactionReceipt({ hash });

  return {
    hash,
    walletAddress: account.address,
    action: request.action,
    token,
    amount: String(request.amount),
    protocol: 'aave-v3',
  };
}
