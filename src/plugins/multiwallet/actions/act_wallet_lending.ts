import {
    type Action,
    type ActionExample,
    type ActionResult,
    type Content,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type State,
    composePromptFromState,
    logger,
} from '@elizaos/core';
import { askLlmObject, getAccountFromMessage, getWalletsFromText, HasEntityIdFromMessage, takeItPrivate } from '../../autonomous-trader/utils';
import {
    executeEthereumLendingAction,
    getEthereumWalletSummary,
} from '../utils/ethereum';
import { RiskService } from '../services/srv_risk';

interface LendingContent extends Content {
    action: 'supply' | 'borrow';
    senderWalletAddress: string;
    tokenSymbol: string;
    amount: string | number;
    protocol?: string;
    chain?: string;
}

function isLendingContent(content: LendingContent): boolean {
    return !!content?.action && !!content?.senderWalletAddress && !!content?.tokenSymbol && !!content?.amount;
}

const lendingTemplate = `Respond with a JSON markdown block containing only the extracted values.

Available wallet options:
{{possibleWallets}}

Example response:
\`\`\`json
{
    "action": "supply",
    "senderWalletAddress": "0x1111111111111111111111111111111111111111",
    "tokenSymbol": "USDC",
    "amount": "100",
    "protocol": "aave",
    "chain": "ethereum"
}
\`\`\`

Extract:
- action: "supply" for lend/deposit/collateralize, or "borrow"
- senderWalletAddress
- tokenSymbol
- amount
- protocol if explicitly mentioned
- chain if explicitly mentioned
`;

const ethereumWalletOnlyMessage = 'Ethereum lending currently requires an imported Ethereum wallet.';

