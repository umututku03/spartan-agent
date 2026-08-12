import {
    type Action,
    type ActionExample,
    type ActionResult,
    type Content,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    ModelType,
    type State,
    composePromptFromState,
    logger,
    createUniqueUuid,
    parseJSONObjectFromText,
} from '@elizaos/core';
import {
    Connection,
    Keypair,
    PublicKey,
    VersionedTransaction,
} from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';
import { UUID } from 'crypto';
// import { getWalletKey } from '../keypairUtils'; // Commented out as module not found
import { SOLANA_SERVICE_NAME } from '../../autonomous-trader/constants';
// import type { SolanaService } from '../service'; // Commented out as module not found
// import type { Item } from '../types'; // Commented out as module not found
import { askLlmObject, takeItPrivate, getAccountFromMessage, getWalletsFromText, HasEntityIdFromMessage, getDataFromMessage } from '../../autonomous-trader/utils'
import {
    getEthereumWalletSummary,
    isEthereumAddress,
    swapEthereumExactIn,
    getEthereumTokenBalance,
} from '../utils/ethereum';
import { sizeSwap } from '../risk';
import { RiskService } from '../services/srv_risk';

/**
 * Interface representing the content of a swap with a specific wallet.
 */
interface SwapWalletContent extends Content {
    senderWalletAddress: string;
    inputTokenSymbol: string;
    outputTokenSymbol: string;
    inputTokenCA: string | null;
    outputTokenCA: string | null;
    amount: string | number;
    chain?: string;
}

/**
 * Checks if the given swap content is valid.
 */
function isSwapWalletContent(content: SwapWalletContent): boolean {
    logger.log('Content for swap', JSON.stringify(content));

    /*
    if (!content.sourceWalletAddress || typeof content.sourceWalletAddress !== 'string') {
        console.warn('bad sourceWalletAddress')
        return false;
    }
    */

    if (!content.amount || (typeof content.amount !== 'string' && typeof content.amount !== 'number')) {
        console.warn('bad amount', typeof (content.amount), content.amount)
        return false;
    }
    return true;
}

/**
 * Fetches the number of decimals for a given token mint address.
 */
// move to solana service
async function getTokenDecimals(connection: Connection, mintAddress: string): Promise<number> {
    const mintPublicKey = new PublicKey(mintAddress);
    const tokenAccountInfo = await connection.getParsedAccountInfo(mintPublicKey);

    if (
        tokenAccountInfo.value &&
        typeof tokenAccountInfo.value.data === 'object' &&
        'parsed' in tokenAccountInfo.value.data
    ) {
        const parsedInfo = tokenAccountInfo.value.data.parsed?.info;
        // tokenAmount?
        if (parsedInfo && typeof parsedInfo?.decimals === 'number') {
            return parsedInfo.decimals;
        }
    }
    throw new Error('Unable to fetch token decimals');
}

/**
 * Swaps tokens using Jupiter API.
 */
