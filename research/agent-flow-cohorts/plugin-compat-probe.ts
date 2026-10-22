// One-off compatibility probe (user-approved: four tiny calls). Reproduces the request shape the stock
// ElizaOS model plugins send (plugin-openai 1.6.0 / plugin-anthropic 1.5.12 via AI SDK 2.x):
// temperature 0.7, frequency/presence penalty 0.7, no reasoning/thinking options. Records request bodies
// without headers, the HTTP status and usage. No retries.
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { writeFileSync } from 'node:fs';

const out: any[] = [];
function recordingFetch(entry: any) {
  return async (url: any, init: any) => {
    entry.url = String(url);
    entry.requestBody = init?.body ? JSON.parse(init.body) : null; // body only, never headers
    const r = await fetch(url, init);
    entry.httpStatus = r.status;
    const text = await r.clone().text();
    try { entry.responseBody = JSON.parse(text); } catch { entry.responseBody = text.slice(0, 2000); }
    return r;
  };
}
const probes = [
  { provider: 'openai', model: 'gpt-6-luna' },
  { provider: 'openai', model: 'gpt-6.1-sol' },
  { provider: 'anthropic', model: 'claude-haiku-5-5' },
  { provider: 'anthropic', model: 'claude-opus-5-5' },
];
for (const p of probes) {
  const entry: any = { ...p, at: new Date().toISOString() };
  out.push(entry);
  const model = p.provider === 'openai'
    ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY, fetch: recordingFetch(entry) as any }).languageModel(p.model)
    : createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: recordingFetch(entry) as any })(p.model);
  try {
    const r = await generateText({ model, prompt: 'Reply with the single word OK.', temperature: 0.7,
      maxOutputTokens: 512, frequencyPenalty: 0.7, presencePenalty: 0.7, maxRetries: 0 });
    entry.ok = true; entry.text = r.text; entry.usage = r.usage; entry.warnings = r.warnings;
  } catch (e) {
    entry.ok = false; entry.error = (e as Error).message.slice(0, 500);
  }
  console.log(p.model, entry.ok ? 'OK' : 'FAILED', entry.httpStatus, entry.ok ? JSON.stringify(entry.usage) : entry.error);
}
const dump = JSON.stringify(out, null, 2);
for (const k of [process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY]) if (k && dump.includes(k)) throw new Error('key leaked into probe record');
writeFileSync(process.argv[2], dump);
