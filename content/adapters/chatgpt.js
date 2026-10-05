(function () {
  const { truncateAroundSelection, truncateSimple, readMessageText, canonicalMessageNodes, findSelectedMessage } =
    window.CGIAAdapterShared;

  function match(hostname) {
    return hostname === "chatgpt.com" || hostname === "chat.openai.com";
  }

  function getMessageElement(selection) {
    try {
      return findSelectedMessage(selection, getAllMessages());
    } catch (e) {
      return null;
    }
  }

  function getAllMessages() {
    const root = document.querySelector("main") || document.body;
    return canonicalMessageNodes(Array.from(root.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')))
      .filter((el) => extractMessageText(el));
  }

  function getRole(messageEl) {
    return messageEl.getAttribute("data-message-author-role") === "user"
      ? "user"
      : "assistant";
  }

  function extractMessageText(messageEl) {
    return readMessageText(messageEl.querySelector('.markdown, [data-testid="user-message"]') || messageEl);
  }

  function getMessageText(messageEl, selectedText, maxLength) {
    return truncateAroundSelection(extractMessageText(messageEl), selectedText, maxLength);
  }

  function getMainConversation(messageEl, maxMessages, perMessageMax) {
    try {
      const all = getAllMessages();
      if (all.length === 0) return [];

      let endIdx = messageEl ? all.indexOf(messageEl) : all.length;
      if (endIdx === -1) endIdx = all.findIndex((el) => el.contains(messageEl));
      if (endIdx === -1) return [];

      return all
        .slice(Math.max(0, endIdx - maxMessages), endIdx)
        .map((el) => ({
          role: getRole(el),
          content: truncateSimple(extractMessageText(el), perMessageMax)
        }))
        .filter((m) => m.content);
    } catch (e) {
      return [];
    }
  }

  function shouldIgnoreElement(el) {
    return window.CGIAAdapterShared.shouldIgnoreElement(el);
  }

  function getConversationTitle() {
    const title = document.title.replace(/\s*[-–—]\s*ChatGPT\s*$/i, "").trim();
    if (title && !/^chatgpt$/i.test(title) && !/^new chat$/i.test(title)) {
      return title;
    }

    const active = document.querySelector(
      'nav a[aria-current="page"], [data-testid="conversation-title"]'
    );
    if (active) {
      const text = (active.innerText || active.textContent || "").trim();
      if (text) return text;
    }

    return "";
  }

  window.CGIAAdapters.register({
    id: "chatgpt",
    name: "ChatGPT",
    match,
    getMessageElement,
    getAllMessages,
    getRole,
    getMessageText,
    getMainConversation,
    getConversationTitle,
    shouldIgnoreElement
  });
})();
