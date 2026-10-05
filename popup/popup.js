const SETTINGS_KEY = "cgia_standalone_settings";

const PROVIDER_PRESETS = {
  deepseek: {
    apiModel: "deepseek-chat",
    apiBaseUrl: "https://api.deepseek.com"
  },
  openai: {
    apiModel: "gpt-4.1-mini",
    apiBaseUrl: "https://api.openai.com"
  }
};

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

let cachedPageUrl = "";

function detectProviderPreset(settings) {
  let hostname;
  try { hostname = new URL(settings.apiBaseUrl).hostname; } catch { return "custom"; }
  if (hostname === "api.deepseek.com") return "deepseek";
  if (hostname === "api.openai.com") return "openai";
  return "custom";
}

function populateDefaultNoteTypeSelect(selected) {
  const sel = document.getElementById("defaultNoteType");
  sel.innerHTML = "";
  window.CGIANoteSchema.NOTE_TYPES.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.value;
    opt.textContent = t.label;
    sel.appendChild(opt);
  });
  sel.value = selected || "general";
}

function loadForm(settings) {
  document.getElementById("mode").value = settings.mode;
  document.getElementById("providerPreset").value = detectProviderPreset(settings);
  document.getElementById("apiKey").value = settings.apiKey || "";
  document.getElementById("apiModel").value = settings.apiModel;
  document.getElementById("apiBaseUrl").value = settings.apiBaseUrl;
  document.getElementById("requestTimeoutMs").value = settings.requestTimeoutMs;
  document.getElementById("maxSelectedTextLength").value = settings.maxSelectedTextLength;
  document.getElementById("surroundingTextMaxLength").value = settings.surroundingTextMaxLength;
  document.getElementById("autoRestoreNotes").checked = settings.autoRestoreNotes;
  document.getElementById("includeFullMessage").checked = settings.includeFullMessage;
  document.getElementById("includeMainConversation").checked = settings.includeMainConversation;
  populateDefaultNoteTypeSelect(settings.defaultNoteType);
  document.getElementById("mdExportDir").value =
    settings.mdExportDir || settings.jsonlRecordDir || "Notes";
}

function readForm() {
  const timeoutVal = parseInt(document.getElementById("requestTimeoutMs").value, 10);
  const maxSelVal = parseInt(document.getElementById("maxSelectedTextLength").value, 10);
  const maxSurrVal = parseInt(document.getElementById("surroundingTextMaxLength").value, 10);

  if (Number.isNaN(timeoutVal) || timeoutVal < 5000) {
    throw new Error("请求超时必须 >= 5000 毫秒");
  }
  if (!Number.isInteger(maxSelVal) || maxSelVal < 2 || !Number.isInteger(maxSurrVal) || maxSurrVal < 0) {
    throw new Error("选中文本上限必须 >= 2，上下文上限必须 >= 0。");
  }

  const mdExportDir = document.getElementById("mdExportDir").value.trim() || "Notes";
  const dirCheck = window.CGIANoteSchema.validateMdExportDir(mdExportDir);
  if (!dirCheck.ok) {
    throw new Error(dirCheck.error);
  }

  return {
    mode: document.getElementById("mode").value,
    apiKey: document.getElementById("apiKey").value.trim(),
    apiModel: document.getElementById("apiModel").value.trim(),
    apiBaseUrl: document.getElementById("apiBaseUrl").value.trim(),
    language: "zh-CN",
    maxSelectedTextLength: maxSelVal,
    surroundingTextMaxLength: maxSurrVal,
    requestTimeoutMs: timeoutVal,
    autoRestoreNotes: document.getElementById("autoRestoreNotes").checked,
    includeFullMessage: document.getElementById("includeFullMessage").checked,
    includeMainConversation: document.getElementById("includeMainConversation").checked,
    fullMessageMaxLength: 4000,
    mainConversationMaxMessages: 6,
    defaultNoteType: document.getElementById("defaultNoteType").value,
    mdExportDir: dirCheck.dir
  };
}

function readExportOptions() {
  return {
    excludeEmpty: document.getElementById("exportExcludeEmpty").checked,
    excludeNoFollowups: document.getElementById("exportExcludeNoFollowups").checked,
    mergeByUrl: document.getElementById("exportMergeByUrl").checked,
    onlyChanged: document.getElementById("exportOnlyChanged").checked
  };
}

function setMessage(el, text, isError = false) {
  el.textContent = text;
  el.style.color = isError ? "#c0392b" : "#2e7d32";
}

function loadAllNotesFromStorage() {
  return window.CGIANoteClient.listNotes();
}

function notesForExportScope(notes, scope) {
  if (scope === "all") return notes;
  return notes.filter((n) => n.pageUrl === cachedPageUrl);
}

async function prepareExport(allNotes) {
  const scope = document.getElementById("exportScope").value;
  const options = readExportOptions();
  const scoped = notesForExportScope(allNotes, scope);
  const settings = await getExportSettings();
  const receipts = await window.CGIANoteClient.getReceipts();
  return { ...window.CGIANoteSchema.prepareMarkdownExport(scoped, options, receipts, settings.mdExportDir), settings };
}

