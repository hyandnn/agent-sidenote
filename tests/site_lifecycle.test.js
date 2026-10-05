const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');
const { adapterPage, selection } = require('./dom_helpers');
const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const [fixture, url] of [
  ['chatgpt', 'https://chatgpt.com/c/fixture'],
  ['doubao', 'https://www.doubao.com/chat/fixture'],
  ['gemini', 'https://gemini.google.com/app/fixture']
]) {
  test(`${fixture}: persisted notes remain scoped across conversation switches and close/restore`, async (t) => {
    const { window, document, location, adapter } = adapterPage(fixture, url);
    document.querySelector('.cgia-note').remove();
    const records = new Map();
    window.CGIAStorage = {
      getSettingsSync: () => ({ autoRestoreNotes: true }),
      saveNote: async (note) => { records.set(note.noteId, structuredClone(note)); return note; },
      loadNotesForPage: async (pageUrl) => [...records.values()].filter((note) => note.pageUrl === pageUrl).map((note) => structuredClone(note))
    };
    load(['shared/note_schema.js', 'content/note_manager.js'], {
      globalThis: window, window, document, location, AbortController: window.AbortController,
      ResizeObserver: class { observe() {} disconnect() {} }
    });
    const manager = window.CGIANoteManager;
    t.after(() => { manager.clearNotesForPage(url); window.close(); });
    const message = adapter.getMessageElement(selection(document, 'quote2'));
    const note = await manager.createNote({
      selectedText: 'uncertainty estimate', siteId: adapter.id,
      fullMessageText: adapter.getMessageText(message, 'uncertainty estimate', 4000),
      mainConversation: adapter.getMainConversation(message, 6, 800),
      rect: { left: 100, right: 200, top: 100 }
    });
    assert.equal(records.get(note.noteId).pageUrl, url);
    assert.equal(document.querySelectorAll('.cgia-note').length, 1);
    assert.ok(records.get(note.noteId).fullMessageText.includes('confidence = 0.8'));
    assert.equal(records.get(note.noteId).mainConversation.length, 3);

    location.pathname += '-next';
    manager.clearNotesForPage(url);
    await tick();
    await manager.loadNotesForPage(location.href);
    assert.equal(document.querySelectorAll('.cgia-note').length, 0);

    location.href = url;
    await manager.loadNotesForPage(url);
    assert.equal(document.querySelectorAll('.cgia-note').length, 1);
    document.querySelector('.cgia-note-close').click();
    await tick();
    assert.equal(records.get(note.noteId).status, 'hidden');
    await manager.loadNotesForPage(url);
    assert.equal(document.querySelectorAll('.cgia-note').length, 0);

    records.get(note.noteId).status = 'visible';
    await manager.loadNotesForPage(url, true);
    assert.equal(document.querySelectorAll('.cgia-note').length, 1);
  });
}
