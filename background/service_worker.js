importScripts(
  "../shared/note_schema.js",
  "../shared/api_permissions.js",
  "note_store.js",
  "prompt_builder.js",
  "llm_client.js",
  "stream_mock.js",
  "export_helper.js"
);

chrome.runtime.onInstalled.addListener(() => {
  CGIAApiPermissions.removeBroadAccess().catch((error) => console.error("Agent Sidenote permission migration failed:", error.message));
});

const SETTINGS_KEY = "cgia_standalone_settings";

const DEFAULT_SETTINGS = {
  mode: "mock",
  apiKey: "",
  apiModel: "deepseek-chat",
  apiBaseUrl: "https://api.deepseek.com",
  requestTimeoutMs: 30000,
  mdExportDir: "Notes"
};

async function loadSettings(override) {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const base = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
  if (override && Object.keys(override).length > 0) {
    return { ...base, ...override };
  }
  return base;
}

function mockAnswer(req) {
  const historySummary = req.conversationHistory?.length
    ? `（本次携带 ${req.conversationHistory.length} 条历史）`
    : "";

  return (
    `这是 mock 回答。${historySummary}\n\n` +
    `你选中的内容是：${req.selectedText.slice(0, 120)}\n\n` +
    `你的问题是：${req.userQuestion}\n\n` +
    "请在扩展设置中切换到 API 模式并填写 API Key 后即可调用真实模型。"
  );
}

async function streamAsk(payload, settingsOverride, emit, signal) {
  if (!payload.userQuestion?.trim()) {
    throw new Error("问题不能为空。");
  }
  if (!payload.selectedText?.trim()) {
    throw new Error("选中文本不能为空。");
  }

  const settings = await loadSettings(settingsOverride);

  if (settings.mode === "mock") {
    const answer = mockAnswer(payload);
    await simulateStream(answer, (delta, full) => emit({ type: "chunk", delta, full }), 4, 18, signal);
    return answer;
  }

  const prompt = buildPrompt({
    ...payload,
    fullMessageText: settings.includeFullMessage === false ? "" : payload.fullMessageText,
    mainConversation: settings.includeMainConversation === false ? [] : payload.mainConversation
  });
  return askModelStream(prompt, settings, (delta, full) => emit({ type: "chunk", delta, full }), signal);
}

async function handleAsk(payload, settingsOverride) {
  let answer = "";
  await streamAsk(payload, settingsOverride, (msg) => {
    if (msg.type === "chunk") answer = msg.full;
  });
  return {
    noteId: payload.noteId,
    answer,
    status: "completed"
  };
}

async function handleTestConnection(settingsOverride) {
  const settings = await loadSettings(settingsOverride);

  if (settings.mode === "mock") {
    return { ok: true, message: "当前为 Mock 模式，无需测试 API。" };
  }

  const answer = await askModel("请只回复：连接成功", settings);
  const preview = (answer || "").slice(0, 80);

  return {
    ok: true,
    message: `连接成功。模型回复：${preview}`
  };
}

function resolveMdExportDir(settings) {
  return settings.mdExportDir || settings.jsonlRecordDir || "Notes";
}

async function handleDownloadMd(files, settingsOverride) {
  if (!files?.length) {
    throw new Error("没有可导出的记录。");
  }
  const settings = await loadSettings(settingsOverride);
  const exportDir = resolveMdExportDir(settings);
  const filenames = [];

  try {
    for (const file of files) {
      if (!file?.content || !file?.filename) throw new Error("导出文件格式无效。");
      await downloadMarkdownContent(file.content, file.filename, exportDir);
      if (file.receiptKey && file.contentHash) await CGIANoteStore.markExported(file.receiptKey, file.contentHash);
      filenames.push(file.filename);
    }
  } catch (error) {
    throw new Error(`已完成 ${filenames.length}/${files.length} 个文件。${error.message}`);
  }

  return { filenames, count: filenames.length };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ask-stream") return;
  let controller;
  let started = false;
  const emit = (message) => {
    try { port.postMessage(message); } catch { controller?.abort(); }
  };
  port.onDisconnect.addListener(() => controller?.abort());

  port.onMessage.addListener((message) => {
    if (message.type === "CANCEL") { controller?.abort(); return; }
    if (message.type !== "ASK_STREAM") return;
    if (started) return;
    started = true;
    controller = new AbortController();

    (async () => {
      try {
        const answer = await streamAsk(message.payload, message.settings, emit, controller.signal);
        emit({
          type: "done",
          noteId: message.payload.noteId,
          answer,
          status: "completed"
        });
      } catch (err) {
        emit({ type: "error", error: err.message || String(err), partialAnswer: err.partialAnswer, code: err.code || (controller.signal.aborted ? "CANCELLED" : "REQUEST_FAILED") });
      }
    })();
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const storeActions = {
    NOTES_LIST: async () => ({ notes: await CGIANoteStore.listNotes(message.pageUrl) }),
    NOTE_SAVE: async () => ({ note: await CGIANoteStore.saveNote(message.note) }),
    NOTES_RESTORE: async () => ({ count: await CGIANoteStore.restoreNotes(message.pageUrl) }),
    EXPORT_RECEIPTS: async () => ({ receipts: await CGIANoteStore.getReceipts() })
  };
  if (Object.hasOwn(storeActions, message.type)) {
    storeActions[message.type]().then(sendResponse).catch((error) => sendResponse({ error: error.message || String(error) }));
    return true;
  }
  if (message.type === "ASK") {
    handleAsk(message.payload, message.settings)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "TEST_CONNECTION") {
    handleTestConnection(message.settings)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  if (message.type === "DOWNLOAD_MD") {
    handleDownloadMd(message.files, message.settings)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }

  return false;
});
