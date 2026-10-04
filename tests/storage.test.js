const test = require('node:test');
const assert = require('node:assert/strict');
const { load, storageMock, note } = require('./helpers');
const files = ['shared/note_schema.js', 'background/note_store.js'];

test('concurrent writes preserve different notes', async () => {
  const mock = storageMock();
  const store = load(files, { chrome: mock.chrome }).CGIANoteStore;
  await Promise.all([store.saveNote(note('a')), store.saveNote(note('b'))]);
  assert.equal((await store.listNotes()).length, 2);
});

test('legacy notes migrate once, including closed notes', async () => {
  const closed = { ...note('closed'), status: 'hidden' };
  const mock = storageMock({ cgia_standalone_notes: { old: note('old'), closed } });
  let store = load(files, { chrome: mock.chrome }).CGIANoteStore;
  assert.equal((await store.listNotes()).length, 2);
  assert.equal(mock.data().cgia_standalone_notes, undefined);
  store = load(files, { chrome: mock.chrome }).CGIANoteStore;
  assert.equal((await store.listNotes()).length, 2);
  assert.equal(await store.restoreNotes(closed.pageUrl), 1);
  assert.equal((await store.listNotes()).find((n) => n.noteId === 'closed').status, 'visible');
});

test('failed migration keeps original data for retry', async () => {
  const mock = storageMock({ cgia_standalone_notes: { old: note('old') } });
  const store = load(files, { chrome: mock.chrome }).CGIANoteStore;
  mock.fail();
  await assert.rejects(store.listNotes(), /QUOTA_BYTES/);
  assert.ok(mock.data().cgia_standalone_notes.old);
  assert.equal((await store.listNotes()).length, 1);
});

test('stale edits are rejected instead of overwriting another tab', async () => {
  const mock = storageMock();
  const store = load(files, { chrome: mock.chrome }).CGIANoteStore;
  const saved = await store.saveNote(note());
  await store.saveNote({ ...saved, tags: ['new'] });
  await assert.rejects(store.saveNote({ ...saved, tags: ['stale'] }), /其他窗口更新/);
  assert.equal((await store.listNotes())[0].tags[0], 'new');
});

test('storage failures reject and do not poison later writes', async () => {
  const mock = storageMock();
  const store = load(files, { chrome: mock.chrome }).CGIANoteStore;
  await store.listNotes();
  mock.fail();
  await assert.rejects(store.saveNote(note('failed')), /QUOTA_BYTES/);
  await store.saveNote(note('ok'));
  assert.equal((await store.listNotes())[0].noteId, 'ok');
});

test('export receipts are independent of note snapshots', async () => {
  const mock = storageMock();
  const store = load(files, { chrome: mock.chrome }).CGIANoteStore;
  const saved = await store.saveNote(note());
  await store.markExported('cgia_export:test', 'hash');
  await store.saveNote({ ...saved, tags: ['edited'] });
  assert.equal((await store.getReceipts())['cgia_export:test'], 'hash');
});

test('client serializes rapid updates to the same note revision', async () => {
  const mock = storageMock();
  const store = load(files, { chrome: mock.chrome }).CGIANoteStore;
  mock.chrome.runtime.sendMessage = (message, respond) => {
    store.saveNote(message.note).then((saved) => respond({ note: saved }), (error) => respond({ error: error.message }));
  };
  const client = load(['shared/note_client.js'], { chrome: mock.chrome }).CGIANoteClient;
  const n = note();
  await Promise.all([client.saveNote(n), client.saveNote(n)]);
  assert.equal(n.revision, 2);
});
