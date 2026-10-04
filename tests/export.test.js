const test = require('node:test');
const assert = require('node:assert/strict');
const { load, note } = require('./helpers');
const schema = load(['shared/note_schema.js']).CGIANoteSchema;

test('metadata changes invalidate export receipts', () => {
  const n = note();
  const first = schema.prepareMarkdownExport([n], { onlyChanged: true });
  const receipts = { [first.files[0].receiptKey]: first.files[0].contentHash };
  assert.equal(schema.prepareMarkdownExport([n], { onlyChanged: true }, receipts).files.length, 0);
  for (const patch of [{ tags: ['important'] }, { noteType: 'todo' }, { marks: ['important'] }, { mainTopic: 'New title' }]) {
    assert.equal(schema.prepareMarkdownExport([{ ...n, ...patch }], { onlyChanged: true }, receipts).files.length, 1);
  }
});

test('incremental merged exports include the entire URL group', () => {
  const a = note('a'), b = { ...note('b'), selectedText: 'another quote' };
  const options = { mergeByUrl: true, onlyChanged: true };
  const first = schema.prepareMarkdownExport([a, b], options);
  const receipts = { [first.files[0].receiptKey]: first.files[0].contentHash };
  b.messages[1].content = 'new answer';
  const next = schema.prepareMarkdownExport([a, b], options, receipts);
  assert.equal(next.files.length, 1);
  assert.match(next.files[0].content, /selected quote/);
  assert.match(next.files[0].content, /another quote/);
  assert.equal(next.notes.length, 2);
});

test('single, merged, and destination receipts are separate', () => {
  const n = note();
  const single = schema.prepareMarkdownExport([n], { onlyChanged: true }).files[0];
  const receipts = { [single.receiptKey]: single.contentHash };
  assert.equal(schema.prepareMarkdownExport([n], { onlyChanged: true, mergeByUrl: true }, receipts).files.length, 1);
  assert.equal(schema.prepareMarkdownExport([n], { onlyChanged: true }, receipts, 'Other').files.length, 1);
});

test('closed notes remain exportable', () => {
  assert.equal(schema.prepareMarkdownExport([{ ...note(), status: 'hidden' }]).files.length, 1);
});

test('YAML tags remain quoted strings and unique ids survive filenames', () => {
  const a = note(), b = note('note_1791100001000_bbbb');
  a.tags = ['true', 'foo: bar', '#stereo', 'line\nbreak'];
  const md = schema.noteToMarkdown(a);
  for (const tag of a.tags) assert.ok(md.includes(`  - ${JSON.stringify(tag)}`));
  assert.notEqual(schema.markdownOutputFilename(schema.noteToJsonlRecord(a)), schema.markdownOutputFilename(schema.noteToJsonlRecord(b)));
});

test('UI movement does not produce a new export artifact', () => {
  const a = note();
  const first = schema.prepareMarkdownExport([a]).files[0];
  const receipts = { [first.receiptKey]: first.contentHash };
  a.position = { x: 200, y: 100 };
  a.updatedAt = '2026-10-05T00:00:00Z';
  assert.equal(schema.prepareMarkdownExport([a], { onlyChanged: true }, receipts).files.length, 0);
});

test('failed questions and partial answers are preserved in Markdown', () => {
  const n = note();
  n.messages[1] = { role: 'assistant', content: 'partial answer', status: 'failed', error: 'network error' };
  const md = schema.noteToMarkdown(n);
  assert.match(md, /question/);
  assert.match(md, /partial answer/);
  assert.match(md, /请求失败：network error/);
});