function formatTypeSummary(typeCounts) {
  const labels = window.CGIANoteSchema.NOTE_TYPE_LABELS;
  const entries = Object.entries(typeCounts || {});
  if (!entries.length) return "类型：—";
  const parts = entries.map(([k, v]) => `${labels[k] || k} ${v}`);
  return `类型：${parts.join(" · ")}`;
}

function formatTopicSummary(preview) {
  if (!preview.topics.length) return "主话题：—";
  let text = preview.topics.join("、");
  if (preview.moreTopics > 0) {
    text += ` 等 ${preview.topics.length + preview.moreTopics} 个`;
  }
  return `主话题：${text}`;
}

async function refreshExportPreview() {
  const notes = await loadAllNotesFromStorage();
  const plan = await prepareExport(notes);
  const preview = window.CGIANoteSchema.buildExportPreview(plan.notes);
  preview.mdFiles = plan.files.length;
  preview.mergeGroups = plan.files.filter((file) => file.noteIds.length > 1).length;

  const scopeLabel =
    document.getElementById("exportScope").value === "page" ? "当前页" : "全部";
  const lineInfo =
    preview.mergeGroups
      ? `${preview.count} 条便签 → ${preview.mdFiles} 个 Markdown 文件（${preview.mergeGroups} 组合并）`
      : `${preview.count} 条便签 → ${preview.mdFiles} 个 Markdown 文件`;

  document.getElementById("exportPreviewCount").textContent = `${scopeLabel}：${lineInfo}`;
  document.getElementById("exportPreviewTypes").textContent = formatTypeSummary(
    preview.typeCounts
  );
  document.getElementById("exportPreviewTopics").textContent = formatTopicSummary(preview);
}

async function refreshNoteCount() {
  const notes = await loadAllNotesFromStorage();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    cachedPageUrl = tabs[0]?.url || "";
    const pageCount = notes.filter((n) => n.pageUrl === cachedPageUrl).length;
    const hiddenCount = notes.filter((n) => n.pageUrl === cachedPageUrl && n.status === "hidden").length;
    document.getElementById("noteCount").textContent =
      `便签：共 ${notes.length} 条（当前页 ${pageCount} 条，已关闭 ${hiddenCount} 条）`;
    refreshExportPreview().catch(showExportError);
  });
}

async function getExportSettings() {
  const stored = await new Promise((resolve, reject) => {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve({ ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) });
    });
  });
  const check = window.CGIANoteSchema.validateMdExportDir(document.getElementById("mdExportDir").value.trim() || "Notes");
  if (!check.ok) throw new Error(check.error);
  return { ...stored, mdExportDir: check.dir };
}

function showExportError(error) {
  setMessage(document.getElementById("exportMsg"), error.message, true);
}

async function exportPreparedNotes(plan) {
  const { files, notes } = plan;
  if (!files.length) {
    throw new Error("没有可导出的便签。");
  }

  await window.CGIAExport.downloadMarkdown(files, plan.settings);
  return { noteCount: notes.length, fileCount: files.length };
}

function bindExportPreviewListeners() {
  [
    "exportScope",
    "exportExcludeEmpty",
    "exportExcludeNoFollowups",
    "exportMergeByUrl",
    "exportOnlyChanged"
  ].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      refreshExportPreview().catch(showExportError);
    });
  });
}

document.getElementById("providerPreset").addEventListener("change", (e) => {
  const preset = PROVIDER_PRESETS[e.target.value];
  if (!preset) return;
  document.getElementById("apiModel").value = preset.apiModel;
  document.getElementById("apiBaseUrl").value = preset.apiBaseUrl;
});

chrome.storage.local.get(SETTINGS_KEY, (result) => {
  if (chrome.runtime.lastError) { showExportError(new Error(chrome.runtime.lastError.message)); return; }
  const settings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  loadForm(settings);
  refreshApiAccessStatus();
  refreshNoteCount().catch(showExportError);
  bindExportPreviewListeners();
});

let apiActionBusy = false;
let accessStatusVersion = 0;

function setApiActionBusy(busy) {
  apiActionBusy = busy;
  for (const id of ["saveBtn", "testBtn", "revokeApiBtn"]) document.getElementById(id).disabled = busy;
}

function validateApiSettings(settings) {
  if (settings.mode !== "api") return;
  if (!settings.apiKey) throw new Error("API 模式下请填写 API Key。");
  if (!settings.apiModel) throw new Error("请填写模型名称。");
  if (!settings.apiBaseUrl) throw new Error("请填写 API 地址。");
  window.CGIAApiPermissions.getEndpoint(settings.apiBaseUrl);
}

async function refreshApiAccessStatus() {
  const version = ++accessStatusVersion;
  const status = document.getElementById("apiAccessStatus");
  const revoke = document.getElementById("revokeApiBtn");
  const baseUrl = document.getElementById("apiBaseUrl").value.trim();
  try {
    if (!baseUrl) throw new Error("请填写 API 地址。");
    const endpoint = window.CGIAApiPermissions.getEndpoint(baseUrl);
    const granted = await window.CGIAApiPermissions.hasAccess(baseUrl);
    if (version !== accessStatusVersion) return;
    status.textContent = `${endpoint.origin}：${granted ? "已授权" : "未授权"}`;
    revoke.disabled = apiActionBusy || !granted;
  } catch (error) {
    if (version !== accessStatusVersion) return;
    status.textContent = error.message;
    revoke.disabled = true;
  }
}

