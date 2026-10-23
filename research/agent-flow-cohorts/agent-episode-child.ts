// One agent episode in its own process (fresh ElizaOS/plugin-sql singletons): builds the stock Spartan
// runtime, seeds the verified account, drives the turns and writes the transcript. The parent owns the
// fork, the fault proxy, the egress proxy and all outcome scoring.
// Usage: bun agent-episode-child.ts <spec.json> <out.json>
import {AgentRuntime, ChannelType, createMessageMemory, stringToUuid, type UUID, type Content} from '@elizaos/core';
import bootstrapPlugin from '@elizaos/plugin-bootstrap';
import openaiPlugin from '@elizaos/plugin-openai';
import anthropicPlugin from '@elizaos/plugin-anthropic';
import sqlPlugin, {DatabaseMigrationService, createDatabaseAdapter} from '@elizaos/plugin-sql';
import {readFileSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spartan, character as spartanCharacter} from '../../src/index';
import {embeddingStubPlugin, taskRecordPlugin, seedVerifiedAccount} from './agent-flow-plugins';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const outPath = process.argv[3];

// Network guard: this process may only reach 127.0.0.1 (proxies). Live market data, real-mainnet RPC
// fallbacks and any direct provider call are impossible from the agent process.
const realFetch = globalThis.fetch;
const blocked: Record<string, number> = {};
globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    blocked[url.hostname] = (blocked[url.hostname] ?? 0) + 1;
    throw new TypeError(`network unavailable: ${url.hostname}`);   // neutral wording: may surface in model-visible notes
  }
  return realFetch(input, init);
}) as any;
for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'MAINNET_FORK_RPC_URL']) delete process.env[k];

async function control(path: string, body?: any) {
  const r = await realFetch(spec.llmUrl + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body ?? {})});
  return r.json();
}
async function nonce() {
  const r: any = await (await realFetch(spec.forkProxyUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [spec.wallet, 'latest']})})).json();
  return Number(r.result);
}

const {provider, model} = spec.model;
const character = {...structuredClone(spartanCharacter), plugins: [], id: stringToUuid(`spartan-${spec.id}`)} as any;
rmSync(spec.dbDir, {recursive: true, force: true}); mkdirSync(spec.dbDir, {recursive: true});
const adapter = createDatabaseAdapter({dataDir: spec.dbDir}, character.id);
await adapter.init();
const migrator = new DatabaseMigrationService();
// @ts-ignore available on the adapter base class
await migrator.initializeWithDatabase(adapter.getDatabase());
migrator.discoverAndRegisterPluginSchemas([sqlPlugin]);
await migrator.runAllPluginMigrations();
const plugins: any[] = [sqlPlugin, bootstrapPlugin, provider === 'openai' ? openaiPlugin : anthropicPlugin, embeddingStubPlugin, ...spartan.plugins];
if (spec.condition === 'task_record') plugins.push(taskRecordPlugin({rpcUrl: spec.forkProxyUrl, wallet: spec.wallet, goalDai: spec.goalDai, reserveUsdc: spec.reserveUsdc}));
const runtime = new AgentRuntime({character, plugins, settings: {
  OPENAI_API_KEY: 'sk-harness-placeholder', OPENAI_BASE_URL: `${spec.llmUrl}/openai/v1`,
  ANTHROPIC_API_KEY: 'sk-ant-harness-placeholder', ANTHROPIC_BASE_URL: `${spec.llmUrl}/anthropic/v1`,
  ...(provider === 'openai' ? {OPENAI_LARGE_MODEL: model, OPENAI_SMALL_MODEL: model} : {ANTHROPIC_LARGE_MODEL: model, ANTHROPIC_SMALL_MODEL: model}),
  ETHEREUM_RPC_URL: spec.forkProxyUrl, EVM_PROVIDER_URL: spec.forkProxyUrl,
} as any});
runtime.registerDatabaseAdapter(adapter);
await control('/control/turn', {episodeId: `${spec.id}#init`, turn: -1, forbidden: spec.forbidden});   // plugin init may probe models
await runtime.initialize();
await spartan.init!(runtime);
await control('/control/idle');

// v2: every model-visible identifier is a neutral random value supplied by the parent (spec.identity).
const idn = spec.identity;
const roomId = stringToUuid(idn.room) as UUID, worldId = stringToUuid(idn.world) as UUID;
const participantId = stringToUuid(idn.participant) as UUID, userSourceId = idn.userSourceId;
await runtime.ensureConnection({entityId: participantId, roomId, worldId, name: 'User', source: 'chat', channelId: idn.channel, serverId: 'server', type: ChannelType.DM});
const seeded = await seedVerifiedAccount(runtime, {userSourceId, email: idn.email, privateKey: spec.privateKey, roomId, worldId, participantId});

const turns: any[] = [];
async function send(text: string, turn: number) {
  await control('/control/turn', {episodeId: spec.id, turn, mockPlan: spec.mockPlan ?? undefined, resetMock: turn === 0, forbidden: spec.forbidden});
  const callbacks: Content[] = [];
  const msg: any = createMessageMemory({id: randomUUID() as UUID, entityId: participantId, roomId, content: {text, source: 'chat', channelType: ChannelType.DM} as any});
  msg.metadata = {...msg.metadata, authorId: userSourceId};
  const nonceBefore = await nonce(), started = Date.now();
  let error: string | null = null;
  try {
    await runtime.messageService!.handleMessage(runtime, msg, async (c: Content) => { callbacks.push(c); return []; },
      {useMultiStep: spec.driver === 'multi_step', maxMultiStepIterations: spec.multiStepIterations, timeoutDuration: 20 * 60 * 1000});
  } catch (e) { error = (e as Error).message; }
  await control('/control/idle');
  const record = {turn, text, startedAt: started, ms: Date.now() - started, error, newTransactions: (await nonce()) - nonceBefore,
    callbacks: callbacks.map(c => ({text: c.text, actions: c.actions, thought: (c as any).thought}))};
  turns.push(record);
  return record;
}

let termination = 'max_turns', declared: string | null = null;
try {
  let t = await send(spec.texts.task, 0);
  if (spec.driver === 'single_shot') {
    for (let turn = 1; turn < spec.maxTurns; turn++) {
      const acted = t.newTransactions > 0 || t.callbacks.some(c => (c.actions ?? []).some((a: string) => !['REPLY', 'IGNORE', 'NONE'].includes(a)));
      if (!acted) { termination = 'agent_idle'; break; }
      t = await send(spec.texts.followUp, turn);
    }
  } else termination = 'multi_step_finished';
  const closing = await send(spec.texts.closing, turns.length);
  const words = closing.callbacks.map(c => String(c.text ?? '')).join(' ').toUpperCase().match(/\b(COMPLETED|INFEASIBLE|IN_PROGRESS)\b/g) ?? [];
  declared = words.length ? words[words.length - 1] : 'UNPARSEABLE';
} catch (e) { termination = `harness_error: ${(e as Error).message}`; }
const memories = await runtime.getMemories({roomId, tableName: 'messages', count: 500}).catch(() => []);
writeFileSync(outPath, JSON.stringify({termination, declared, turns, seeded: {...seeded, privateKey: undefined}, blockedHosts: blocked,
  roomMemories: memories.map((m: any) => ({id: m.id, entityId: m.entityId, createdAt: m.createdAt, content: m.content}))},
  (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
await runtime.stop().catch(() => {});
rmSync(spec.dbDir, {recursive: true, force: true});
process.exit(0);
