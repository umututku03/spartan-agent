// Harness-side additions to the stock Spartan runtime:
//   embeddingStubPlugin: deterministic local embeddings for every cohort (no provider embeddings), so
//                        memory retrieval is identical across models and needs no extra API.
//   taskRecordPlugin:    the task_record condition. One non-dynamic provider with the original
//                        requirements and current wallet balances. It reads only the agent's own wallet
//                        balances, never the transaction journal or receipt status.
//   seedVerifiedAccount: a verified user plus an imported Ethereum wallet, written the way
//                        VERIFY_REGISTRATION_CODE and WALLET_IMPORT write them, so episodes skip chat registration.
import {ModelType, VECTOR_DIMS, createUniqueUuid, type IAgentRuntime, type Plugin, type UUID} from '@elizaos/core';
import {createHash} from 'node:crypto';
import {createPublicClient, http, formatUnits, parseUnits, type Address} from 'viem';
import {mainnet} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';

const DIM = 1536;
if (!Object.values(VECTOR_DIMS).includes(DIM)) throw new Error('Unsupported embedding dimension');

export const embeddingStubPlugin: Plugin = {
  name: 'harness-embedding-stub',
  description: 'Deterministic hash embeddings for controlled experiments',
  priority: 100,
  models: {
    [ModelType.TEXT_EMBEDDING]: async (_runtime: IAgentRuntime, params: any) => {
      const text = params === null ? '' : typeof params === 'string' ? params : String(params?.text ?? '');
      const v = new Array(DIM).fill(0);
      for (let i = 0; i < DIM; i += 16) {
        const h = createHash('sha256').update(`${i}:${text}`).digest();
        for (let j = 0; j < 16; j++) v[i + j] = (h[j] / 255) - 0.5;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map(x => x / norm);
    },
  },
};

const ERC20 = [{type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{name: 'a', type: 'address'}], outputs: [{type: 'uint256'}]}] as const;
export const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

export function taskRecordPlugin(opts: {rpcUrl: string; wallet: Address; goalDai: string; reserveUsdc: string}): Plugin {
  const pub = createPublicClient({chain: mainnet, transport: http(opts.rpcUrl, {retryCount: 0})});
  return {
    name: 'harness-task-record',
    description: 'Task record condition',
    providers: [{
      name: 'TASK_RECORD',
      description: 'Original task requirements and the remaining amounts, derived from current wallet balances',
      dynamic: false,
      get: async () => {
        const [usdc, dai] = await Promise.all([
          pub.readContract({address: USDC, abi: ERC20, functionName: 'balanceOf', args: [opts.wallet]}) as Promise<bigint>,
          pub.readContract({address: DAI, abi: ERC20, functionName: 'balanceOf', args: [opts.wallet]}) as Promise<bigint>]);
        const reserve = parseUnits(opts.reserveUsdc, 6), goal = parseUnits(opts.goalDai, 18);
        const record = {
          original_requirements: {sell_exactly_eth: '0.1', minimum_dai: opts.goalDai, minimum_usdc_kept: opts.reserveUsdc, wallet: opts.wallet},
          eth_sale_reflected_in_balances: usdc > 0n || dai > 0n,
          current_usdc: formatUnits(usdc, 6), current_dai: formatUnits(dai, 18),
          usdc_above_required_reserve: formatUnits(usdc > reserve ? usdc - reserve : 0n, 6),
          remaining_dai: formatUnits(dai < goal ? goal - dai : 0n, 18),
        };
        return {text: `# Task record (deterministic, from wallet balances)\n${JSON.stringify(record)}`, values: {}, data: {taskRecord: record}};
      },
    }],
  };
}

export async function seedVerifiedAccount(runtime: IAgentRuntime, p: {userSourceId: string; email: string;
  privateKey: `0x${string}`; roomId: UUID; worldId: UUID; participantId: UUID}) {
  const userEntityId = createUniqueUuid(runtime, p.userSourceId) as UUID;   // = getEntityIdFromMessage
  const accountEntityId = createUniqueUuid(runtime, p.email) as UUID;      // = getAccountFromMessage
  const publicKey = privateKeyToAccount(p.privateKey).address;
  for (const id of [userEntityId, accountEntityId]) {
    if (!await runtime.getEntityById(id)) await runtime.createEntity({id, names: [], metadata: {}, agentId: runtime.agentId});
  }
  const common = {agentId: runtime.agentId, worldId: p.worldId, roomId: p.roomId, sourceEntityId: p.participantId, createdAt: Date.now()};
  await runtime.createComponent({...common, id: createUniqueUuid(runtime, 'component'), entityId: userEntityId,
    type: 'component_user_v0', data: {address: p.email, code: 'SEEDED', verified: true}} as any);
  await runtime.createComponent({...common, id: createUniqueUuid(runtime, `account-${p.email}`), entityId: accountEntityId,
    type: 'component_account_v0', data: {metawallets: [{strategy: 'No trading strategy',
      keypairs: {ethereum: {privateKey: p.privateKey, publicKey, type: 'imported', createdAt: Date.now()}}}]}} as any);
  return {userEntityId, accountEntityId, publicKey};
}
