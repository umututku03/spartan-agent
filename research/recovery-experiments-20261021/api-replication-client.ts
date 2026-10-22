import assert from 'node:assert/strict';
import {convertTools} from './claude-agent-client';
import {serialize} from './agent-environment';

// Frozen per-model settings for the Opus 5.5 / GPT-6.1 Sol API replication.
// Prices: official pages checked 21 October 2026 (see agent-api-replication-protocol.md).
export const MAX_ROUNDS = 8;
export const MAX_OUTPUT_TOKENS = 2048;
export const INPUT_OVERHEAD_TOKENS = 512;
export const MODELS = {
  opus: {provider: 'anthropic', model: 'claude-opus-5-5', endpoint: 'https://api.anthropic.com/v1/messages',
    keyVariable: 'ANTHROPIC_API_KEY', baseUrlVariable: 'ANTHROPIC_BASE_URL', officialBaseUrl: 'https://api.anthropic.com',
    inputUSDPerMillion: 4, outputUSDPerMillion: 20, maxVisibleBytes: 16384, effort: 'low',
    resultsFolder: 'agent-opus-api-results'},
  sol: {provider: 'openai', model: 'gpt-6.1-sol', endpoint: 'https://api.openai.com/v1/responses',
    keyVariable: 'OPENAI_API_KEY', baseUrlVariable: 'OPENAI_BASE_URL', officialBaseUrl: 'https://api.openai.com/v1',
    inputUSDPerMillion: 2, outputUSDPerMillion: 10, maxVisibleBytes: 12288, effort: 'low',
    resultsFolder: 'agent-sol-api-results'},
} as const;
export type ModelKey = keyof typeof MODELS;
export type Config = typeof MODELS[ModelKey];

export function anthropicTools(referenceTools: any[]) { return convertTools(referenceTools); }

export function opusPayload(system: string, messages: any[], tools: any[]) {
  // Thinking cannot be disabled on Opus 5.5 and forced tool choice returns 400; low effort is the
  // documented substitute for disabled thinking. No fallbacks, cache_control or sampling overrides.
  return {model: MODELS.opus.model, max_tokens: MAX_OUTPUT_TOKENS, thinking: {type: 'adaptive'},
    output_config: {effort: MODELS.opus.effort}, system, tools,
    tool_choice: {type: 'auto', disable_parallel_tool_use: true}, messages};
}

export function solPayload(instructions: string, input: any[], tools: any[]) {
  // Explicit cache mode without breakpoints: no cache reads or writes, so every input token is uncached.
  return {model: MODELS.sol.model, store: false, service_tier: 'default', reasoning: {effort: MODELS.sol.effort},
    include: ['reasoning.encrypted_content'], prompt_cache_options: {mode: 'explicit'},
    max_output_tokens: MAX_OUTPUT_TOKENS, instructions, input, tools, tool_choice: 'required',
    parallel_tool_calls: false};
}

// Provider-opaque blobs (thinking signatures, encrypted reasoning) are excluded from the visible byte count.
export function visibleBytes(payload: any) {
  return Buffer.byteLength(JSON.stringify(payload, (k, v) =>
    (k === 'signature' || k === 'encrypted_content') && typeof v === 'string' ? `<opaque:${v.length}>` : v), 'utf8');
}

// Conservative input bound: visible bytes + overhead + every earlier output token in the episode
// (replayed thinking/reasoning may be billed as input but is not visible in the payload).
export function inputTokenBound(bytes: number, priorOutputTokens: number) {
  return bytes + INPUT_OVERHEAD_TOKENS + priorOutputTokens;
}

export function reservation(cfg: Config, bytes: number, priorOutputTokens: number) {
  assert(Number.isInteger(bytes) && bytes >= 0 && bytes <= cfg.maxVisibleBytes, 'Visible payload cap exceeded.');
  assert(Number.isInteger(priorOutputTokens) && priorOutputTokens >= 0 &&
    priorOutputTokens <= (MAX_ROUNDS - 1) * MAX_OUTPUT_TOKENS);
  return (inputTokenBound(bytes, priorOutputTokens) * cfg.inputUSDPerMillion +
    MAX_OUTPUT_TOKENS * cfg.outputUSDPerMillion) / 1_000_000;
}

