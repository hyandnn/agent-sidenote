const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { load } = require('./helpers');

const adapterFiles = ['shared', 'index', 'chatgpt', 'doubao', 'gemini'].map((name) => `content/adapters/${name}.js`);

function adapterPage(fixture, url) {
  const { window } = new JSDOM(fs.readFileSync(path.join(__dirname, 'fixtures', `${fixture}.html`), 'utf8'), { url });
  const location = new URL(url);
  Object.assign(window, { scrollX: 0, scrollY: 0, innerWidth: 1200, innerHeight: 900 });
  load(adapterFiles, { window, document: window.document, Node: window.Node, location });
  return { window, document: window.document, location, adapter: window.CGIAAdapters.getCurrentAdapter() };
}

function selection(document, startId, endId = startId) {
  const anchorNode = document.getElementById(startId).firstChild;
  const focusNode = document.getElementById(endId).firstChild;
  return {
    anchorNode, focusNode, rangeCount: 1,
    toString: () => anchorNode.textContent,
    getRangeAt: () => ({
      commonAncestorContainer: anchorNode,
      getBoundingClientRect: () => ({ left: 100, bottom: 120 })
    })
  };
}

module.exports = { adapterPage, selection };
