(function () {
  const LEGACY_KEY = "cgia_standalone_notes";
  const MIGRATION_KEY = "cgia_notes_migrated_v2";
  const NOTE_PREFIX = "cgia_note:";
  const RECEIPT_PREFIX = "cgia_export:";
  let queue = Promise.resolve();

  function storageCall(method, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local[method](value, (result) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(`笔记存储失败：${error.message}`));
        else resolve(result);
      });
    });
  }

  async function migrate() {
    const data = await storageCall("get", [LEGACY_KEY, MIGRATION_KEY]);
    if (data[MIGRATION_KEY]) return;
    const legacy = data[LEGACY_KEY] || {};
    // Migrate one record at a time so a failed migration can resume safely.
    for (const note of Object.values(legacy)) {
      if (!note?.noteId) continue;
      const key = NOTE_PREFIX + note.noteId;
      const existing = await storageCall("get", key);
      if (!existing[key]) {
        await storageCall("set", { [key]: { ...CGIANoteSchema.normalizeNote(note), revision: 1 } });
      }
    }
    await storageCall("set", { [MIGRATION_KEY]: true });
    // The old collection is removed only after all records were written.
    await storageCall("remove", LEGACY_KEY);
  }

  function serialized(task) {
    const result = queue.then(async () => {
      await migrate();
      return task();
    });
    queue = result.catch(() => {});
    return result;
  }

  function listNotes(pageUrl) {
    return serialized(async () => {
      const all = await storageCall("get", null);
      return Object.entries(all)
        .filter(([key]) => key.startsWith(NOTE_PREFIX))
        .map(([, note]) => CGIANoteSchema.normalizeNote(note))
        .filter((note) => !pageUrl || note.pageUrl === pageUrl);
    });
  }

  function saveNote(note) {
    return serialized(async () => {
      if (!note?.noteId || !Array.isArray(note.messages)) throw new Error("笔记格式无效。");
      const key = NOTE_PREFIX + note.noteId;
      const data = await storageCall("get", key);
      const current = data[key];
      if ((current?.revision || 0) !== (note.revision || 0)) {
        throw new Error("这条笔记已在其他窗口更新，请刷新页面后重试；本次内容尚未保存。");
      }
      const saved = { ...CGIANoteSchema.normalizeNote(note), revision: (current?.revision || 0) + 1 };
      delete saved.lastExportedContentHash;
      await storageCall("set", { [key]: saved });
      return saved;
    });
  }

  function restoreNotes(pageUrl) {
    return serialized(async () => {
      const all = await storageCall("get", null);
      const updates = {};
      for (const [key, note] of Object.entries(all)) {
        if (!key.startsWith(NOTE_PREFIX) || note.pageUrl !== pageUrl || note.status !== "hidden") continue;
        updates[key] = { ...note, status: "visible", revision: (note.revision || 0) + 1 };
      }
      if (Object.keys(updates).length) await storageCall("set", updates);
      return Object.keys(updates).length;
    });
  }

  function getReceipts() {
    return serialized(async () => {
      const all = await storageCall("get", null);
      return Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(RECEIPT_PREFIX)));
    });
  }

  function markExported(receiptKey, contentHash) {
    return serialized(() => {
      if (!receiptKey?.startsWith(RECEIPT_PREFIX) || !contentHash) throw new Error("导出记录无效。");
      return storageCall("set", { [receiptKey]: contentHash });
    });
  }

  globalThis.CGIANoteStore = { listNotes, saveNote, restoreNotes, getReceipts, markExported };
})();
