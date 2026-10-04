const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');

test('URL-only SPA transitions are detected without patching page History', async () => {
  let poll, observed, disconnected = false;
  const handlers = {}, cleared = [], loaded = [];
  const context = load(['content/route_manager.js'], {
    location: { href: 'https://chatgpt.com/c/a' },
    window: { addEventListener: (name, fn) => { handlers[name] = fn; }, CGIANoteManager: { clearNotesForPage: (url) => cleared.push(url), loadNotesForPage: async (url) => loaded.push(url) }, CGIASelection: { hideSelectionButton() {} } },
    document: { body: {} },
    queueMicrotask,
    setInterval: (fn) => { poll = fn; return 1; }, clearInterval() {},
    MutationObserver: class { observe(_body, options) { observed = options; } disconnect() { disconnected = true; } }
  });
  context.window.CGIARouteManager.initRouteManager();
  context.location.href = 'https://chatgpt.com/c/b';
  poll();
  assert.equal(cleared[0], 'https://chatgpt.com/c/a');
  assert.equal(loaded[0], 'https://chatgpt.com/c/b');
  assert.equal(observed.subtree, true);
  handlers.pagehide();
  assert.equal(disconnected, true);
  handlers.pageshow();
  assert.equal(loaded.length, 2);
  assert.equal(loaded[1], 'https://chatgpt.com/c/b');
});
