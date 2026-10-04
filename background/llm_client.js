function getChatCompletionsUrl(baseUrl) {
  const base = (baseUrl || "https://api.openai.com").trim().replace(/\/+$/, "");
  const parsed = new URL(base);
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("API 地址必须使用 HTTP 或 HTTPS。");
  if (base.endsWith("/chat/completions")) return base;
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function extractErrorMessage(bodyText) {
  try {
    const data = JSON.parse(bodyText);
    if (data.error?.message) return data.error.message;
    if (data.detail) return String(data.detail);
  } catch {
    // Keep a short text error for non-JSON responses.
  }
  return bodyText.slice(0, 200) || "未知错误";
}

function buildRequestBody(model, prompt, stream) {
  return { model, messages: [{ role: "user", content: prompt }], max_tokens: 1024, stream: !!stream };
}

async function askModel(prompt, settings) {
  return askModelStream(prompt, settings, () => {});
}

async function askModelStream(prompt, settings, onChunk, signal) {
  const apiKey = (settings.apiKey || "").trim();
  if (!apiKey) throw new Error("请先在扩展设置中填写 API Key。");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, settings.requestTimeoutMs ?? 30000);
  let full = "";
  let reader;
  let completed = false;
  let finishReason = "";
  let dataLines = [];

  function dispatchEvent() {
    if (!dataLines.length) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data.trim() === "[DONE]") { completed = true; return; }
    let parsed;
    try { parsed = JSON.parse(data); }
    catch { throw new Error("模型 API 返回了无法解析的流式数据。"); }
    if (parsed.error) throw new Error(parsed.error.message || String(parsed.error));
    const choice = parsed.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === "string" && delta) {
      full += delta;
      onChunk(delta, full);
    }
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
      if (finishReason !== "stop") {
        throw new Error(finishReason === "length" ? "回答达到长度上限，已保留部分内容。" : `回答未完整生成（${finishReason}）。`);
      }
    }
  }

  function processLine(line) {
    const text = line.replace(/\r$/, "");
    if (!text) return dispatchEvent();
    if (text.startsWith("data:")) dataLines.push(text.slice(5).replace(/^ /, ""));
  }

  try {
    const response = await fetch(getChatCompletionsUrl(settings.apiBaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildRequestBody((settings.apiModel || "deepseek-chat").trim(), prompt, true)),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`模型 API 返回 ${response.status}：${extractErrorMessage(await response.text())}`);
    if (!response.body) throw new Error("模型 API 未返回可流式读取的响应。");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!completed) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
        if (completed) break;
      }
      if (done) {
        if (buffer) processLine(buffer);
        dispatchEvent();
        break;
      }
    }
    if (!full) throw new Error("模型 API 未返回有效回答。");
    if (!completed && finishReason !== "stop") throw new Error("回答流提前结束，已保留部分内容。");
    return full;
  } catch (original) {
    const error = original.name === "AbortError"
      ? new Error(timedOut ? "请求超时，已保留已收到的内容。" : "请求已停止。")
      : original;
    error.code = signal?.aborted ? "CANCELLED" : "REQUEST_FAILED";
    error.partialAnswer = full;
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
    if (reader) {
      try { await reader.cancel(); } catch { /* The stream may already be closed. */ }
      reader.releaseLock();
    }
  }
}