async function swapToken(
    connection: Connection,
    walletPublicKey: PublicKey,
    inputTokenCA: string,
    outputTokenCA: string,
    amount: number,
    runtime
): Promise<unknown> {
    try {
        const decimals =
            inputTokenCA === 'So11111111111111111111111111111111111111112'
                ? new BigNumber(9)
                : new BigNumber(await getTokenDecimals(connection, inputTokenCA));

        logger.log('Decimals:', decimals.toString());

        const amountBN = new BigNumber(amount);
        const adjustedAmount = amountBN.multipliedBy(new BigNumber(10).pow(decimals));

        logger.log('Fetching quote with params:', JSON.stringify({
            inputMint: inputTokenCA,
            outputMint: outputTokenCA,
            amount: adjustedAmount.toString(),
        }));

        const jupiterService = runtime.getService('JUPITER_SERVICE') as any;

        const quoteData = await jupiterService.getQuote({
            inputMint: inputTokenCA,
            outputMint: outputTokenCA,
            amount: adjustedAmount,
            slippageBps: 200,
        });

        /*
        const quoteResponse = await fetch(
            `https://quote-api.jup.ag/v6/quote?inputMint=${inputTokenCA}&outputMint=${outputTokenCA}&amount=${adjustedAmount}&dynamicSlippage=true&maxAccounts=64`
        );
        const quoteData = await quoteResponse.json();

        if (!quoteData || quoteData.error) {
            logger.error('Quote error:', quoteData);
            throw new Error(`Failed to get quote: ${quoteData?.error || 'Unknown error'}`);
        }
        */

        const swapRequestBody = {
            quoteResponse: quoteData,
            userPublicKey: walletPublicKey.toBase58(),
            dynamicComputeUnitLimit: true,
            dynamicSlippage: true,
            priorityLevelWithMaxLamports: {
                maxLamports: 4000000,
                priorityLevel: 'veryHigh',
            },
        };

        const swapData = await jupiterService.executeSwap({
            quoteResponse: quoteData,
            userPublicKey: walletPublicKey.toBase58(),
            slippageBps: 200.
        });

        /*
        const swapResponse = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(swapRequestBody),
        });

        const swapData = await swapResponse.json();
        */

        if (!swapData || !swapData.swapTransaction) {
            logger.error('Swap error:', swapData);
            throw new Error(
                `Failed to get swap transaction: ${swapData?.error || 'No swap transaction returned'}`
            );
        }

        return {
            ...swapData,
            quoteResponse: quoteData
        };
    } catch (error) {
        logger.error('Error in swapToken:', error instanceof Error ? error.message : String(error));
        throw error;
    }
}

/**
 * Template for determining the source wallet address.
 */
/*
const sourceAddressTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Recent Messages:
{{recentMessages}}

Extract the following information about the requested swap:
- Source wallet address to use for the swap

Example response:
\`\`\`json
{
    "sourceWalletAddress": "FcfoYfudjC6hnAWRrGw1zEkb87jSSky79A82hddzBFd1"
}
\`\`\`

Do NOT include any thinking, reasoning, or <think> sections in your response.
Go directly to the JSON response format without any preamble or explanation.

IMPORTANT: Your response must ONLY contain the json block above. Do not include any text, thinking, or reasoning before or after this JSON block. Start your response immediately with { and end with }.`;
*/

/**
 * Template for determining the swap details.
 */
const swapTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "inputTokenSymbol": "SOL",
    "outputTokenSymbol": "USDC",
    "inputTokenCA": "So11111111111111111111111111111111111111112",
    "outputTokenCA": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 1.5
}
\`\`\`

Ethereum example:
\`\`\`json
{
    "inputTokenSymbol": "ETH",
    "outputTokenSymbol": "USDC",
    "inputTokenCA": null,
    "outputTokenCA": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "amount": 0.1,
    "chain": "ethereum"
}
\`\`\`

{{recentMessages}}

Given the recent messages and wallet information below:

{{possibleWallets}}

Extract the following information about the requested token swap:
- Source wallet address
- Input token symbol (the token being sold)
- Output token symbol (the token being bought)
- Input token contract address if provided
- Output token contract address if provided
- Amount of input token to swap
- Chain if the request explicitly mentions Ethereum

Respond with a JSON markdown block containing only the extracted values. All fields are required`;

