const test = require('node:test');
const assert = require('node:assert/strict');
const { load, event } = require('./helpers');
const settings = { apiKey: 'fake', requestTimeoutMs: 1000 };
function client(text) {
  return load(['background/llm_client.js'], { fetch: async () => new Response(text) });
}
const delta = (content, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\r\n\r\n`;

test('SSE handles split UTF-8 chunks, CRLF, and final data without newline', async () => {
  const bytes = new TextEncoder().encode(delta('你好') + 'data: [DONE]');
  const context = load(['background/llm_client.js'], { fetch: async () => new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1)); controller.close(); } })) });
  assert.equal(await context.askModelStream('prompt', settings, () => {}), '你好');
});

test('provider errors preserve partial answers', async () => {
  const context = client(delta('partial') + 'data: {"error":{"message":"provider failed"}}\n\n');
  await assert.rejects(context.askModelStream('prompt', settings, () => {}), (error) => error.partialAnswer === 'partial' && /provider failed/.test(error.message));
});

test('length-limited and prematurely ended answers are not reported complete', async () => {
  await assert.rejects(client(delta('partial', 'length')).askModelStream('prompt', settings, () => {}), (error) => error.partialAnswer === 'partial');
  await assert.rejects(client(delta('partial')).askModelStream('prompt', settings, () => {}), /提前结束/);
});

test('finish_reason stop is accepted without a DONE event', async () => {
  assert.equal(await client(delta('answer', 'stop')).askModelStream('prompt', settings, () => {}), 'answer');
});

test('clean port disconnect rejects instead of hanging', async () => {
  const port = { onMessage: event(), onDisconnect: event(), postMessage() {}, disconnect() {} };
  const context = load(['content/api_client.js'], { window: { CGIAStorage: { getSettingsSync: () => ({ mode: 'mock' }) } }, chrome: { runtime: { id: 'test', connect: () => port } } });
  const result = context.window.CGIAApiClient.askModelStream({ noteId: 'n' });
  port.onMessage.emit({ type: 'chunk', full: 'partial' });
  port.onDisconnect.emit();
  await assert.rejects(result, (error) => error.partialAnswer === 'partial');
});

test('cancelling a content request settles and notifies the worker', async () => {
  const sent = [];
  const port = { onMessage: event(), onDisconnect: event(), postMessage: (m) => sent.push(m), disconnect() {} };
  const context = load(['content/api_client.js'], { window: { CGIAStorage: { getSettingsSync: () => ({ mode: 'mock' }) } }, chrome: { runtime: { id: 'test', connect: () => port } } });
  const controller = new AbortController();
  const result = context.window.CGIAApiClient.askModelStream({}, null, { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, (error) => error.code === 'CANCELLED');
  assert.ok(sent.some((m) => m.type === 'CANCEL'));
});
