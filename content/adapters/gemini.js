(function () {
  const { truncateAroundSelection, truncateSimple, sortByDocumentOrder, readMessageText, canonicalMessageNodes, findSelectedMessage } =
    window.CGIAAdapterShared;

  const THOUGHTS_ANCESTOR = "model-thoughts, .thoughts-container, .thoughts-content";

  const MESSAGE_LIST_SELECTORS = [
    "infinite-scroller",
    "main",
    ".conversation-container",
    '[class*="conversation-container"]'
  ];

  const USER_MESSAGE_SELECTORS = [
    "user-query",
    ".user-query",
    '[data-message-author="user"]',
    ".conversation-turn-user"
  ];

  const ASSISTANT_MESSAGE_SELECTORS = [
    "model-response",
    ".model-response",
    '[data-message-author="assistant"]',
    ".conversation-turn-model"
  ];

  function match(hostname) {
    return hostname === "gemini.google.com";
  }

  function getMessageListRoot() {
    for (const selector of MESSAGE_LIST_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && el !== document.body) return el;
    }
    return document.body;
  }

  function queryOutsideThoughts(root, selector) {
    if (!root) return null;
    const candidates = root.querySelectorAll(selector);
    for (const el of candidates) {
      if (!el.closest(THOUGHTS_ANCESTOR)) return el;
    }
    return null;
  }

  function isThoughtsOnly(el) {
    return !!el.closest(THOUGHTS_ANCESTOR);
  }

  function getRole(messageEl) {
    const tag = messageEl.tagName.toLowerCase();
    if (tag === "user-query") return "user";
    if (tag === "model-response") return "assistant";

    const author = messageEl.getAttribute("data-message-author");
    if (author === "user" || author === "assistant") return author;

    if (
      messageEl.matches(
        'user-query, .user-query, .query-text, .conversation-turn-user, [data-message-author="user"]'
      )
    ) {
      return "user";
    }

    return "assistant";
  }

  function extractMessageText(messageEl) {
    if (getRole(messageEl) === "user") {
      const content =
        messageEl.querySelector(".query-text, .user-query-content") || messageEl;
      return readMessageText(content, THOUGHTS_ANCESTOR);
    }

    if (getRole(messageEl) === "assistant") {
      const content =
        queryOutsideThoughts(messageEl, "message-content") ||
        queryOutsideThoughts(messageEl, ".model-response-text") ||
        queryOutsideThoughts(messageEl, ".response-content") ||
        queryOutsideThoughts(messageEl, ".markdown-main-panel") ||
        queryOutsideThoughts(messageEl, ".markdown");
      if (content) return readMessageText(content, THOUGHTS_ANCESTOR);
    }

    return readMessageText(messageEl, THOUGHTS_ANCESTOR);
  }

  function collectMessageNodes(root) {
    const nodes = [];

    for (const sel of USER_MESSAGE_SELECTORS) {
      nodes.push(...root.querySelectorAll(sel));
    }
    for (const sel of ASSISTANT_MESSAGE_SELECTORS) {
      nodes.push(...root.querySelectorAll(sel));
    }

    if (nodes.length === 0) {
      root.querySelectorAll("ms-chat-turn, .chat-turn-container").forEach((turn) => {
        for (const sel of [...USER_MESSAGE_SELECTORS, ...ASSISTANT_MESSAGE_SELECTORS]) {
          const el = turn.querySelector(sel);
          if (el) nodes.push(el);
        }
      });
    }

    return sortByDocumentOrder(nodes);
  }

  function getAllMessages() {
    const root = getMessageListRoot();
    const seen = new Set();
    const unique = [];

    for (const el of canonicalMessageNodes(collectMessageNodes(root))) {
      if (isThoughtsOnly(el) || !extractMessageText(el)) continue;
      const key = el.getAttribute("data-message-id") || el;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(el);
    }

    return unique;
  }

  function getMessageElement(selection) {
    try {
      const message = findSelectedMessage(selection, getAllMessages());
      const node = selection?.anchorNode;
      const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      return el && !isThoughtsOnly(el) ? message : null;
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
      if (endIdx === -1) {
        endIdx = all.findIndex((el) => el.contains(messageEl));
      }
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
    if (el.closest(".ql-editor")) return true;
    if (el.closest("rich-textarea")) return true;
    if (el.closest('[class*="input-area"], [class*="input-container"]')) return true;
    if (el.closest("textarea")) return true;
    if (el.closest('[contenteditable="true"]')?.closest("footer, form, [class*='input']")) {
      return true;
    }
    if (el.closest('[aria-label*="Prompt" i], [aria-label*="prompt" i]')) return true;
    if (el.closest("model-thoughts, .thoughts-container, .thoughts-content")) return true;
    return false;
  }

  function getConversationTitle() {
    const title = document.title.replace(/\s*[-–—]\s*Gemini\s*$/i, "").trim();
    if (title && !/^gemini$/i.test(title) && !/^new chat$/i.test(title)) {
      return title;
    }

    const titleSelectors = [
      'a[aria-current="page"]',
      '[class*="conversation-title"]',
      '[class*="selected-conversation"]',
      "nav [class*='title']"
    ];

    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (text && !/^gemini$/i.test(text)) return text;
    }

    return "";
  }

  window.CGIAAdapters.register({
    id: "gemini",
    name: "Gemini",
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
