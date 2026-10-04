const test = require('node:test');
const assert = require('node:assert/strict');
const { load, event } = require('./helpers');
function downloadContext(state = 'in_progress') {
  const changed = event();
  const chrome = { runtime: {}, downloads: { onChanged: changed, download: (_options, done) => done(7), search: (_query, done) => done([{ id: 7, state }]) } };
  return { changed, context: load(['background/export_helper.js'], { chrome, URL: {}, btoa }) };
}

test('download success waits for completion, not merely its id', async () => {
  const { context, changed } = downloadContext();
  let settled = false;
  const result = context.downloadMarkdownContent('markdown', 'note.md', 'Notes').then((id) => { settled = true; return id; });
  await Promise.resolve();
  assert.equal(settled, false);
  changed.emit({ id: 7, state: { current: 'complete' } });
  assert.equal(await result, 7);
});

test('cancelled downloads reject and already completed downloads resolve', async () => {
  const { context, changed } = downloadContext();
  const result = context.downloadMarkdownContent('markdown', 'note.md', 'Notes');
  changed.emit({ id: 7, state: { current: 'interrupted' } });
  await assert.rejects(result, /失败或已取消/);
  assert.equal(await downloadContext('complete').context.downloadMarkdownContent('markdown', 'note.md', 'Notes'), 7);
});

test('invalid download paths and filenames fail before starting', async () => {
  const { context } = downloadContext();
  await assert.rejects(context.downloadMarkdownContent('markdown', '../escape.md', 'Notes'), /文件名无效/);
  assert.throws(() => context.downloadMarkdownContent('markdown', 'note.md', '../outside'), /不能包含/);
});
