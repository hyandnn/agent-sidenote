(function () {
  const queues = new Map();

  function send(message) {
    return new Promise((resolve, reject) => {
      try {
        if (!chrome.runtime?.id) throw new Error("扩展上下文已失效，请刷新页面。");
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) return reject(new Error(error.message));
          if (!response) return reject(new Error("扩展未返回响应，请刷新页面后重试。"));
          if (response.error) return reject(new Error(response.error));
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function saveNote(note) {
    const previous = queues.get(note.noteId) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const { note: saved } = await send({ type: "NOTE_SAVE", note: JSON.parse(JSON.stringify(note)) });
      note.revision = saved.revision;
      return saved;
    });
    queues.set(note.noteId, operation);
    operation.finally(() => {
      if (queues.get(note.noteId) === operation) queues.delete(note.noteId);
    }).catch(() => {});
    return operation;
  }

  globalThis.CGIANoteClient = {
    send,
    saveNote,
    listNotes: async (pageUrl) => (await send({ type: "NOTES_LIST", pageUrl })).notes,
    restoreNotes: async (pageUrl) => (await send({ type: "NOTES_RESTORE", pageUrl })).count,
    getReceipts: async () => (await send({ type: "EXPORT_RECEIPTS" })).receipts
  };
})();
