const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, permissionsMock } = require('./helpers');

const api = 'https://api.example.com';
const origin = `${api}/*`;
const settings = { apiBaseUrl: api, apiKey: 'fake-key', requestTimeoutMs: 1000 };
const siteOrigins = ['https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://www.doubao.com/*', 'https://doubao.com/*', 'https://gemini.google.com/*'];

function fixture(initial = [], fetch = async () => { throw new Error('Unexpected network request'); }) {
  const chrome = { runtime: {} };
  const permissions = permissionsMock(chrome, initial);
  const context = load(['shared/api_permissions.js', 'background/llm_client.js'], { chrome, fetch });
  return { context, permissions, access: context.CGIAApiPermissions };
}

test('required hosts stay limited to the supported sites; API hosts are optional', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json')));
  assert.deepEqual(manifest.host_permissions, siteOrigins);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, siteOrigins);
});

test('API URL normalization shares the exact endpoint and host permission, including local ports', () => {
  const { access } = fixture();
  for (const base of [api, `${api}/`, `${api}/v1/`, `${api}/v1/chat/completions`]) {
    assert.equal(access.getEndpoint(base).url, `${api}/v1/chat/completions`);
    assert.equal(access.getEndpoint(base).permissionOrigin, origin);
  }
  const local = access.getEndpoint('http://localhost:8080/api/v1/');
  assert.equal(local.url, 'http://localhost:8080/api/v1/chat/completions');
  assert.equal(local.permissionOrigin, 'http://localhost/*');
  assert.equal(local.origin, 'http://localhost:8080');
});

test('invalid URLs never result in a broad permission request', () => {
  const { access, permissions } = fixture();
  for (const url of ['invalid', 'ftp://api.example.com', 'https://*/*', 'https://user:password@api.example.com', `${api}?key=secret`, `${api}#fragment`]) assert.throws(() => access.requestAccess(url));
  assert.equal(permissions.calls.length, 0);
});

test('request is synchronous in the user gesture and grants only one specific host', async () => {
  const { access, permissions } = fixture();
  const pending = access.requestAccess(api);
  assert.equal(permissions.calls[0].method, 'request');
  assert.deepEqual(permissions.calls[0].details, { origins: [origin] });
  await pending;
  assert.deepEqual(permissions.origins(), [origin]);
  assert.equal(await access.hasAccess('https://other.example.com'), false);
});

test('permission denial and Chrome API errors propagate instead of authorizing implicitly', async () => {
  const { access, permissions } = fixture();
  permissions.deny();
  await assert.rejects(access.requestAccess(api), (error) => error.code === 'API_PERMISSION_REQUIRED' && /未授权/.test(error.message));
  permissions.fail('permission service failed');
  await assert.rejects(access.requestAccess(api), /permission service failed/);
  assert.deepEqual(permissions.origins(), []);
});

test('missing API access blocks fetch before any key or prompt is transmitted', async () => {
  let fetched = false;
  const { context } = fixture(siteOrigins, async () => { fetched = true; });
  await assert.rejects(context.askModelStream('private prompt', settings, () => {}), (error) => error.code === 'API_PERMISSION_REQUIRED' && /扩展设置/.test(error.message));
  assert.equal(fetched, false);
});

test('legacy all-site grants are removed without changing required site access', async () => {
  const { access, permissions } = fixture([...siteOrigins, 'https://*/*', origin]);
  await access.requireAccess(api);
  assert.deepEqual(permissions.origins().sort(), [...siteOrigins, origin].sort());
});

test('a legacy broad grant alone requires fresh specific authorization', async () => {
  const { access, permissions } = fixture([...siteOrigins, 'https://*/*']);
  await assert.rejects(access.requireAccess(api), (error) => error.code === 'API_PERMISSION_REQUIRED');
  assert.deepEqual(permissions.origins(), siteOrigins);
});

test('failed legacy permission cleanup fails closed', async () => {
  const { access, permissions } = fixture(['https://*/*']);
  permissions.refuseRemoval();
  await assert.rejects(access.requireAccess(api), /全部网站授权未能清理/);
});

test('saving another API host or Mock mode removes stale optional grants only', async () => {
  const stale = 'https://old.example.com/*';
  const { access, permissions } = fixture([...siteOrigins, stale, origin]);
  await access.retainOnlyApiAccess({ mode: 'api', apiBaseUrl: api });
  assert.deepEqual(permissions.origins().sort(), [...siteOrigins, origin].sort());
  await access.retainOnlyApiAccess({ mode: 'mock' });
  assert.deepEqual(permissions.origins(), siteOrigins);
});

test('revocation blocks subsequent requests and never calls request from the worker', async () => {
  const { access, permissions, context } = fixture([origin]);
  await access.revokeAccess(api);
  await assert.rejects(context.askModelStream('prompt', settings, () => {}), (error) => error.code === 'API_PERMISSION_REQUIRED');
  assert.equal(permissions.calls.some((call) => call.method === 'request'), false);
});

test('API settings cannot silently revoke the required conversation-site permission', async () => {
  const { access, permissions } = fixture(siteOrigins);
  await assert.rejects(access.revokeAccess('https://chatgpt.com'), /Chrome/);
  assert.deepEqual(permissions.origins(), siteOrigins);
});

test('authorized streaming uses the normalized endpoint and refuses redirects', async () => {
  const calls = [];
  const { context } = fixture([origin], async (...args) => {
    calls.push(args);
    return new Response('data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n');
  });
  assert.equal(await context.askModelStream('prompt', settings, () => {}), 'answer');
  assert.equal(calls[0][0], `${api}/v1/chat/completions`);
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer fake-key');
});

test('revoking an active stream aborts it and keeps the received answer', async () => {
  let rejectRead;
  let partialResolve;
  const partialReceived = new Promise((resolve) => { partialResolve = resolve; });
  const { context, access } = fixture([origin], async (_url, options) => {
    let first = true;
    options.signal.addEventListener('abort', () => rejectRead(new DOMException('Aborted', 'AbortError')), { once: true });
    return { ok: true, body: { getReader: () => ({
      read: () => first ? (first = false, Promise.resolve({ value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'), done: false })) : new Promise((_resolve, reject) => { rejectRead = reject; }),
      cancel: async () => {}, releaseLock() {}
    }) } };
  });
  const request = context.askModelStream('prompt', settings, () => partialResolve());
  const rejected = assert.rejects(request, (error) => error.code === 'API_PERMISSION_REQUIRED' && error.partialAnswer === 'partial');
  await partialReceived;
  await access.revokeAccess(api);
  await rejected;
});