export function settleUsage(cfg: Config, usage: any) {
  assert(usage && Number.isInteger(usage.input_tokens) && usage.input_tokens >= 0, 'Missing input usage.');
  assert(Number.isInteger(usage.output_tokens) && usage.output_tokens >= 0, 'Missing output usage.');
  // No caching is requested from either provider; fail closed on any cache billing category.
  if (cfg.provider === 'anthropic') {
    assert((usage.cache_creation_input_tokens ?? 0) === 0 && (usage.cache_read_input_tokens ?? 0) === 0,
      'Unexpected cache billing category.');
  } else {
    assert((usage.input_tokens_details?.cached_tokens ?? 0) === 0 &&
      (usage.input_tokens_details?.cache_write_tokens ?? 0) === 0, 'Unexpected cache billing category.');
  }
  return (usage.input_tokens * cfg.inputUSDPerMillion + usage.output_tokens * cfg.outputUSDPerMillion) / 1_000_000;
}

function validateArgs(name: string, args: any, tools: any[], provider: string) {
  const tool = tools.find(t => t.name === name);
  if (!tool) return 'unknown_tool';
  const schema = provider === 'anthropic' ? tool.input_schema : tool.parameters;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'invalid_arguments';
  if (JSON.stringify(Object.keys(args).sort()) !== JSON.stringify(Object.keys(schema.properties).sort())) return 'invalid_arguments';
  for (const [key, property] of Object.entries(schema.properties) as [string, any][]) {
    if (typeof args[key] !== property.type) return 'invalid_arguments';
    if (property.enum && !property.enum.includes(args[key])) return 'invalid_arguments';
  }
  return null;
}

// Invalid, refused, truncated or non-tool responses never reach the executor.
export function parseResponse(provider: string, response: any, tools: any[]):
  {ok: true, callId: string, action: {tool: string, args: any}} | {ok: false, reason: string} {
  if (provider === 'anthropic') {
    if (response?.stop_reason === 'refusal') return {ok: false, reason: 'refusal'};
    if (response?.stop_reason === 'max_tokens') return {ok: false, reason: 'truncated_max_tokens'};
    const calls = (response?.content ?? []).filter((x: any) => x.type === 'tool_use');
    if (calls.length === 0) return {ok: false, reason: `no_tool_call:${response?.stop_reason}`};
    if (calls.length > 1) return {ok: false, reason: 'multiple_tool_calls'};
    if (response.stop_reason !== 'tool_use') return {ok: false, reason: `unexpected_stop:${response.stop_reason}`};
    const c = calls[0];
    if (typeof c.id !== 'string' || !c.id) return {ok: false, reason: 'missing_call_id'};
    const bad = validateArgs(c.name, c.input, tools, provider);
    return bad ? {ok: false, reason: bad} : {ok: true, callId: c.id, action: {tool: c.name, args: c.input}};
  }
  if (response?.status !== 'completed') return {ok: false, reason: `incomplete:${response?.incomplete_details?.reason ?? response?.status}`};
  const calls = (response.output ?? []).filter((x: any) => x.type === 'function_call');
  if (calls.length === 0) return {ok: false, reason: 'no_tool_call'};
  if (calls.length > 1) return {ok: false, reason: 'multiple_tool_calls'};
  const c = calls[0];
  if (typeof c.call_id !== 'string' || !c.call_id) return {ok: false, reason: 'missing_call_id'};
  let args: any;
  try { args = JSON.parse(c.arguments); } catch { return {ok: false, reason: 'invalid_json_arguments'}; }
  const bad = validateArgs(c.name, args, tools, provider);
  return bad ? {ok: false, reason: bad} : {ok: true, callId: c.call_id, action: {tool: c.name, args}};
}

