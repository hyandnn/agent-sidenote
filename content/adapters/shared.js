(function () {
  function truncateAroundSelection(surroundingText, selectedText, maxLength) {
    const text = (surroundingText || "").trim();
    if (maxLength <= 0) return "";
    if (text.length <= maxLength) return text;

    const idx = text.indexOf(selectedText);
    if (idx === -1) {
      return text.slice(0, maxLength) + "\n\n[上下文已截断]";
    }

    const half = Math.max(0, Math.floor((maxLength - selectedText.length) / 2));
    const start = Math.max(0, Math.min(idx - half, text.length - maxLength));
    const end = Math.min(text.length, start + maxLength);

    const prefix = start > 0 ? "[前文已截断]\n" : "";
    const suffix = end < text.length ? "\n[后文已截断]" : "";

    return prefix + text.slice(start, end) + suffix;
  }

  function truncateSimple(text, maxLength) {
    const t = (text || "").trim();
    if (t.length <= maxLength) return t;
    return t.slice(0, maxLength) + "\n[已截断]";
  }

  function sortByDocumentOrder(nodes) {
    return nodes.slice().sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function selectionAnchorElement(selection) {
    const node = selection?.anchorNode;
    if (!node) return null;
    return node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  }

  const UI_ELEMENTS = 'button, nav, aside, textarea, input, [contenteditable="true"], [hidden], [aria-hidden="true"], script, style, .cgia-note, .cgia-selection-button';

  function shouldIgnoreElement(el) {
    if (el?.closest(UI_ELEMENTS)) return true;
    for (let node = el; node?.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      if (node.style?.display === "none" || node.style?.visibility === "hidden") return true;
    }
    return false;
  }

  function readMessageText(root, excluded = "") {
    if (shouldIgnoreElement(root) || (excluded && root?.closest(excluded))) return "";
    const ignored = excluded ? `${UI_ELEMENTS}, ${excluded}` : UI_ELEMENTS;
    const blockTags = new Set(["P", "DIV", "SECTION", "ARTICLE", "LI", "UL", "OL", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "TABLE", "TR"]);
    function read(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      if (node.matches(ignored) || node.style?.display === "none" || node.style?.visibility === "hidden") return "";
      if (node.tagName === "BR") return "\n";
      const text = Array.from(node.childNodes).map(read).join("");
      return blockTags.has(node.tagName) ? `\n${text}\n` : text;
    }
    return root ? read(root).replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : "";
  }

  function canonicalMessageNodes(nodes) {
    const unique = Array.from(new Set(nodes)).filter((el) => !shouldIgnoreElement(el));
    // Nested selector matches describe one message, not additional turns.
    return sortByDocumentOrder(unique.filter((el) => !unique.some((other) => other !== el && other.contains(el))));
  }

  function findSelectedMessage(selection, messages) {
    const anchor = selectionAnchorElement(selection);
    if (!anchor || shouldIgnoreElement(anchor)) return null;
    const message = messages.find((el) => el === anchor || el.contains(anchor));
    if (!message) return null;
    if (selection.focusNode && !message.contains(selection.focusNode)) return null;
    const focus = selection.focusNode?.nodeType === Node.TEXT_NODE ? selection.focusNode.parentElement : selection.focusNode;
    if (shouldIgnoreElement(focus)) return null;
    return message;
  }

  function buildSessionContext(adapter, mainConversation) {
    const firstUser = (mainConversation || []).find((m) => m.role === "user");
    const mainQuestion = (firstUser?.content || "").trim();

    let mainTopic = "";
    if (adapter?.getConversationTitle) {
      mainTopic = (adapter.getConversationTitle() || "").trim();
    }
    if (!mainTopic && mainQuestion) {
      mainTopic = mainQuestion.slice(0, 80);
    }
    if (!mainTopic) {
      mainTopic = "未命名对话";
    }

    return {
      mainTopic,
      mainQuestion: mainQuestion.slice(0, 500)
    };
  }

  window.CGIAAdapterShared = {
    truncateAroundSelection,
    truncateSimple,
    sortByDocumentOrder,
    selectionAnchorElement,
    shouldIgnoreElement,
    readMessageText,
    canonicalMessageNodes,
    findSelectedMessage,
    buildSessionContext
  };
})();
