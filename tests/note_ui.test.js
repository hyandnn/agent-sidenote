const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load } = require('./helpers');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.handlers = new Map();
    this.value = '';
    this.className = '';
    this.scrollHeight = 100;
    this.classList = {
      contains: (c) => this.className.split(' ').includes(c),
      add: (c) => { if (!this.classList.contains(c)) this.className += ` ${c}`; },
      remove: (c) => { this.className = this.className.split(' ').filter((n) => n !== c).join(' '); },
      toggle: (c, force) => force ? this.classList.add(c) : this.classList.remove(c)
    };
  }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this); }
  replaceChildren() { this.children = []; }
  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (selector.startsWith('.') ? child.classList.contains(selector.slice(1)) : child.tagName.toLowerCase() === selector) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest() { return null; }
  get offsetWidth() { return parseInt(this.style.width) || 380; }
  get offsetHeight() { return parseInt(this.style.height) || 480; }
  addEventListener(name, fn, options = {}) {
    const handlers = this.handlers.get(name) || new Set();
    handlers.add(fn); this.handlers.set(name, handlers);
    options.signal?.addEventListener('abort', () => handlers.delete(fn), { once: true });
  }
  async fire(name, fields = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() {}, ...fields };
    await Promise.all([...this.handlers.get(name) || []].map((fn) => fn(event)));
  }
}

function fixture() {
  const document = new Element();
  document.body = new Element('body');
  document.createElement = (tag) => new Element(tag);
  document.createDocumentFragment = () => new Element('fragment');
  const snapshots = [], requests = [], observers = [];
  let fail = false;
  const context = load(['shared/note_schema.js'], {
    document,
    location: { href: 'https://chatgpt.com/c/test' },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    innerWidth: 1000, innerHeight: 800,
    CGIAStorage: {
      getSettingsSync: () => ({ autoRestoreNotes: true }),
      saveNote: async (note) => { if (fail) throw new Error('storage failed'); note.revision = (note.revision || 0) + 1; snapshots.push(structuredClone(note)); return note; }
    },
    CGIAApiClient: {
      askModelStream: (_payload, onChunk, options) => new Promise((resolve, reject) => {
        const request = { resolve, reject, onChunk };
        requests.push(request);
        options.signal.addEventListener('abort', () => { const error = new Error('stopped'); error.code = 'CANCELLED'; reject(error); }, { once: true });
      })
    }
  });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/note_manager.js'), 'utf8'), context);
  return { context, document, snapshots, requests, observers, fail: () => { fail = true; } };
}
const selection = { selectedText: 'quoted text', rect: { right: 50, left: 20, top: 30 } };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('questions are saved before requesting, repeated shortcuts are blocked, partial answers survive failure', async () => {
  const f = fixture();
  await f.context.CGIANoteManager.createNote(selection);
  const el = f.document.body.querySelector('.cgia-note');
  const input = el.querySelector('.cgia-question-input');
  input.value = 'first question';
  const sent = el.querySelector('.cgia-send-button').fire('click');
  await tick();
  assert.equal(f.snapshots.at(-1).messages[0].content, 'first question');
  input.value = 'second question';
  await input.fire('keydown', { key: 'Enter', ctrlKey: true });
  assert.equal(f.requests.length, 1);
  f.requests[0].onChunk('partial', 'partial');
  f.requests[0].reject(new Error('network failed'));
  await sent;
  assert.equal(f.snapshots.at(-1).messages[1].content, 'partial');
  assert.equal(f.snapshots.at(-1).messages[1].status, 'failed');
  assert.equal(input.value, 'second question');
  await el.querySelector('.cgia-note-close').fire('click');
});

test('failed initial persistence keeps the question and never calls the API', async () => {
  const f = fixture();
  await f.context.CGIANoteManager.createNote(selection);
  const el = f.document.body.querySelector('.cgia-note');
  const input = el.querySelector('.cgia-question-input');
  input.value = 'valuable question';
  f.fail();
  await el.querySelector('.cgia-send-button').fire('click');
  assert.equal(input.value, 'valuable question');
  assert.equal(f.requests.length, 0);
  assert.match(el.querySelector('.cgia-save-feedback').textContent || el.querySelector('.cgia-error-msg').textContent, /storage failed/);
  f.context.CGIANoteManager.clearNotesForPage(f.context.location.href);
});

test('closing notes releases document listeners and resize observers', async () => {
  const f = fixture();
  await f.context.CGIANoteManager.createNote(selection);
  assert.equal(f.document.handlers.get('mousemove').size, 1);
  const el = f.document.body.querySelector('.cgia-note');
  await el.querySelector('.cgia-note-close').fire('click');
  assert.equal(f.document.handlers.get('mousemove').size, 0);
  assert.equal(f.document.handlers.get('mouseup').size, 0);
  assert.equal(f.observers[0].disconnected, true);
  assert.equal(f.snapshots.at(-1).status, 'hidden');
});

test('closing a streaming note cancels its request and retains the partial answer', async () => {
  const f = fixture();
  await f.context.CGIANoteManager.createNote(selection);
  const el = f.document.body.querySelector('.cgia-note');
  el.querySelector('.cgia-question-input').value = 'question';
  const sent = el.querySelector('.cgia-send-button').fire('click');
  await tick();
  f.requests[0].onChunk('partial', 'partial');
  await el.querySelector('.cgia-note-close').fire('click');
  await sent;
  assert.equal(f.snapshots.at(-1).messages[1].status, 'cancelled');
  assert.equal(f.snapshots.at(-1).messages[1].content, 'partial');
  assert.equal(f.snapshots.at(-1).status, 'hidden');
});
