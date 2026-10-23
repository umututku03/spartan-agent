import { describe, it, expect } from 'vitest';
import { composePromptFromState, type State } from '@elizaos/core';
import { lendingTemplate } from '../act_wallet_lending';

describe('lendingTemplate', () => {
  it('puts the user request into the extraction prompt', () => {
    const request = 'Supply 0.5 WETH to Aave from my wallet 0x1111111111111111111111111111111111111111';
    const state = { values: { recentMessages: `User: ${request}` }, data: {}, text: '' } as unknown as State;
    const prompt = composePromptFromState({
      state,
      template: lendingTemplate.replace('{{possibleWallets}}', 'Wallet Address: 0x1111111111111111111111111111111111111111'),
    });
    expect(prompt).toContain(request);
    expect(prompt).toContain('Wallet Address: 0x1111111111111111111111111111111111111111');
  });
});
