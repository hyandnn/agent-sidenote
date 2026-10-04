(function () {
  let selectionButtonEl = null;
  let currentSelectionInfo = null;

  const { truncateAroundSelection } = window.CGIAAdapterShared;

  function hideSelectionButton() {
    if (selectionButtonEl) {
      selectionButtonEl.remove();
      selectionButtonEl = null;
    }
    currentSelectionInfo = null;
  }

  function removeSelectionButtonOnly() {
    if (selectionButtonEl) {
      selectionButtonEl.remove();
      selectionButtonEl = null;
    }
  }

  function getAdapter() {
    return window.CGIAAdapters.getCurrentAdapter();
  }

  function shouldIgnoreSelection(selection) {
    if (!selection || selection.rangeCount === 0) return true;

    const anchorNode = selection.anchorNode;
    if (!anchorNode) return true;

    const el =
      anchorNode.nodeType === Node.TEXT_NODE
        ? anchorNode.parentElement
        : anchorNode;

    if (!el) return true;

    const ignoreTags = ["TEXTAREA", "INPUT"];
    if (ignoreTags.includes(el.tagName)) return true;
    if (el.closest('[contenteditable="true"]')) return true;
    if (el.closest(".cgia-note")) return true;
    if (el.closest(".cgia-selection-button")) return true;

    const adapter = getAdapter();
    if (adapter?.shouldIgnoreElement?.(el)) return true;

    return false;
  }

  function getSurroundingText(selection, maxLength) {
    try {
      const range = selection.getRangeAt(0);
      let container = range.commonAncestorContainer;

      if (container.nodeType === Node.TEXT_NODE) {
        container = container.parentElement;
      }

      let paragraph = container;
      while (paragraph && paragraph !== document.body) {
        const tag = paragraph.tagName;
        if (["P", "LI", "DIV", "SECTION", "ARTICLE", "BLOCKQUOTE"].includes(tag)) {
          break;
        }
        paragraph = paragraph.parentElement;
      }

      const fullText = (paragraph || container).innerText || "";
      return truncateAroundSelection(
        fullText,
        selection.toString().trim(),
        maxLength
      );
    } catch (e) {
      return selection.toString().trim();
    }
  }

  function hashStringFNV1a(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
  }

  function onMouseUp(e) {
    const target = e && e.target;
    if (
      target &&
      target.closest &&
      (target.closest(".cgia-selection-button") || target.closest(".cgia-note"))
    ) {
      return;
    }

    const adapter = getAdapter();
    if (!adapter) return;

    const selection = window.getSelection();
    if (!selection) return;

    const text = selection.toString().trim();

    if (shouldIgnoreSelection(selection) || text.length < 2) {
      hideSelectionButton();
      return;
    }

    const settings = window.CGIAStorage.getSettingsSync();
    if (text.length > settings.maxSelectedTextLength) {
      hideSelectionButton();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const messageEl = adapter.getMessageElement(selection);
    const mainConversation = settings.includeMainConversation
      ? adapter.getMainConversation(
          messageEl,
          settings.mainConversationMaxMessages,
          800
        )
      : [];
    const sessionContext = window.CGIAAdapterShared.buildSessionContext(
      adapter,
      mainConversation
    );

    currentSelectionInfo = {
      siteId: adapter.id,
      siteName: adapter.name,
      selectedText: text,
      selectedTextHash: hashStringFNV1a(text),
      surroundingText: getSurroundingText(selection, settings.surroundingTextMaxLength),
      fullMessageText:
        settings.includeFullMessage && messageEl
          ? adapter.getMessageText(messageEl, text, settings.fullMessageMaxLength)
          : "",
      mainConversation,
      mainTopic: sessionContext.mainTopic,
      mainQuestion: sessionContext.mainQuestion,
      rect
    };

    showSelectionButton(rect);
  }

  function showSelectionButton(rect) {
    removeSelectionButtonOnly();

    const btn = document.createElement("button");
    btn.className = "cgia-selection-button";
    btn.textContent = "旁注追问";

    let top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX;

    const btnWidth = 90;
    if (left + btnWidth > window.innerWidth - 10) {
      left = window.innerWidth - btnWidth - 10;
    }

    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        if (currentSelectionInfo) {
          await window.CGIANoteManager.createNote(currentSelectionInfo);
        }
        hideSelectionButton();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "保存失败，重试";
        btn.title = err.message;
      }
    });

    document.body.appendChild(btn);
    selectionButtonEl = btn;
  }

  function initSelection() {
    const adapter = getAdapter();
    if (!adapter) {
      return;
    }

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", (e) => {
      if (selectionButtonEl && !selectionButtonEl.contains(e.target)) {
        hideSelectionButton();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideSelectionButton();
      }
    });
  }

  window.CGIASelection = {
    initSelection,
    hideSelectionButton
  };
})();
