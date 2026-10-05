const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');
const { adapterPage, selection } = require('./dom_helpers');

const cases = [
  ['chatgpt', 'https://chatgpt.com/c/fixture', 'chatgpt'],
  ['doubao', 'https://www.doubao.com/chat/fixture', 'doubao'],
  ['doubao-bubbles', 'https://doubao.com/chat/fixture', 'doubao'],
  ['gemini', 'https://gemini.google.com/app/fixture', 'gemini'],
  ['gemini-classes', 'https://gemini.google.com/app/fixture', 'gemini']
];
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

for (const [fixture, url, siteId] of cases) {
  test(`${fixture}: ordered canonical messages exclude sidebar, controls, drafts and reasoning`, () => {
    const { adapter, document } = adapterPage(fixture, url);
    assert.equal(adapter.id, siteId);
    const messages = adapter.getAllMessages();
    assert.equal(messages.length, 4);
    assert.deepEqual(Array.from(messages, (el) => adapter.getRole(el)), ['user', 'assistant', 'user', 'assistant']);
    assert.deepEqual(Array.from(messages, (el) => normalize(adapter.getMessageText(el, '', 4000))), [
      'What is stereo?', 'Stereo estimates depth from disparity.',
      'How do I handle occlusion?', 'Keep an uncertainty estimate. confidence = 0.8'
    ]);
    const selected = adapter.getMessageElement(selection(document, 'quote2'));
    assert.equal(selected, messages[3]);
    assert.deepEqual(Array.from(adapter.getMainConversation(selected, 6, 800), (m) => ({ ...m })), [
      { role: 'user', content: 'What is stereo?' },
      { role: 'assistant', content: 'Stereo estimates depth from disparity.' },
      { role: 'user', content: 'How do I handle occlusion?' }
    ]);
    assert.equal(adapter.getMainConversation(messages[1], 6, 800).length, 1);
    assert.equal(adapter.getMainConversation(selected, 1, 800)[0].content, 'How do I handle occlusion?');
    assert.equal(adapter.getMainConversation(document.createElement('div'), 6, 800).length, 0);
    assert.equal(adapter.getConversationTitle(), 'Stereo basics');
  });

  test(`${fixture}: selections stay inside a single real message`, () => {
    const { adapter, document } = adapterPage(fixture, url);
    for (const id of ['sidebar', 'composer', 'own-note', ...(siteId === 'gemini' ? ['thought'] : [])]) {
      assert.equal(adapter.getMessageElement(selection(document, id)), null, id);
    }
    assert.equal(adapter.getMessageElement(selection(document, 'quote1', 'quote2')), null);
    const textNode = document.getElementById('quote1').firstChild;
    assert.ok(adapter.getMessageElement({ anchorNode: textNode, focusNode: textNode }));
  });

  test(`${fixture}: selection payload uses the current transcript after a SPA update`, async () => {
    const { window, document, location } = adapterPage(fixture, url);
    let currentSelection = selection(document, 'quote2');
    let captured;
    window.getSelection = () => currentSelection;
    window.CGIAStorage = { getSettingsSync: () => ({ maxSelectedTextLength: 3000, includeMainConversation: true, mainConversationMaxMessages: 6, includeFullMessage: true, fullMessageMaxLength: 4000, surroundingTextMaxLength: 1200 }) };
    window.CGIANoteManager = { createNote: async (info) => { captured = info; } };
    load(['content/selection.js'], { window, document, Node: window.Node, location });
    window.CGIASelection.initSelection();
    document.dispatchEvent(new window.Event('mouseup'));
    const button = document.querySelector('.cgia-selection-button');
    assert.ok(button);
    button.click();
    await Promise.resolve();
    assert.equal(captured.siteId, siteId);
    assert.equal(captured.selectedText, 'uncertainty estimate');
    assert.equal(captured.mainQuestion, 'What is stereo?');
    assert.ok(captured.fullMessageText.includes('confidence = 0.8'));

    document.querySelector('main').innerHTML = document.querySelector('main').innerHTML.replaceAll('What is stereo?', 'New conversation question').replaceAll('uncertainty estimate', 'new selected quote');
    location.pathname += '-next';
    currentSelection = selection(document, 'quote2');
    document.dispatchEvent(new window.Event('mouseup'));
    document.querySelector('.cgia-selection-button').click();
    await Promise.resolve();
    assert.equal(captured.mainQuestion, 'New conversation question');
    assert.equal(captured.selectedText, 'new selected quote');

    currentSelection = selection(document, 'sidebar');
    document.dispatchEvent(new window.Event('mouseup'));
    assert.equal(document.querySelector('.cgia-selection-button'), null);
  });
}

test('adapter host matching is exact and includes only the supported aliases', () => {
  const { window } = adapterPage('chatgpt', 'https://chatgpt.com/c/fixture');
  assert.equal(window.CGIAAdapters.getAdapterForPage('https://chat.openai.com/c/a').id, 'chatgpt');
  for (const url of ['https://chatgpt.com.evil.example/', 'https://doubao.com.evil.example/', 'https://example.com/']) assert.equal(window.CGIAAdapters.getAdapterForPage(url), null);
});

test('context truncation handles quotes longer than the budget and a zero budget', () => {
  const { window } = adapterPage('chatgpt', 'https://chatgpt.com/c/fixture');
  const truncate = window.CGIAAdapterShared.truncateAroundSelection;
  assert.equal(truncate('before selected text after', 'selected text', 0), '');
  assert.equal(truncate('before selected text after', 'selected text', 5), '[前文已截断]\nselec\n[后文已截断]');
});
