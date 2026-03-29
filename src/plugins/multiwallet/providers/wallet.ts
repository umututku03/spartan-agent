import type { IAgentRuntime, Memory, Provider, State } from '@elizaos/core';
import { getAccountFromMessage } from '../../autonomous-trader/utils'
import { parseDateFilterFromMessage, applyDateFilterToAccount, formatDateFilterText } from '../../autonomous-trader/providers/date_filter'
import { getEthereumWalletSummary } from '../utils/ethereum';

/**
 * Provider for specific wallet details and positions
 * Provides detailed information about a user's specific wallet
 */
export const walletProvider: Provider = {
    name: 'WALLET_DETAILS',
    description: 'Detailed information about a specific wallet including positions, balances, and performance',
    dynamic: true,
    get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
        console.log('WALLET_DETAILS')

        let walletStr = ''

        // DM or public?
        const isDM = message.content.channelType?.toUpperCase() === 'DM'
        if (isDM) {
            const account = await getAccountFromMessage(runtime, message)
            if (!account) {
                return {
                    data: {},
                    values: {},
                    text: 'No account found for this user.',
                }
            }

            // Apply date filter if specified in message
            const messageText = message.content?.text?.toLowerCase() || '';
            const dateFilter = parseDateFilterFromMessage(messageText);
            const filteredAccount = dateFilter ? applyDateFilterToAccount(account, dateFilter) : account;

            const solanaService = runtime.getService('chain_solana') as any;

            // Add date filter info if applied
            if (dateFilter) {
                walletStr += `📅 Date Filter: ${formatDateFilterText(dateFilter)}\n\n`
            }

            // Process each metawallet
            for (const mw of filteredAccount.metawallets) {
                for (const [chain, kp] of Object.entries(mw.keypairs || {})) {
                    const pubKey = kp.publicKey

                    walletStr += `=== WALLET DETAILS ===\n`
                    walletStr += `Chain: ${chain}\n`
                    walletStr += `Public Key: ${pubKey}\n`
                    walletStr += `Strategy: ${mw.strategy}\n`

                    if (chain === 'solana' && solanaService) {
                        const balanceInfo = await solanaService.walletAddressToLLMString(pubKey)
                        walletStr += `Balance Information:\n${balanceInfo}\n`

                        const totalPositions = kp.positions?.length || 0
                        const openPositions = kp.positions?.filter(p => !p.close).length || 0
                        const closedPositions = kp.positions?.filter(p => p.close).length || 0

                        walletStr += `Position Summary:\n`
                        walletStr += `  Total Positions: ${totalPositions}\n`
                        walletStr += `  Open Positions: ${openPositions}\n`
                        walletStr += `  Closed Positions: ${closedPositions}\n`
                    } else if (chain === 'ethereum') {
                        const balanceInfo = await getEthereumWalletSummary(pubKey, runtime)
                        walletStr += `Balance Information:\n${balanceInfo}\n`
                    }

                    walletStr += `\n`
                }
            }
        } else {
            walletStr = 'Wallet details are only available in private messages.'
        }

        console.log('walletStr', walletStr)

        const data = {
            walletDetails: walletStr
        };

        const values = {};

        const text = walletStr + '\n';

        return {
            data,
            values,
            text,
        };
    },
};
