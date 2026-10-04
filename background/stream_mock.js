async function simulateStream(text, onChunk, chunkSize = 4, delayMs = 18, signal) {
  let full = "";
  for (let i = 0; i < text.length; i += chunkSize) {
    if (signal?.aborted) throw new DOMException("请求已停止。", "AbortError");
    const delta = text.slice(i, i + chunkSize);
    full += delta;
    onChunk(delta, full);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return full;
}
