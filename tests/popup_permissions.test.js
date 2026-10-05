const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { load, storageMock, permissionsMock } = require('./helpers');

const key = 'cgia_standalone_settings';
const oldHost = 'https://old.example.com/*';
const newHost = 'https://new.example.com/*';
const initial = { mode: 'api', apiKey: 'fake-key', apiModel: 'test-model', apiBaseUrl: 'https://old.example.com' };
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(t, origins = [oldHost]) {
  const { window } = new JSDOM(fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8'), { url: 'https://extension.example/popup/popup.html' });
  t.after(() => window.close());
  const mock = storageMock({ [key]: initial });
  const permissions = permissionsMock(mock.chrome, origins);
  const sent = [];
  mock.chrome.tabs = { query: (_query, callback) => callback([{ url: 'https://chatgpt.com/c/fixture' }]) };
  mock.chrome.runtime.sendMessage = (message, callback) => { sent.push(message); queueMicrotask(() => callback({ ok: true, message: '连接成功。' })); };
  window.CGIANoteClient = { listNotes: async () => [], getReceipts: async () => ({}) };
  load(['shared/note_schema.js', 'shared/api_permissions.js', 'popup/popup.js'], { globalThis: window, window, document: window.document, chrome: mock.chrome });
  await tick();
  const el = (id) => window.document.getElementById(id);
  permissions.calls.length = 0;
  return { window, mock, permissions, sent, el, click: async (id) => { el(id).click(); await tick(); } };
}

test('save requests the new host in the click gesture, then stores and retires old access', async (t) => {
  const f = await fixture(t);
  f.el('apiBaseUrl').value = 'https://new.example.com';
  f.el('saveBtn').click();
  assert.equal(f.permissions.calls[0].method, 'request');
  assert.deepEqual(f.permissions.calls[0].details, { origins: [newHost] });
  assert.equal(f.mock.data()[key].apiBaseUrl, initial.apiBaseUrl);
  await tick();
  assert.equal(f.mock.data()[key].apiBaseUrl, 'https://new.example.com');
  assert.deepEqual(f.permissions.origins(), [newHost]);
  assert.match(f.el('apiAccessStatus').textContent, /new.example.com：已授权/);
  assert.equal(f.el('saveBtn').disabled, false);
});

test('denied save preserves the previous settings and its permission', async (t) => {
  const f = await fixture(t);
  f.permissions.deny();
  f.el('apiBaseUrl').value = 'https://new.example.com';
  await f.click('saveBtn');
  assert.deepEqual(f.mock.data()[key], initial);
  assert.deepEqual(f.permissions.origins(), [oldHost]);
  assert.match(f.el('saveMsg').textContent, /未授权/);
  assert.equal(f.sent.length, 0);
});

test('test connection waits for authorization and uses the current unsaved host', async (t) => {
  const f = await fixture(t);
  f.el('apiBaseUrl').value = 'https://new.example.com';
  f.el('testBtn').click();
  assert.equal(f.permissions.calls[0].method, 'request');
  assert.equal(f.sent.length, 0);
  await tick();
  assert.equal(f.sent[0].settings.apiBaseUrl, 'https://new.example.com');
  assert.deepEqual(f.mock.data()[key], initial);
  assert.deepEqual(f.permissions.origins(), [oldHost, newHost]);
  await f.click('revokeApiBtn');
  assert.deepEqual(f.permissions.origins(), [oldHost]);
  assert.match(f.el('apiAccessStatus').textContent, /未授权/);
});

test('denied test never dispatches an API request', async (t) => {
  const f = await fixture(t);
  f.permissions.deny();
  await f.click('testBtn');
  assert.equal(f.sent.length, 0);
  assert.match(f.el('testMsg').textContent, /未授权/);
});

test('invalid settings never prompt for access or save', async (t) => {
  const f = await fixture(t);
  f.el('apiBaseUrl').value = 'https://*/*';
  await f.click('saveBtn');
  assert.equal(f.permissions.calls.some((call) => call.method === 'request'), false);
  assert.deepEqual(f.mock.data()[key], initial);
  assert.match(f.el('saveMsg').textContent, /通配符/);
});

test('Mock mode does not request API access and releases previous optional hosts on save', async (t) => {
  const f = await fixture(t);
  f.el('mode').value = 'mock';
  await f.click('testBtn');
  await f.click('saveBtn');
  assert.equal(f.permissions.calls.some((call) => call.method === 'request'), false);
  assert.deepEqual(f.permissions.origins(), []);
  assert.equal(f.mock.data()[key].mode, 'mock');
});

test('storage failure keeps the old configuration and does not revoke its API access', async (t) => {
  const f = await fixture(t);
  f.el('apiBaseUrl').value = 'https://new.example.com';
  f.mock.fail();
  await f.click('saveBtn');
  assert.deepEqual(f.mock.data()[key], initial);
  assert.ok(f.permissions.origins().includes(oldHost));
  assert.match(f.el('saveMsg').textContent, /QUOTA/);
});

test('failed cleanup reports that settings were saved, rather than claiming a failed save', async (t) => {
  const f = await fixture(t);
  f.el('apiBaseUrl').value = 'https://new.example.com';
  f.permissions.refuseRemoval();
  await f.click('saveBtn');
  assert.equal(f.mock.data()[key].apiBaseUrl, 'https://new.example.com');
  assert.match(f.el('saveMsg').textContent, /设置已保存，但旧 API 授权清理失败/);
});

test('popup startup migrates the legacy broad grant before enabling actions', async (t) => {
  const f = await fixture(t, ['https://*/*']);
  assert.deepEqual(f.permissions.origins(), []);
  assert.match(f.el('apiAccessStatus').textContent, /未授权/);
  assert.equal(f.el('saveBtn').disabled, false);
});
