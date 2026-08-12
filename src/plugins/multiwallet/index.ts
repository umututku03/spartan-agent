import type { Plugin } from '@elizaos/core';

// Actions
import { walletCreate } from "./actions/act_wallet_create";
import { userMetawalletList } from "./actions/act_wallet_list";
import { walletImportAction } from "./actions/act_wallet_import";
import userMetawalletSwap from "./actions/act_wallet_swap";
import userMetawalletSweep from "./actions/act_wallet_sweep";
import userMetawalletXfer from "./actions/act_wallet_xfer";
import ethereumLendingAction from "./actions/act_wallet_lending";
import riskAssessAction from "./actions/act_risk_assess";

// Providers
import { multiwalletProvider } from "./providers/multiwallet";
import { walletProvider } from "./providers/wallet";
import { tokenProvider } from "./providers/token";
import { riskProvider } from "./providers/risk";

// Services
import { InterfaceWalletService } from './services/srv_wallets';
import { RiskService } from './services/srv_risk';

export const multiwalletPlugin: Plugin = {
  name: 'multitenant wallet',
  description: 'Enduser wallet plugin',
  evaluators: [],
  providers: [multiwalletProvider, walletProvider, tokenProvider, riskProvider],
  actions: [
    walletCreate,
    walletImportAction,
    userMetawalletXfer,
    userMetawalletSwap,
    userMetawalletSweep,
    ethereumLendingAction,
    riskAssessAction, // deterministic risk advisory (read-only)
    userMetawalletList,
  ],
  services: [InterfaceWalletService, RiskService],
};

export default multiwalletPlugin;
