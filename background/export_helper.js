function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function makeMarkdownDataUrl(content) {
  const bytes = new TextEncoder().encode(content || "");
  const b64 = uint8ToBase64(bytes);
  return `data:text/markdown;charset=utf-8;base64,${b64}`;
}

function normalizeExportDir(exportDir) {
  const raw = (exportDir || "Notes").trim();
  if (raw.includes("..")) {
    throw new Error(
      "保存路径不能包含 ..。若要写入 ~/Note/00_Inbox，请用符号链接：ln -s ~/Note/00_Inbox ~/Downloads/Note/00_Inbox，然后填写 Note/00_Inbox。"
    );
  }
  if (/^[\\/]|^[A-Za-z]:/.test(raw)) {
    throw new Error("保存路径必须是相对 Chrome 下载目录的子路径。");
  }
  return raw.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/") || "Notes";
}

const pendingDownloads = new Map();

function checkDownloadState(item) {
  const pending = pendingDownloads.get(item.id);
  if (!pending) return;
  const state = typeof item.state === "object" ? item.state.current : item.state;
  if (state === "complete") pending.finish();
  else if (state === "interrupted") pending.finish(new Error("文件下载失败或已取消，请重新导出。"));
}

chrome.downloads.onChanged.addListener(checkDownloadState);

function downloadMarkdownContent(content, filename, exportDir) {
  if (typeof filename !== "string" || /[\\/]/.test(filename) || filename.includes("..")) {
    return Promise.reject(new Error("导出文件名无效。"));
  }
  const dir = normalizeExportDir(exportDir);
  const hasBlobUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
  const url = hasBlobUrl
    ? URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }))
    : makeMarkdownDataUrl(content);
  const path = dir ? `${dir}/${filename}` : filename;

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename: path,
        saveAs: false,
        conflictAction: "uniquify"
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          if (hasBlobUrl) URL.revokeObjectURL(url);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        let timer;
        const finish = (error) => {
          if (!pendingDownloads.has(downloadId)) return;
          pendingDownloads.delete(downloadId);
          clearTimeout(timer);
          if (hasBlobUrl) URL.revokeObjectURL(url);
          if (error) reject(error);
          else resolve(downloadId);
        };
        pendingDownloads.set(downloadId, { finish });
        timer = setTimeout(() => finish(new Error("尚未确认文件下载完成，请检查 Chrome 下载列表后重试。")), 120000);
        // Search also handles completion before the download callback arrived.
        chrome.downloads.search({ id: downloadId }, (items) => {
          if (chrome.runtime.lastError) return finish(new Error(chrome.runtime.lastError.message));
          if (!items?.length) return finish(new Error("下载记录不存在，请重新导出。"));
          checkDownloadState(items[0]);
        });
      }
    );
  });
}
