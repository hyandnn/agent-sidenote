(function () {
  const { truncateAroundSelection, truncateSimple, sortByDocumentOrder, readMessageText, canonicalMessageNodes, findSelectedMessage } =
    window.CGIAAdapterShared;

  const MESSAGE_LIST_SELECTORS = [
    '[data-testid="message-list"]',
    '[class*="message-list"]',
    '[class*="chat-scroll"]',
    '[data-table-spillover="true"][data-table-spillover-force-disable="true"]',
    ".scroll-view-OEiNXD",
    "main"
  ];

  const ASSISTANT_BUBBLE_SELECTORS = [
    '[class*="bg-g-receive-msg-bubble"]',
    '[class*="receive-msg-bubble"]',
    '[class*="assistant-message"]',
    '[data-message-author="assistant"]'
  ];

  const USER_BUBBLE_SELECTORS = [
    '[class*="bg-g-send-msg-bubble"]',
    '[class*="send-msg-bubble"]',
    '[class*="user-message"]',
    '[data-message-author="user"]'
  ];

  function match(hostname) {
    return hostname === "www.doubao.com" || hostname === "doubao.com";
  }

  function getMessageListRoot() {
    for (const selector of MESSAGE_LIST_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && el !== document.body) return el;
    }
    return document.body;
  }

  function getRole(messageEl) {
    if (messageEl.classList.contains("justify-end")) return "user";
    if (messageEl.matches(USER_BUBBLE_SELECTORS.join(", "))) {
      return "user";
    }
    if (messageEl.matches('[class*="bg-g-receive-msg-bubble"], [class*="receive-msg-bubble"]')) {
      return "assistant";
    }
    const author = messageEl.getAttribute("data-message-author");
    if (author === "user" || author === "assistant") return author;
    if (messageEl.querySelector(USER_BUBBLE_SELECTORS.join(", "))) return "user";
    if (messageEl.hasAttribute("data-message-id")) {
      return messageEl.classList.contains("justify-end") ? "user" : "assistant";
    }
    if (messageEl.querySelector(".flow-markdown-body")) return "assistant";
    return "assistant";
  }

  function extractMessageText(messageEl) {
    const markdown = messageEl.querySelector(".flow-markdown-body, [class*='markdown-body']");
    if (markdown) return readMessageText(markdown);
    const userText = messageEl.querySelector(
      ".whitespace-pre-wrap.wrap-anywhere:not(.gh-user-query-markdown), [class*='user-query']"
    );
    if (userText) return readMessageText(userText);
    return readMessageText(messageEl, '[class*="message-actions"], [data-testid="message-actions"], [class*="message-disclaimer"]');
  }

  function collectBubbleNodes(root) {
    const nodes = [];
    for (const sel of [...ASSISTANT_BUBBLE_SELECTORS, ...USER_BUBBLE_SELECTORS]) {
      nodes.push(...root.querySelectorAll(sel));
    }
    return sortByDocumentOrder(nodes);
  }

  function getAllMessages() {
    const root = getMessageListRoot();
    let nodes = [...root.querySelectorAll("[data-message-id]"), ...collectBubbleNodes(root)];

    if (nodes.length === 0) {
      nodes = Array.from(root.querySelectorAll(".flow-markdown-body"))
        .map((md) => md.closest("[data-message-id]") || md.closest("div[class*='msg']") || md.parentElement)
        .filter(Boolean);
    }

    const seen = new Set();
    const unique = [];

    for (const el of canonicalMessageNodes(nodes)) {
      const key = el.getAttribute("data-message-id") || el;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!extractMessageText(el)) continue;
      unique.push(el);
    }

    return sortByDocumentOrder(unique);
  }

  function getMessageElement(selection) {
    try {
      return findSelectedMessage(selection, getAllMessages());
    } catch (e) {
      return null;
    }
  }

  function getMessageText(messageEl, selectedText, maxLength) {
    return truncateAroundSelection(
      extractMessageText(messageEl),
      selectedText,
      maxLength
    );
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
    if (window.CGIAAdapterShared.shouldIgnoreElement(el)) return true;
    if (el.closest("#flow_chat_sidebar")) return true;
    if (el.closest('[data-testid="chat_input"]')) return true;
    if (el.closest('[class*="chat-input"]')) return true;
    if (el.closest('[class*="input"]')?.closest("footer")) return true;
    if (el.closest("textarea")) return true;
    return false;
  }

  function getConversationTitle() {
    const titleSelectors = [
      '#flow_chat_sidebar a[id^="conversation_"][aria-current="page"]',
      "#flow_chat_sidebar a.active",
      '[class*="conversation-title"]',
      '[class*="chat-title"]',
      "header h1",
      "header [class*='title']"
    ];

    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const titleEl = el.querySelector('[class*="title"], [class*="overallTitle"]');
      const text = ((titleEl || el).innerText || (titleEl || el).textContent || "").trim();
      if (text && text !== "豆包") return text;
    }

    const title = document.title.replace(/\s*[-–—]\s*豆包.*$/i, "").trim();
    if (title && title !== "豆包") return title;

    return "";
  }

  window.CGIAAdapters.register({
    id: "doubao",
    name: "豆包",
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