export default {
    name: 'MULTIWALLET_SWAP',
    similes: [
        'MULTIWALLET_SWAP_SOL',
        'MULTIWALLET_SWAP_TOKENS',
        'MULTIWALLET_TRADE_TOKENS',
        'MULTIWALLET_EXCHANGE_TOKENS',
        'MULTIWALLET_SWAP_SOL_TOKENS',
    ],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        // they have to be registered
        if (!await HasEntityIdFromMessage(runtime, message)) {
            return false
        }
        const account = await getAccountFromMessage(runtime, message)
        if (!account) {
            return false;
        }
        return true;
    },
    description: 'Swap tokens from one of your wallets using Solana Jupiter or Ethereum Uniswap V2.',
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback,
        responses?: Memory[]
    ): Promise<ActionResult | void | undefined> => {
        logger.log('MULTIWALLET_SWAP Starting handler...');
        const account = await getAccountFromMessage(runtime, message)
        if (!account) {
            return {
                success: false,
                text: 'Account not found',
                error: 'ACCOUNT_NOT_FOUND'
            }
        }

        // the source might not just be in the last message
        // might be in the context...

        const sources = await getWalletsFromText(runtime, message)
        const localWalletAddresses = account.metawallets.flatMap(mw => Object.values(mw.keypairs || {}).map((kp: any) => kp.publicKey))
        const matchingSources = sources.filter(source => localWalletAddresses.includes(source))
        if (matchingSources.length !== 1) {
            callback?.(takeItPrivate(runtime, message, "Can't determine source wallet"))
            return {
                success: false,
                text: "Can't determine source wallet",
                error: 'SOURCE_WALLET_AMBIGUOUS'
            }
        }
        const sourceResult = {
            sourceWalletAddress: matchingSources[0]
        }
        /*
        const sourcePrompt = composePromptFromState({
            state: state,
            template: sourceAddressTemplate,
        });
        const sourceResult = await runtime.useModel(ModelType.OBJECT_LARGE, {
            prompt: sourcePrompt,
        });
        */

        if (!sourceResult.sourceWalletAddress) {
            return {
                success: false,
                text: 'Could not determine source wallet address',
                error: 'SOURCE_WALLET_NOT_FOUND'
            };
        }

        // find this user's wallet
        //const entityId = createUniqueUuid(runtime, message.metadata.fromId);

        const asking = 'wallet swap';
        const serviceType = 'AUTONOMOUS_TRADER_INTERFACE_WALLETS';
        let interfaceWalletService = runtime.getService(serviceType) as any;
        while (!interfaceWalletService) {
            interfaceWalletService = runtime.getService(serviceType) as any;
            if (!interfaceWalletService) {
                await new Promise((waitResolve) => setTimeout(waitResolve, 1000));
            } else {
            }
        }

        //const metawallets = await interfaceWalletService.getWalletByUserEntityIds([entityId]);
        const userMetawallets = account.metawallets;

        // confirm wallet is in this list
        let found: Array<{ chain: string; kp: any }> = [];
        for (const mw of userMetawallets) {
            for (const [chain, kp] of Object.entries(mw.keypairs || {})) {
                if (kp?.publicKey?.toString() === sourceResult.sourceWalletAddress) {
                    found.push({ chain, kp });
                }
            }
        }

        if (!found.length) {
            return {
                success: false,
                text: 'No local wallet found with this source address',
                error: 'WALLET_NOT_FOUND'
            };
        }

        // gather possibilities
        let contextStr = '';
        const solanaService = runtime.getService(SOLANA_SERVICE_NAME) as any;
        for (const wallet of found) {
            const pubKey = wallet.kp.publicKey;
            if (wallet.chain === 'solana' && solanaService) {
                contextStr += 'Wallet Address: ' + pubKey + '\n';
                const pubKeyObj = new PublicKey(pubKey);
                const [balances, heldTokens] = await Promise.all([
                    solanaService.getBalancesByAddrs([pubKey]),
                    solanaService.getTokenAccountsByKeypair(pubKeyObj),
                ]);
                const solBal = balances[pubKey]
                contextStr += '  Chain: solana\n';
                contextStr += '  Token Address (Symbol)\n';
                contextStr += '  So11111111111111111111111111111111111111111 ($sol) balance: ' + (solBal ?? 'unknown') + '\n';
                for (const t of heldTokens) {
                    const amountRaw = t.account.data.parsed.info.tokenAmount.amount;
                    const ca = new PublicKey(t.account.data.parsed.info.mint);
                    const decimals = t.account.data.parsed.info.tokenAmount.decimals;
                    const balance = Number(amountRaw) / (10 ** decimals);
                    const symbol = await solanaService.getTokenSymbol(ca);
                    contextStr += '  ' + ca + ' ($' + symbol + ') balance: ' + balance + '\n';
                }
            } else if (wallet.chain === 'ethereum') {
                contextStr += await getEthereumWalletSummary(pubKey, runtime);
            }
            contextStr += '\n';
        }

        const swapPrompt = composePromptFromState({
            state: state,
            template: swapTemplate.replace('{{possibleWallets}}', contextStr),
        });

        /*
        const result = await runtime.useModel(ModelType.TEXT_LARGE, {
            prompt: swapPrompt,
        });

        const content = parseJSONObjectFromText(result) as SwapWalletContent;
    "inputTokenSymbol": "SOL",
    "outputTokenSymbol": "USDC",
    "inputTokenCA": "So11111111111111111111111111111111111111112",
    "outputTokenCA": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 1.5
        */

        // user might not give the tokenCA
        // they might not give the symbol (and give the CA instead)
        const content = await askLlmObject(runtime, { prompt: swapPrompt }, [
            'amount'
        ])

        if (content === null) {
            //return this.handler(runtime, message, state, _options, callback, responses)
            callback?.({ text: 'Could not figure out the request' });
            return {
                success: false,
                text: 'Could not figure out the request',
                error: 'LLM_PARSE_ERROR'
            }
        }


        // find source keypair
        const sourceWallet = found.find(wallet => wallet.kp.publicKey === sourceResult.sourceWalletAddress);
        if (!sourceWallet) {
            console.warn('MULTIWALLET_SWAP Could not find the specified wallet')
            callback?.({ text: 'Could not find the specified wallet' });
            return {
                success: false,
                text: 'Could not find the specified wallet',
                error: 'WALLET_NOT_FOUND'
            };
        }

        // clean up symbols
        content.inputTokenSymbol = content.inputTokenSymbol?.replace('$', '')
        content.outputTokenSymbol = content.outputTokenSymbol?.replace('$', '')
        const requestedChain = content.chain?.toLowerCase();
        const selectedChain = requestedChain || sourceWallet.chain || (isEthereumAddress(sourceResult.sourceWalletAddress) ? 'ethereum' : 'solana');

        // Fix Handle SOL addresses
        if (selectedChain === 'solana' && content.inputTokenSymbol?.toUpperCase() === 'SOL') {
            content.inputTokenCA = 'So11111111111111111111111111111111111111112';
        }
        if (selectedChain === 'solana' && content.outputTokenSymbol?.toUpperCase() === 'SOL') {
            content.outputTokenCA = 'So11111111111111111111111111111111111111112';
        }

        if (selectedChain === 'solana') {
            if (!solanaService.isValidSolanaAddress(content.inputTokenCA) || !solanaService.validateAddress(content.inputTokenCA)) {
                const pubKeyObj = new PublicKey(sourceResult.sourceWalletAddress);
                const heldTokens = await solanaService.getTokenAccountsByKeypair(pubKeyObj)
                for (const t of heldTokens) {
                    const ca = new PublicKey(t.account.data.parsed.info.mint);
                    const symbol = await solanaService.getTokenSymbol(ca);
                    if (symbol?.toUpperCase() === content.inputTokenSymbol?.toUpperCase()) {
                        content.inputTokenCA = ca;
                        break
                    }
                }
            }
            if (!solanaService.isValidSolanaAddress(content.outputTokenCA) || !solanaService.validateAddress(content.outputTokenCA)) {
                // outputTokenCA
            }
        }

        // do best to ensure input
        // do best to ensure output


        // check for input & output
        if (!isSwapWalletContent(content)) {
            callback?.({ text: 'Invalid swap parameters provided' });
            return {
                success: false,
                text: 'Invalid swap parameters provided',
                error: 'INVALID_PARAMETERS'
            };
        }

        if (selectedChain === 'ethereum') {
            try {
                // The LLM sometimes fills contract-address fields with the literal string "null"/
                // "undefined" (not a real null), which `||` would treat as a valid token and blow up
                // in resolveEthereumToken. Normalize those away and fall back to the symbol.
                const cleanTok = (v: any) =>
                    v && v !== 'null' && v !== 'undefined' && v !== '' ? v : undefined;
                const inputSym = cleanTok(content.inputTokenSymbol) || 'ETH';

                // --- Phase 4 / 4.2: deterministic regime-aware risk guard (pre-execution) ---
                // Vol-target the swap size against the wallet's spendable balance. Routed through the
                // shared RiskService (single source of truth, cached regime); falls back to the pure
                // sizeSwap guard if the service isn't available. When enforcing, clamp the amount to
                // the sized budget (which also corrects absurd LLM-extracted amounts, since the budget
                // never exceeds the spendable balance). The note is always surfaced in the reply.
                let execAmount: string | number = content.amount;
                let riskNote = '';
                try {
                    const risk = runtime.getService(RiskService.serviceType) as RiskService | null;
                    if (risk) {
                        const a = await risk.assessSwap({
                            walletAddress: sourceWallet.kp.publicKey,
                            symbol: inputSym,
                            requestedAmount: Number(content.amount),
                        });
                        riskNote = a.note;
                        if (risk.getConfig().enforce) execAmount = String(a.recommended);
                    } else {
                        const spendable = await getEthereumTokenBalance(sourceWallet.kp.publicKey, inputSym, runtime);
                        const guard = await sizeSwap({
                            symbol: inputSym,
                            spendableBalance: spendable,
                            requestedAmount: Number(content.amount),
                            runtime,
                        });
                        riskNote = guard.note;
                        if (guard.enforced) execAmount = String(guard.amount);
                    }
                } catch (e) {
                    riskNote = `Risk check skipped: ${(e as Error).message}`;
                }

                const swapResult = await swapEthereumExactIn({
                    privateKey: sourceWallet.kp.privateKey,
                    inputToken: cleanTok(content.inputTokenCA) || inputSym,
                    outputToken: cleanTok(content.outputTokenCA) || cleanTok(content.outputTokenSymbol),
                    amount: execAmount,
                }, runtime);

                const responseText = `Ethereum swap completed successfully!

**Tokens Swapped:**
- ${execAmount} ${swapResult.inputToken.symbol} -> ~${swapResult.quotedAmountOut} ${swapResult.outputToken.symbol}

**Risk layer:** ${riskNote}

**Transaction Details:**
- Transaction ID: \`${swapResult.hash}\`
- Etherscan: https://etherscan.io/tx/${swapResult.hash}

**Wallet:** ${sourceResult.sourceWalletAddress}`;

                callback?.(takeItPrivate(runtime, message, responseText))
                return {
                    success: true,
                    text: responseText,
                    data: {
                        chain: 'ethereum',
                        txid: swapResult.hash,
                        amount: content.amount,
                        inputToken: swapResult.inputToken.symbol,
                        outputToken: swapResult.outputToken.symbol,
                        outputAmount: swapResult.quotedAmountOut,
                    }
                };
            } catch (error) {
                logger.error('Error during Ethereum token swap:', error instanceof Error ? error.message : String(error));
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                callback?.(takeItPrivate(runtime, message, `Ethereum swap failed: ${errorMessage}`))
                return {
                    success: false,
                    text: `Ethereum swap failed: ${errorMessage}`,
                    error: errorMessage
                };
            }
        }

        const secretKey = bs58.decode(sourceWallet.kp.privateKey);
        const senderKeypair = Keypair.fromSecretKey(secretKey);

        try {
            const connection = new Connection(
                runtime.getSetting('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com'
            );

            const swapResult = (await swapToken(
                connection,
                senderKeypair.publicKey,
                content.inputTokenCA as string,
                content.outputTokenCA as string,
                Number(content.amount),
                runtime
            )) as { swapTransaction: string; quoteResponse?: any };


            const transactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuf);

            transaction.sign([senderKeypair]);

            const latestBlockhash = await connection.getLatestBlockhash();
            const txid = await connection.sendTransaction(transaction, {
                skipPreflight: false,
                maxRetries: 3,
                preflightCommitment: 'confirmed',
            });

            const confirmation = await connection.confirmTransaction(
                {
                    signature: txid,
                    blockhash: latestBlockhash.blockhash,
                    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
                },
                'confirmed'
            );

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${confirmation.value.err}`);
            }

            // Extract output amount from quote if available
            let outputAmount = 'Unknown';
            if (swapResult.quoteResponse?.outAmount) {
                const outputDecimals = content.outputTokenCA === 'So11111111111111111111111111111111111111112'
                    ? 9
                    : await getTokenDecimals(connection, content.outputTokenCA as string);
                const outAmountBN = new BigNumber(swapResult.quoteResponse.outAmount);
                outputAmount = outAmountBN.dividedBy(new BigNumber(10).pow(outputDecimals)).toString();
            }

            // Create Solscan link
            const solscanLink = `https://solscan.io/tx/${txid}`;

            // Format response with all details
            const responseText = `Swap completed successfully!

**Tokens Swapped:**
- ${content.amount} ${content.inputTokenSymbol} -> ${outputAmount} ${content.outputTokenSymbol}

**Transaction Details:**
- Transaction ID: \`${txid}\`
- Solscan: ${solscanLink}

**Wallet:** ${sourceResult.sourceWalletAddress}`;
            /*
            responses.length = 0;
            const memory: Memory = {
                entityId: uuidv4() as UUID,
                roomId: message.roomId,
                text: responseText,
                content: {
                    text: responseText,
                    success: true,
                    txid,
                    amount: content.amount,
                    sender: sourceResult.sourceWalletAddress,
                    inputToken: content.inputTokenSymbol,
                    outputToken: content.outputTokenSymbol,
                }
            };
            responses.push(memory);
            */
            callback?.(takeItPrivate(runtime, message, responseText))
            return {
                success: true,
                text: responseText,
                data: {
                    txid,
                    amount: content.amount,
                    inputToken: content.inputTokenSymbol,
                    outputToken: content.outputTokenSymbol,
                    outputAmount: outputAmount
                }
            };
        } catch (error) {
            logger.error('Error during token swap:', error instanceof Error ? error.message : String(error));
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            callback?.(takeItPrivate(runtime, message, `Swap failed: ${errorMessage}`))
            return {
                success: false,
                text: `Swap failed: ${errorMessage}`,
                error: errorMessage
            };
        }
    },
    examples: [
        [
            {
                name: '{{name1}}',
                content: {
                    text: 'Swap 0.1 SOL for USDC from my wallet FcfoYfudjC6hnAWRrGw1zEkb87jSSky79A82hddzBFd1',
                },
            },
            {
                name: '{{name2}}',
                content: {
                    text: "I'll help you swap 0.1 SOL for USDC",
                    actions: ['MULTIWALLET_SWAP'],
                },
            },
        ],
        [
            {
                name: '{{name1}}',
                content: {
                    text: 'Swap 0.05 ETH for USDC from my wallet 0x1111111111111111111111111111111111111111',
                },
            },
            {
                name: '{{name2}}',
                content: {
                    text: "I'll swap 0.05 ETH for USDC on Ethereum",
                    actions: ['MULTIWALLET_SWAP'],
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