const ethereumLendingAction: Action = {
    name: 'MULTIWALLET_ETHEREUM_LENDING',
    similes: [
        'MULTIWALLET_LEND',
        'MULTIWALLET_BORROW',
        'MULTIWALLET_SUPPLY',
        'MULTIWALLET_DEPOSIT_COLLATERAL',
    ],
    description: 'Supply assets to or borrow assets from Aave V3 on Ethereum.',
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        if (!await HasEntityIdFromMessage(runtime, message)) {
            return false;
        }

        const account = await getAccountFromMessage(runtime, message);
        if (!account?.metawallets?.length) {
            return false;
        }

        return account.metawallets.some(mw => !!mw.keypairs?.ethereum);
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback,
    ): Promise<ActionResult | void | undefined> => {
        const account = await getAccountFromMessage(runtime, message);
        if (!account?.metawallets?.length) {
            return {
                success: false,
                text: ethereumWalletOnlyMessage,
                error: 'NO_ETHEREUM_WALLET'
            };
        }

        const ethereumWallets = account.metawallets
            .map(mw => mw.keypairs?.ethereum ? { ...mw.keypairs.ethereum, strategy: mw.strategy } : null)
            .filter(Boolean) as Array<{ publicKey: string; privateKey: string; strategy?: string }>;

        if (!ethereumWallets.length) {
            return {
                success: false,
                text: ethereumWalletOnlyMessage,
                error: 'NO_ETHEREUM_WALLET'
            };
        }

        let contextStr = '';
        for (const wallet of ethereumWallets) {
            contextStr += await getEthereumWalletSummary(wallet.publicKey, runtime);
            contextStr += `  strategy: ${wallet.strategy || 'none'}\n\n`;
        }

        const prompt = composePromptFromState({
            state,
            template: lendingTemplate.replace('{{possibleWallets}}', contextStr),
        });

        const content = await askLlmObject(runtime, { prompt }, [
            'action', 'senderWalletAddress', 'tokenSymbol', 'amount'
        ]) as LendingContent | null;

        if (!content || !isLendingContent(content)) {
            return {
                success: false,
                text: 'Could not determine Ethereum lending request.',
                error: 'PARSE_ERROR'
            };
        }

        const selectedChain = content.chain?.toLowerCase() || 'ethereum';
        if (selectedChain !== 'ethereum') {
            return {
                success: false,
                text: 'Lending action currently supports Ethereum only.',
                error: 'UNSUPPORTED_CHAIN'
            };
        }

        const derivedSources = await getWalletsFromText(runtime, message);
        const matchingSources = derivedSources.filter(source => ethereumWallets.some(wallet => wallet.publicKey === source));
        const fallbackWallet = matchingSources.length === 1
            ? ethereumWallets.find(wallet => wallet.publicKey === matchingSources[0])
            : undefined;

        const sourceWallet = ethereumWallets.find(wallet => wallet.publicKey === content.senderWalletAddress);
        const wallet = sourceWallet || fallbackWallet || ethereumWallets[0];
        if (!wallet) {
            return {
                success: false,
                text: ethereumWalletOnlyMessage,
                error: 'NO_ETHEREUM_WALLET'
            };
        }

        // --- Phase 4 / 4.2: deterministic health-factor floor guard (pre-execution) on borrow ---
        // Routed through the shared RiskService: refuse a borrow that would push the projected Aave
        // health factor below the configured floor (default 1.5). Base currency is USD (8 decimals);
        // the new debt is valued at ~$1/token (accurate for the stablecoin borrows in scope). See
        // docs/PHASE4_RISK.md / docs/PHASE4_2_AGENT_RISK.md.
        if (content.action === 'borrow') {
            try {
                const risk = runtime.getService(RiskService.serviceType) as RiskService | null;
                if (risk) {
                    const a = await risk.assessBorrow({
                        walletAddress: wallet.publicKey,
                        token: content.tokenSymbol,
                        amount: Number(content.amount),
                    });
                    if (risk.getConfig().enforce && a.allowed === false) {
                        const msg = `⛔ Borrow blocked by the risk layer: ${a.note} Supply more collateral or borrow a smaller amount.`;
                        callback?.(takeItPrivate(runtime, message, msg));
                        return { success: false, text: msg, error: 'HEALTH_FACTOR_FLOOR' };
                    }
                }
            } catch (e) {
                logger.warn('Health-factor guard skipped: ' + (e instanceof Error ? e.message : String(e)));
            }
        }

        try {
            const result = await executeEthereumLendingAction({
                privateKey: wallet.privateKey,
                action: content.action,
                token: content.tokenSymbol,
                amount: content.amount,
            }, runtime);

            const verb = result.action === 'supply' ? 'Supplied' : 'Borrowed';
            const text = `${verb} ${result.amount} ${result.token.symbol} on Aave V3 (Ethereum).\nTransaction hash: ${result.hash}`;
            callback?.(takeItPrivate(runtime, message, text));
            return {
                success: true,
                text,
                data: {
                    chain: 'ethereum',
                    protocol: result.protocol,
                    action: result.action,
                    token: result.token.symbol,
                    amount: result.amount,
                    signature: result.hash,
                    wallet: wallet.publicKey,
                }
            };
        } catch (error) {
            logger.error('Ethereum lending action failed:', error instanceof Error ? error.message : String(error));
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            callback?.(takeItPrivate(runtime, message, `Ethereum lending action failed: ${errorMessage}`));
            return {
                success: false,
                text: `Ethereum lending action failed: ${errorMessage}`,
                error: errorMessage
            };
        }
    },
    examples: [
        [
            {
                name: '{{name1}}',
                content: {
                    text: 'Supply 100 USDC to Aave from my wallet 0x1111111111111111111111111111111111111111',
                },
            },
            {
                name: '{{name2}}',
                content: {
                    text: 'Supplying that to Aave on Ethereum now',
                    actions: ['MULTIWALLET_ETHEREUM_LENDING'],
                },
            },
        ],
        [
            {
                name: '{{name1}}',
                content: {
                    text: 'Borrow 50 USDC against my Ethereum collateral',
                },
            },
            {
                name: '{{name2}}',
                content: {
                    text: 'Borrowing that from Aave on Ethereum now',
                    actions: ['MULTIWALLET_ETHEREUM_LENDING'],
                },
            },
        ],
    ] as ActionExample[][],
};

export default ethereumLendingAction;