function storeSettings(settings) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function testConnection(settings) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "TEST_CONNECTION", settings }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (response?.error) reject(new Error(response.error));
      else if (!response?.ok) reject(new Error("测试连接未收到有效响应。"));
      else resolve(response.message);
    });
  });
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  if (apiActionBusy) return;
  const msg = document.getElementById("saveMsg");
  try {
    const settings = readForm();
    validateApiSettings(settings);
    setApiActionBusy(true);
    // requestAccess must be the first asynchronous operation in this gesture.
    if (settings.mode === "api") await window.CGIAApiPermissions.requestAccess(settings.apiBaseUrl);
    await storeSettings(settings);
    try {
      await window.CGIAApiPermissions.retainOnlyApiAccess(settings);
      setMessage(msg, "设置已保存。");
    } catch (error) {
      setMessage(msg, `设置已保存，但旧 API 授权清理失败：${error.message}`, true);
    }
  } catch (error) {
    setMessage(msg, error.message, true);
  } finally {
    setApiActionBusy(false);
    await refreshApiAccessStatus();
  }
});

document.getElementById("testBtn").addEventListener("click", async () => {
  if (apiActionBusy) return;
  const msg = document.getElementById("testMsg");
  try {
    const settings = readForm();
    if (settings.mode === "mock") {
      setMessage(msg, "Mock 模式无需测试。");
      return;
    }
    validateApiSettings(settings);
    setApiActionBusy(true);
    const access = window.CGIAApiPermissions.requestAccess(settings.apiBaseUrl);
    setMessage(msg, "授权并测试中…");
    await access;
    setMessage(msg, await testConnection(settings));
  } catch (error) {
    setMessage(msg, error.message, true);
  } finally {
    setApiActionBusy(false);
    await refreshApiAccessStatus();
  }
});

document.getElementById("revokeApiBtn").addEventListener("click", async () => {
  if (apiActionBusy) return;
  const msg = document.getElementById("testMsg");
  try {
    setApiActionBusy(true);
    await window.CGIAApiPermissions.revokeAccess(document.getElementById("apiBaseUrl").value.trim());
    setMessage(msg, "API 授权已撤销；再次使用时请测试连接或保存设置。");
  } catch (error) {
    setMessage(msg, error.message, true);
  } finally {
    setApiActionBusy(false);
    await refreshApiAccessStatus();
  }
});

for (const id of ["apiBaseUrl", "providerPreset", "mode"]) {
  document.getElementById(id).addEventListener(id === "apiBaseUrl" ? "input" : "change", () => refreshApiAccessStatus());
}
chrome.permissions.onAdded.addListener(() => refreshApiAccessStatus());
chrome.permissions.onRemoved.addListener(() => refreshApiAccessStatus());
setApiActionBusy(true);
window.CGIAApiPermissions.removeBroadAccess().catch((error) => {
  setMessage(document.getElementById("testMsg"), `旧权限清理失败：${error.message}`, true);
}).finally(() => {
  setApiActionBusy(false);
  refreshApiAccessStatus();
});

document.getElementById("exportMdBtn").addEventListener("click", async () => {
  const msg = document.getElementById("exportMsg");
  const btn = document.getElementById("exportMdBtn");
  try {
    btn.disabled = true;
    const allNotes = await loadAllNotesFromStorage();
    const plan = await prepareExport(allNotes);
    if (!plan.files.length) {
      throw new Error("没有符合条件的便签（可取消「仅导出变更条目」试试）。");
    }
    const { noteCount, fileCount } = await exportPreparedNotes(plan);
    const scope =
      document.getElementById("exportScope").value === "page" ? "当前页" : "全部";
    setMessage(
      msg,
      `已导出 ${scope} ${noteCount} 条便签（${fileCount} 个 Markdown 文件）。`
    );
    refreshExportPreview().catch(showExportError);
  } catch (e) {
    setMessage(msg, e.message, true);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("mdExportDir").addEventListener("change", () => refreshExportPreview().catch(showExportError));
document.getElementById("restoreNotesBtn").addEventListener("click", async () => {
  const button = document.getElementById("restoreNotesBtn");
  button.disabled = true;
  try {
    const count = await window.CGIANoteClient.restoreNotes(cachedPageUrl);
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id && tabs[0].url === cachedPageUrl) {
      try {
        await chrome.tabs.sendMessage(tabs[0].id, { type: "RESTORE_NOTES" });
      } catch {
        setMessage(document.getElementById("exportMsg"), `已恢复 ${count} 条便签；请刷新当前页面。`);
        await refreshNoteCount();
        return;
      }
    }
    setMessage(document.getElementById("exportMsg"), `已恢复 ${count} 条便签。`);
    await refreshNoteCount();
  } catch (error) {
    showExportError(error);
  } finally {
    button.disabled = false;
  }
});
