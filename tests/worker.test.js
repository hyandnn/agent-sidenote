const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load, event, storageMock } = require('./helpers');

function worker() {
  const mock = storageMock();
  const get = mock.chrome.storage.local.get;
  mock.chrome.storage.local.get = (value, callback) => callback ? get(value, callback) : new Promise((resolve, reject) => get(value, (data) => mock.chrome.runtime.lastError ? reject(new Error(mock.chrome.runtime.lastError.message)) : resolve(data)));
  mock.chrome.runtime.onConnect = event();
  mock.chrome.runtime.onMessage = event();
  mock.chrome.downloads = { onChanged: event() };
  const context = load([], { chrome: mock.chrome, URL: {}, btoa });
  context.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../background', file), 'utf8'), context, { filename: file });
  };
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../background/service_worker.js'), 'utf8'), context);
  return { context, mock };
}

test('worker respects context settings even for notes captured before settings changed', async () => {
  const { context } = worker();
  let captured = '';
  context.askModelStream = async (prompt) => { captured = prompt; return 'answer'; };
  await context.streamAsk({ userQuestion: 'question', selectedText: 'quote', fullMessageText: 'SECRET_MESSAGE', mainConversation: [{ role: 'user', content: 'SECRET_HISTORY' }] }, { mode: 'api', includeFullMessage: false, includeMainConversation: false }, () => {});
  assert.ok(!captured.includes('SECRET_MESSAGE'));
  assert.ok(!captured.includes('SECRET_HISTORY'));
  assert.ok(captured.includes('question'));
});

test('partial batch failure marks only completed files exported', async () => {
  const { context } = worker();
  context.downloadMarkdownContent = async (_content, name) => { if (name === 'b.md') throw new Error('cancelled'); return 1; };
  const files = ['a', 'b'].map((id) => ({ filename: `${id}.md`, content: 'markdown', receiptKey: `cgia_export:${id}`, contentHash: `hash-${id}` }));
  await assert.rejects(context.handleDownloadMd(files), /已完成 1\/2/);
  const receipts = await context.CGIANoteStore.getReceipts();
  assert.equal(receipts['cgia_export:a'], 'hash-a');
  assert.equal(receipts['cgia_export:b'], undefined);
});
