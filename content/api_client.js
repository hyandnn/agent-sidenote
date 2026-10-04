(function () {
  function askModelStream(payload, onChunk, options = {}) {
    return new Promise((resolve, reject) => {
      let port;
      let answer = "";
      let settled = false;
      const signal = options.signal;
      const settings = window.CGIAStorage.getSettingsSync();
      let timer;
      const finish = (error, response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) {
          error.partialAnswer = error.partialAnswer || answer;
          reject(error);
        } else resolve(response);
        try { port?.disconnect(); } catch { /* Extension may have been reloaded. */ }
      };
      const abort = () => {
        try { port?.postMessage({ type: "CANCEL" }); } catch { /* Port already closed. */ }
        const error = new Error("请求已停止。");
        error.code = "CANCELLED";
        finish(error);
      };
      try {
        if (!chrome.runtime?.id) throw new Error("扩展上下文已失效，请刷新页面。");
        if (signal?.aborted) return abort();
        port = chrome.runtime.connect({ name: "ask-stream" });
        port.onMessage.addListener((message) => {
          if (message.type === "chunk") {
            answer = message.full || answer;
            try {
              if (typeof onChunk === "function") onChunk(message.delta, answer);
            } catch (error) { finish(error); }
          } else if (message.type === "done") {
            finish(null, { noteId: message.noteId || payload.noteId, answer: message.answer || answer, status: "completed" });
          } else if (message.type === "error") {
            const error = new Error(message.error || "请求失败");
            error.partialAnswer = message.partialAnswer || answer;
            error.code = message.code;
            finish(error);
          }
        });
        port.onDisconnect.addListener(() => {
          finish(new Error(chrome.runtime.lastError?.message || "连接已断开，已保留已收到的内容。"));
        });
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => finish(new Error("扩展请求超时，已保留已收到的内容。")), (settings.requestTimeoutMs || 30000) + 5000);
        port.postMessage({ type: "ASK_STREAM", payload, settings });
      } catch (error) {
        finish(error);
      }
    });
  }
  window.CGIAApiClient = { askModel: (payload) => askModelStream(payload), askModelStream };
})();
