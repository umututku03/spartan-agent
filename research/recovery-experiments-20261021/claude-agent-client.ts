import assert from 'node:assert/strict';

export const CLAUDE_MODEL = 'claude-haiku-5-5';
export const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const INPUT_USD_PER_MILLION = 0.10;
export const OUTPUT_USD_PER_MILLION = 0.50;
export const MAX_INPUT_BYTES = 10240;
export const INPUT_OVERHEAD_TOKENS = 512;
export const MAX_OUTPUT_TOKENS = 256;
export type Message = {role: 'user' | 'assistant'; content: any[]};

export function convertTools(openaiTools: any[]) {
  return openaiTools.map(({name, description, parameters}: any) => ({
    name, description, strict: true, input_schema: parameters,
  }));
}

export function withContinuation(history: Message[], continuation: any): Message[] {
  const messages = structuredClone(history);
  const last = messages.at(-1);
  assert(last?.role === 'user', 'Continuation must follow the initial task or tool result.');
  // Anthropic requires tool_result first, immediately after its assistant tool_use.
  last.content.push({type: 'text', text: JSON.stringify(continuation)});
  return messages;
}

export function buildPayload(system: string, messages: Message[], tools: any[]) {
  return {
    model: CLAUDE_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    thinking: {type: 'disabled'},
    output_config: {effort: 'medium'},
    system,
    tools,
    tool_choice: {type: 'any', disable_parallel_tool_use: true},
    messages,
  };
}

export function parseAction(response: any, tools: any[]) {
  assert.equal(response.stop_reason, 'tool_use', 'Do not execute a refusal, truncated or non-tool response.');
  const calls = (response.content ?? []).filter((x: any) => x.type === 'tool_use');
  assert.equal(calls.length, 1, 'Exactly one native tool call is required.');
  const call = calls[0];
  assert(typeof call.id === 'string' && call.id.length > 0);
  const schema = tools.find(t => t.name === call.name)?.input_schema;
  assert(schema, 'Unknown tool must not reach the executor.');
  const args = call.input;
  assert(args !== null && typeof args === 'object' && !Array.isArray(args));
  assert.deepEqual(Object.keys(args).sort(), Object.keys(schema.properties).sort());
  for (const [key, property] of Object.entries(schema.properties) as [string, any][]) {
    assert.equal(typeof args[key], property.type);
    if (property.enum) assert(property.enum.includes(args[key]));
  }
  return {callId: call.id, action: {tool: call.name, args}};
}

export function usageCost(usage: any) {
  assert(usage && Number.isInteger(usage.input_tokens) && usage.input_tokens >= 0);
  assert(Number.isInteger(usage.output_tokens) && usage.output_tokens >= 0);
  // No cache_control is requested. Fail closed on an unexpected billing category.
  assert((usage.cache_creation_input_tokens ?? 0) === 0);
  assert((usage.cache_read_input_tokens ?? 0) === 0);
  return (usage.input_tokens * INPUT_USD_PER_MILLION +
    usage.output_tokens * OUTPUT_USD_PER_MILLION) / 1_000_000;
}

export function reservation(inputBytes: number) {
  assert(Number.isInteger(inputBytes) && inputBytes >= 0 && inputBytes <= MAX_INPUT_BYTES);
  return ((inputBytes + INPUT_OVERHEAD_TOKENS) * INPUT_USD_PER_MILLION +
    MAX_OUTPUT_TOKENS * OUTPUT_USD_PER_MILLION) / 1_000_000;
}