// Blinding: harness-authored content may contain only the task, schemas, visible observations,
// tool results and condition information. Model-authored replay is excluded from the label scan.
export const FORBIDDEN_TERMS = ['normal', 'receipt_hidden', 'price_change', 'scenario', 'hiddenreceipt',
  'hidden_receipt', 'privateevents', 'scheduled_market_change', 'native_receipt', 'cash_swap_receipt',
  'initiallyfeasible', 'expectedfeasibility', 'feasiblebyenumeration', 'goaldestroying', 'unsafeproposals',
  'guardblocks', 'actualviolations', 'executedreserveviolations', 'deterministic', 'validresolution',
  'correctinfeasible', 'goalreached', 'controller', 'evaluator', 'ground_truth', 'repeat'];
export const ALLOWED_KEYS = new Set(['original_user_task', 'initial_observation', 'cash_balance', 'dai_balance',
  'pool_cash', 'pool_dai', 'pool_input_fee', 'native_transaction', 'hash', 'status', 'rounds_remaining',
  'explicit_task_record', 'original_requirements', 'ethToSell', 'minimumDai', 'minimumCash', 'confirmed_eth_sold',
  'unresolved_sale', 'current_cash', 'current_dai', 'cash_above_required_reserve', 'remaining_dai', 'action', 'tool',
  'args', 'result', 'observation', 'reason', 'message', 'cash', 'dai', 'cash_spent', 'eth', 'minimum_dai']);

export function harnessContent(provider: string, payload: any) {
  const fixed: string[] = [];   // system/instructions and tool schemas, frozen from the reference manifest
  const dynamic: string[] = []; // task, observations, tool results and continuations, all JSON
  if (provider === 'anthropic') {
    fixed.push(payload.system, JSON.stringify(payload.tools));
    for (const m of payload.messages) if (m.role === 'user') for (const b of m.content) {
      if (b.type === 'text') dynamic.push(b.text);
      else if (b.type === 'tool_result') dynamic.push(typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
      else dynamic.push(JSON.stringify(b));
    }
  } else {
    fixed.push(payload.instructions, JSON.stringify(payload.tools));
    for (const item of payload.input) {
      if (item.role === 'user') dynamic.push(typeof item.content === 'string' ? item.content : JSON.stringify(item.content));
      else if (item.type === 'function_call_output') dynamic.push(item.output);
    }
  }
  return {fixed, dynamic};
}

export function blindingViolations(provider: string, payload: any, reference: {instructions: string, tools: any[]},
  secrets: string[] = []) {
  const violations: string[] = [];
  const {fixed, dynamic} = harnessContent(provider, payload);
  const expectedTools = provider === 'anthropic' ? anthropicTools(reference.tools) : reference.tools;
  if (fixed[0] !== reference.instructions) violations.push('instructions differ from reference');
  if (fixed[1] !== JSON.stringify(expectedTools)) violations.push('tools differ from reference');
  const walk = (x: any) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) {
      if (!ALLOWED_KEYS.has(k)) violations.push(`unexpected key ${k}`);
      walk(v);
    }
  };
  for (const text of dynamic) {
    const lower = text.toLowerCase();
    for (const term of FORBIDDEN_TERMS) if (lower.includes(term)) violations.push(`forbidden term ${term}`);
    try { walk(JSON.parse(text)); } catch { violations.push('non-JSON harness content'); }
  }
  const whole = serialize(payload);
  for (const s of secrets) if (s && s.length >= 8 && whole.includes(s)) violations.push('credential present');
  if (/x-api-key|authorization|bearer /i.test(whole)) violations.push('credential header text present');
  return [...new Set(violations)];
}

// Append-only check for Anthropic histories: every earlier message must be byte-identical.
export function isAppendOnly(previous: any[] | null, next: any[]) {
  if (!previous) return true;
  return previous.length <= next.length && previous.every((m, i) => JSON.stringify(m) === JSON.stringify(next[i]));
}
