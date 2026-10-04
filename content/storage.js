(function () {
  const SETTINGS_KEY = "cgia_standalone_settings";

  const DEFAULT_SETTINGS = {
    mode: "mock",
    apiKey: "",
    apiModel: "deepseek-chat",
    apiBaseUrl: "https://api.deepseek.com",
    language: "zh-CN",
    maxSelectedTextLength: 3000,
    surroundingTextMaxLength: 1200,
    requestTimeoutMs: 30000,
    autoRestoreNotes: true,
    includeFullMessage: true,
    includeMainConversation: true,
    fullMessageMaxLength: 4000,
    mainConversationMaxMessages: 6,
    defaultNoteType: "general",
    mdExportDir: "Notes"
  };

  let cachedSettings = { ...DEFAULT_SETTINGS };

  function isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function safeGet(key) {
    return new Promise((resolve, reject) => {
      if (!isContextValid()) return reject(new Error("扩展上下文已失效，请刷新页面。"));
      try {
        chrome.storage.local.get(key, (result) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(result);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function safeSet(obj) {
    return new Promise((resolve, reject) => {
      if (!isContextValid()) return reject(new Error("扩展上下文已失效，请刷新页面。"));
      try {
        chrome.storage.local.set(obj, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[SETTINGS_KEY]) {
        cachedSettings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) };
      }
    });
  } catch (e) {
    // ignore
  }

  async function loadSettings() {
    const result = await safeGet(SETTINGS_KEY);
    if (result) {
      cachedSettings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
    }
    return { ...cachedSettings };
  }

  async function saveSettings(settings) {
    cachedSettings = { ...DEFAULT_SETTINGS, ...settings };
    await safeSet({ [SETTINGS_KEY]: cachedSettings });
  }

  function getSettingsSync() {
    return { ...cachedSettings };
  }

  async function loadNotesForPage(pageUrl) {
    return window.CGIANoteClient.listNotes(pageUrl);
  }

  async function loadAllNotes() {
    return window.CGIANoteClient.listNotes();
  }

  async function countNotes(filter = {}) {
    const notes = await loadAllNotes();
    return notes.filter((n) => {
      if (filter.pageUrl && n.pageUrl !== filter.pageUrl) return false;
      if (filter.excludeHidden && n.status === "hidden") return false;
      return true;
    }).length;
  }

  async function saveNote(note) {
    return window.CGIANoteClient.saveNote(note);
  }

  window.CGIAStorage = {
    loadSettings,
    saveSettings,
    getSettingsSync,
    loadNotesForPage,
    loadAllNotes,
    countNotes,
    saveNote
  };
})();
