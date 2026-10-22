import {test, expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {MODELS, MAX_OUTPUT_TOKENS, anthropicTools, opusPayload, solPayload, visibleBytes, reservation, settleUsage,
  parseResponse, blindingViolations, isAppendOnly} from './api-replication-client';
const reference = JSON.parse(readFileSync(join(import.meta.dir, 'agent-budget-sensitivity-results/manifest-before.json'), 'utf8'));
const {instructions} = reference;
const aTools = anthropicTools(reference.tools), oTools = reference.tools;
const opening = JSON.stringify({original_user_task: reference.userTask, initial_observation: {cash_balance: '0', dai_balance: '0',
  pool_cash: '10000', pool_dai: '10000', pool_input_fee: '0.003', native_transaction: null}});
const opus = (text = opening) => opusPayload(instructions, [{role: 'user', content: [{type: 'text', text}, {type: 'text', text: '{"rounds_remaining":8}'}]}], aTools);
const sol = (text = opening) => solPayload(instructions, [{role: 'user', content: text}, {role: 'user', content: '{"rounds_remaining":8}'}], oTools);

test('Opus uses adaptive thinking at low effort, unforced single tool choice, no caching, fallback or sampling', () => {
  const p: any = opus();
  expect(p.model).toBe('claude-opus-5-5');
  expect(p.thinking).toEqual({type: 'adaptive'});
  expect(p.output_config).toEqual({effort: 'low'});
  expect(p.tool_choice).toEqual({type: 'auto', disable_parallel_tool_use: true});
  expect(p.max_tokens).toBe(MAX_OUTPUT_TOKENS);
  for (const k of ['temperature', 'top_p', 'fallbacks', 'betas', 'cache_control']) expect(JSON.stringify(p)).not.toContain(k);
  expect(p.tools.every((t: any) => t.strict === true)).toBe(true);
});
test('Sol uses low reasoning, required single call, stateless encrypted reasoning and no cache breakpoints', () => {
  const p: any = sol();
  expect(p.model).toBe('gpt-6.1-sol');
  expect(p.reasoning).toEqual({effort: 'low'});
  expect(p.store).toBe(false);
  expect(p.tool_choice).toBe('required');
  expect(p.parallel_tool_calls).toBe(false);
  expect(p.prompt_cache_options).toEqual({mode: 'explicit'});
  expect(p.max_output_tokens).toBe(MAX_OUTPUT_TOKENS);
  expect(p.tools).toEqual(oTools);
});
test('blinding accepts clean payloads and rejects labels, private keys, altered prompts and credentials', () => {
  expect(blindingViolations('anthropic', opus(), reference)).toEqual([]);
  expect(blindingViolations('openai', sol(), reference)).toEqual([]);
  expect(blindingViolations('anthropic', opus(JSON.stringify({scenario: 'price_change_infeasible'})), reference).length).toBeGreaterThan(0);
  expect(blindingViolations('openai', sol(JSON.stringify({cash: '1', privateEvents: []})), reference)).toContain('unexpected key privateEvents');
  expect(blindingViolations('openai', sol(JSON.stringify({message: 'hidden_receipt'})), reference)).toContain('forbidden term hidden_receipt');
  expect(blindingViolations('anthropic', {...opus(), system: instructions + ' extra'}, reference)).toContain('instructions differ from reference');
  expect(blindingViolations('openai', sol(JSON.stringify({message: 'sk-test-SECRET-123456'})), reference, ['sk-test-SECRET-123456'])).toContain('credential present');
});
test('model replay is excluded from the label scan, but harness tool results are scanned', () => {
  const p: any = opus();
  p.messages.push({role: 'assistant', content: [{type: 'text', text: 'normal'}, {type: 'tool_use', id: 't', name: 'inspect', input: {}}]});
  p.messages.push({role: 'user', content: [{type: 'tool_result', tool_use_id: 't', content: JSON.stringify({result: {status: 'ok'}})}]});
  expect(blindingViolations('anthropic', p, reference)).toEqual([]);
  p.messages.at(-1).content[0].content = JSON.stringify({result: {status: 'ok'}, scenario: 'x'});
  expect(blindingViolations('anthropic', p, reference).length).toBeGreaterThan(0);
});
test('invalid, refused, truncated and non-tool responses are never executable', () => {
  const ok = {stop_reason: 'tool_use', content: [{type: 'thinking', thinking: '', signature: 's'}, {type: 'tool_use', id: 'c', name: 'finish', input: {status: 'infeasible'}}]};
  expect(parseResponse('anthropic', ok, aTools)).toEqual({ok: true, callId: 'c', action: {tool: 'finish', args: {status: 'infeasible'}}});
  for (const bad of [{...ok, stop_reason: 'refusal'}, {...ok, stop_reason: 'max_tokens'}, {stop_reason: 'end_turn', content: [{type: 'text', text: 'done'}]},
    {...ok, content: [...ok.content, ok.content[1]]}, {...ok, content: [{...ok.content[1], name: 'reset'}]},
    {...ok, content: [{...ok.content[1], input: {status: 'done'}}]}, {...ok, content: [{...ok.content[1], input: {status: 'completed', x: 1}}]}])
    expect(parseResponse('anthropic', bad, aTools).ok).toBe(false);
  const fc = {type: 'function_call', call_id: 'k', name: 'quote', arguments: '{"cash":"80"}'};
  const okSol = {status: 'completed', output: [{type: 'reasoning', encrypted_content: 'e'}, fc]};
  expect(parseResponse('openai', okSol, oTools)).toEqual({ok: true, callId: 'k', action: {tool: 'quote', args: {cash: '80'}}});
  for (const bad of [{...okSol, status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}}, {status: 'completed', output: []},
    {...okSol, output: [fc, fc]}, {...okSol, output: [{...fc, arguments: '{"cash":80}'}]}, {...okSol, output: [{...fc, arguments: 'nope'}]}])
    expect(parseResponse('openai', bad, oTools).ok).toBe(false);
});
test('usage settles at documented rates; cache categories and cap overruns fail closed', () => {
  expect(settleUsage(MODELS.opus, {input_tokens: 1000, output_tokens: 100})).toBeCloseTo(.006, 12);
  expect(settleUsage(MODELS.sol, {input_tokens: 1000, output_tokens: 100, input_tokens_details: {cached_tokens: 0}})).toBeCloseTo(.003, 12);
  expect(() => settleUsage(MODELS.opus, {input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 5})).toThrow();
  expect(() => settleUsage(MODELS.sol, {input_tokens: 1, output_tokens: 1, input_tokens_details: {cache_write_tokens: 5}})).toThrow();
  expect(() => reservation(MODELS.sol, MODELS.sol.maxVisibleBytes + 1, 0)).toThrow();
  expect(reservation(MODELS.opus, 16384, 7 * 2048)).toBeCloseTo(((16384 + 512 + 14336) * 4 + 2048 * 20) / 1e6, 12);
});
test('opaque signatures do not count as visible bytes; append-only detects edits of earlier turns', () => {
  const a = {x: 'y', signature: 'A'.repeat(1000)}, b = {x: 'y', signature: 'B'};
  expect(visibleBytes(a) - visibleBytes(b)).toBe(String(1000).length - 1);
  const m1 = [{role: 'user', content: [{type: 'text', text: 'a'}]}];
  expect(isAppendOnly(m1, [...structuredClone(m1), {role: 'assistant', content: []}])).toBe(true);
  expect(isAppendOnly(m1, [{role: 'user', content: [{type: 'text', text: 'b'}]}])).toBe(false);
});
