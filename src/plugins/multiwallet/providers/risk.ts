import type { IAgentRuntime, Memory, Provider, State } from '@elizaos/core';
import { getAccountFromMessage } from '../../autonomous-trader/utils';
import { RiskService } from '../services/srv_risk';

/**
 * RISK_GOVERNANCE provider (Phase 4.2). Injects the deterministic risk state - current regime
 * (realized vol), the vol-targeted max position, and Aave health-factor headroom - into the agent's
 * context on every DM turn. This is what makes the risk layer AGENT-INTEGRATED: Spartan's replies are
 * risk-aware and it self-limits its own proposals, regardless of which action the LLM ends up picking.
 * The deterministic guards in the swap/lending handlers remain the hard backstop.
 */
export const riskProvider: Provider = {
  name: 'RISK_GOVERNANCE',
  description:
    "The user's deterministic risk budget: current volatility regime, the max position size the risk layer will allow, and Aave borrow headroom before the health-factor floor.",
  // NOT dynamic: this is included in EVERY turn's context so the agent is always risk-aware and
  // self-limits its own proposals (the whole point of the agent-integrated layer). Cost is bounded by
  // the RiskService's 5-min regime cache; it returns empty unless the author's verified ETH wallet resolves.
  dynamic: false,
  get: async (runtime: IAgentRuntime, message: Memory, _state: State) => {
    const empty = { data: {}, values: {}, text: '' };
    try {
      // Not DM-gated: the account is resolved from the message author's own stable id, so this only
      // ever surfaces THIS user's own risk budget in their own turn - safe in the 1:1 web/Sessions
      // channel (reported as GROUP) as well as real DMs. Returns empty unless a verified account with
      // an Ethereum wallet resolves.
      const account = await getAccountFromMessage(runtime, message);
      if (!account || !Array.isArray(account.metawallets)) return empty;

      // First imported Ethereum wallet (the risk layer currently governs the Ethereum paths).
      let ethAddress: string | undefined;
      for (const mw of account.metawallets) {
        const eth = mw?.keypairs?.ethereum;
        if (eth?.publicKey) {
          ethAddress = eth.publicKey;
          break;
        }
      }
      if (!ethAddress) return empty;

      const risk = runtime.getService(RiskService.serviceType) as RiskService | null;
      if (!risk) return empty;

      const cfg = risk.getConfig();
      const [swap, borrow] = await Promise.all([
        risk.assessSwap({ walletAddress: ethAddress, symbol: 'ETH' }).catch(() => null),
        risk.assessBorrow({ walletAddress: ethAddress }).catch(() => null),
      ]);

      let text = `# Risk governance (deterministic) for wallet ${ethAddress}\n`;
      text += `Policy: target vol ${(cfg.targetVol * 100).toFixed(0)}%/yr, wallet cap ${(cfg.maxWalletPct * 100).toFixed(0)}%, Aave HF floor ${cfg.hfFloor}, enforcement ${cfg.enforce ? 'ON' : 'advisory'}.\n`;
      if (swap) {
        text += `Swap sizing: ${swap.note}\n`;
        text += `-> Do NOT propose an ETH swap larger than ~${swap.maxSize.toFixed(6)} ETH right now.\n`;
      }
      if (borrow) {
        text += `Borrow headroom: ${borrow.note}\n`;
        text += `-> Do NOT propose borrowing more than ~$${borrow.maxSafeBorrowUsd.toFixed(2)}; borrows below the HF floor are refused deterministically.\n`;
      }
      return { data: { ethAddress }, values: {}, text };
    } catch {
      return empty;
    }
  },
};

export default riskProvider;
