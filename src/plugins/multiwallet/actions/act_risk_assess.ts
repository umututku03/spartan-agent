import {
  type Action,
  type ActionExample,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from '@elizaos/core';
import {
  HasEntityIdFromMessage,
  getAccountFromMessage,
  takeItPrivate,
} from '../../autonomous-trader/utils';
import { RiskService } from '../services/srv_risk';

/**
 * RISK_ASSESS (Phase 4.2): a read-only, deterministic risk advisory. Answers "how much should/can I
 * swap or borrow?" using the RiskService - NO trade is executed. Complements the RISK_GOVERNANCE
 * provider (always-on context) and the swap/lending guards (hard backstop).
 */
const riskAssessAction: Action = {
  name: 'RISK_ASSESS',
  similes: [
    'POSITION_SIZE',
    'HOW_MUCH_CAN_I_TRADE',
    'HOW_MUCH_CAN_I_BORROW',
    'HOW_MUCH_SHOULD_I_SWAP',
    'RISK_CHECK',
  ],
  description:
    'Report the deterministic risk budget for the user\'s Ethereum wallet - the volatility-targeted max swap size and the safe Aave borrow headroom before the health-factor floor. Read-only; does not execute a trade.',
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    if (!(await HasEntityIdFromMessage(runtime, message))) return false;
    const account = await getAccountFromMessage(runtime, message);
    return account?.metawallets?.some((mw: any) => !!mw.keypairs?.ethereum) ?? false;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult | void> => {
    const account = await getAccountFromMessage(runtime, message);
    if (!account) {
      callback?.(takeItPrivate(runtime, message, 'You need a registered, verified account first.'));
      return { success: false, text: 'Not registered', error: 'NO_ACCOUNT' };
    }

    let ethAddress: string | undefined;
    for (const mw of account.metawallets || []) {
      if (mw?.keypairs?.ethereum?.publicKey) {
        ethAddress = mw.keypairs.ethereum.publicKey;
        break;
      }
    }
    if (!ethAddress) {
      callback?.(takeItPrivate(runtime, message, 'Import an Ethereum wallet first, then ask again.'));
      return { success: false, text: 'No Ethereum wallet', error: 'NO_ETHEREUM_WALLET' };
    }

    const risk = runtime.getService(RiskService.serviceType) as RiskService | null;
    if (!risk) {
      callback?.(takeItPrivate(runtime, message, 'Risk service is not available right now.'));
      return { success: false, text: 'No risk service', error: 'NO_RISK_SERVICE' };
    }

    const cfg = risk.getConfig();
    const [swap, borrow] = await Promise.all([
      risk.assessSwap({ walletAddress: ethAddress, symbol: 'ETH' }).catch(() => null),
      risk.assessBorrow({ walletAddress: ethAddress }).catch(() => null),
    ]);

    let text = `Risk assessment for ${ethAddress}\n`;
    text += `Policy: target vol ${(cfg.targetVol * 100).toFixed(0)}%/yr * wallet cap ${(cfg.maxWalletPct * 100).toFixed(0)}% * Aave HF floor ${cfg.hfFloor} * enforcement ${cfg.enforce ? 'ON' : 'advisory'}\n`;
    if (swap) text += `- Max ETH swap now: ~${swap.maxSize.toFixed(6)} ETH - ${swap.note}\n`;
    if (borrow) text += `- Aave: ${borrow.note}\n`;
    if (!swap && !borrow) text += 'Could not read live wallet/market state right now - try again shortly.\n';

    callback?.(takeItPrivate(runtime, message, text));
    return {
      success: true,
      text,
      data: {
        wallet: ethAddress,
        config: cfg,
        maxSwapEth: swap?.maxSize ?? null,
        maxSafeBorrowUsd: borrow?.maxSafeBorrowUsd ?? null,
      },
    };
  },
  examples: [
    [
      { name: '{{name1}}', content: { text: 'how much ETH can I safely swap right now?' } },
      {
        name: '{{name2}}',
        content: { text: 'Let me check your risk budget.', actions: ['RISK_ASSESS'] },
      },
    ],
    [
      { name: '{{name1}}', content: { text: 'how much can I borrow on Aave without getting liquidated?' } },
      {
        name: '{{name2}}',
        content: { text: 'Checking your health-factor headroom.', actions: ['RISK_ASSESS'] },
      },
    ],
  ] as ActionExample[][],
};

export default riskAssessAction;
