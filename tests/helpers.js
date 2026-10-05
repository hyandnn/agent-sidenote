const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(files, globals = {}) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, TextDecoder, TextEncoder, URL, AbortController, DOMException, ...globals });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  return context;
}

function event() {
  const listeners = new Set();
  return { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn), emit: (...args) => { for (const fn of [...listeners]) fn(...args); } };
}

function storageMock(initial = {}) {
  let data = structuredClone(initial);
  let failNext = false;
  const chrome = { runtime: { id: 'test' }, storage: { onChanged: event(), local: {} } };
  for (const method of ['get', 'set', 'remove']) {
    chrome.storage.local[method] = (value, callback) => queueMicrotask(() => {
      if (failNext) {
        failNext = false;
        chrome.runtime.lastError = { message: 'QUOTA_BYTES exceeded' };
        callback();
        delete chrome.runtime.lastError;
        return;
      }
      if (method === 'get') {
        const keys = value === null ? Object.keys(data) : Array.isArray(value) ? value : [value];
        callback(structuredClone(Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]))));
      } else if (method === 'set') {
        Object.assign(data, structuredClone(value));
        callback();
      } else {
        for (const key of Array.isArray(value) ? value : [value]) delete data[key];
        callback();
      }
    });
  }
  return { chrome, data: () => structuredClone(data), fail: () => { failNext = true; } };
}

function note(id = 'note_1791100000000_aaaa') {
  return { noteId: id, pageUrl: 'https://chatgpt.com/c/example', siteId: 'chatgpt', selectedText: 'selected quote', mainTopic: 'Stereo', mainQuestion: 'main question', noteType: 'general', tags: ['stereo'], marks: [], status: 'visible', position: { x: 20, y: 20 }, messages: [{ role: 'user', content: 'question', status: 'completed', createdAt: '2026-10-04T16:23:00Z' }, { role: 'assistant', content: 'answer', status: 'completed' }], createdAt: '2026-10-04T16:23:00Z', updatedAt: '2026-10-04T16:23:00Z' };
}

function permissionsMock(chrome, initial = []) {
  const origins = new Set(initial);
  const calls = [];
  let grant = true, failure = '', refuseRemoval = false;
  const contains = (origin) => origins.has(origin) || origins.has('<all_urls>') || origins.has('*://*/*') || origins.has(`${origin.split('://')[0]}://*/*`);
  chrome.permissions = { onAdded: event(), onRemoved: event() };
  for (const method of ['request', 'contains', 'getAll', 'remove']) {
    chrome.permissions[method] = (details, callback) => {
      if (method === 'getAll') { callback = details; details = undefined; }
      calls.push({ method, details: details && structuredClone(details) });
      queueMicrotask(() => {
        if (failure) {
          chrome.runtime.lastError = { message: failure }; failure = '';
          callback(); delete chrome.runtime.lastError; return;
        }
        const requested = details?.origins || [];
        if (method === 'getAll') callback({ origins: [...origins], permissions: [] });
        else if (method === 'contains') callback(requested.every(contains));
        else if (method === 'request') {
          if (grant) for (const origin of requested) origins.add(origin);
          callback(grant);
          if (grant) chrome.permissions.onAdded.emit({ origins: requested });
        } else {
          const removed = refuseRemoval ? [] : requested.filter((origin) => origins.delete(origin));
          callback(removed.length > 0);
          if (removed.length) chrome.permissions.onRemoved.emit({ origins: removed });
        }
      });
    };
  }
  return { calls, origins: () => [...origins], deny: () => { grant = false; }, allow: () => { grant = true; }, fail: (message) => { failure = message; }, refuseRemoval: () => { refuseRemoval = true; } };
}

module.exports = { load, event, storageMock, note, permissionsMock };
