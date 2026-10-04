(function () {
  const activeNotes = new Map(); // noteId -> { note, el }
  const noteStates = new WeakMap();
  let topZIndex = 2147483000;

  const DEFAULT_SIZE = { width: 380, height: 480 };

  // ---------- helpers ----------

  function createNoteId() {
    return `note_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function calculateNotePosition(selectionRect, noteWidth = 360, noteHeight = 420) {
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x, y;

    // 优先右侧
    if (selectionRect.right + margin + noteWidth <= vw) {
      x = selectionRect.right + margin;
    } else if (selectionRect.left - margin - noteWidth >= 0) {
      // 左侧
      x = selectionRect.left - margin - noteWidth;
    } else {
      // 居中
      x = Math.max(10, (vw - noteWidth) / 2);
    }

    y = selectionRect.top;

    // 确保不超出视口
    x = Math.max(10, Math.min(x, vw - noteWidth - 10));
    y = Math.max(10, Math.min(y, vh - noteHeight - 10));

    return { x, y };
  }

  function clampPositionToViewport(position, size) {
    const w = (size && size.width) || DEFAULT_SIZE.width;
    const h = (size && size.height) || DEFAULT_SIZE.height;
    const x = Math.max(10, Math.min(position.x, window.innerWidth - w - 10));
    const y = Math.max(10, Math.min(position.y, window.innerHeight - h - 10));
    return { x, y };
  }

  function bringNoteToFront(noteEl) {
    topZIndex += 1;
    noteEl.style.zIndex = String(topZIndex);
  }

  // 标题取自选中文本：含空格的语言按单词数截断（≤5 个单词全显），
  // 中文等无空格文本按字数截断（≤5 字全显）。
  // 单词特别长导致放不下时，由 CSS 的 text-overflow: ellipsis 兜底。
  function makeNoteTitle(selectedText) {
    const t = (selectedText || "").trim().replace(/\s+/g, " ");
    if (!t) return "局部追问";

    const words = t.split(" ");
    if (words.length > 1) {
      if (words.length <= 5) return t;
      return words.slice(0, 5).join(" ") + "...";
    }

    if (t.length <= 5) return t;
    return t.slice(0, 5) + "...";
  }

  // 折叠时窗口缩到原宽度的 85%，只留标题条
  function applyCollapsedWidth(noteEl, note) {
    const w = (note.size && note.size.width) || DEFAULT_SIZE.width;
    noteEl.style.width = note.collapsed ? `${Math.round(w * 0.85)}px` : `${w}px`;
  }

  // Sanitize untrusted model output before importing nodes into the page.
  function markdownToFragment(md) {
    try {
      if (typeof marked === "undefined" || typeof DOMPurify === "undefined") throw new Error("Renderer unavailable");
      const frag = DOMPurify.sanitize(marked.parse(md), {
        RETURN_DOM_FRAGMENT: true,
        ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "blockquote", "pre", "code", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "table", "thead", "tbody", "tr", "th", "td", "a"],
        ALLOWED_ATTR: ["href", "title", "start", "colspan", "rowspan"],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false
      });
      frag.querySelectorAll("a").forEach((link) => {
        const href = link.getAttribute("href") || "";
        if (!/^https?:\/\//i.test(href)) link.removeAttribute("href");
        else { link.setAttribute("target", "_blank"); link.setAttribute("rel", "noopener noreferrer"); }
      });
      return frag;
    } catch (e) {
      // 降级：纯文本
      const span = document.createElement("span");
      span.textContent = md;
      const frag = document.createDocumentFragment();
      frag.appendChild(span);
      return frag;
    }
  }

  function appendMessage(container, role, content) {
    const div = document.createElement("div");
    div.className = `cgia-message cgia-message-${role}`;
    if (role === "assistant") {
      div.appendChild(markdownToFragment(content));
    } else {
      div.textContent = content;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function appendStreamingAssistant(container) {
    const div = document.createElement("div");
    div.className = "cgia-message cgia-message-assistant cgia-message-streaming";

    const textSpan = document.createElement("span");
    textSpan.className = "cgia-stream-text";
    textSpan.textContent = "▍";

    div.appendChild(textSpan);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    return { div, textSpan, container };
  }

  function updateStreamingAssistant(streamEl, fullText) {
    if (!streamEl) return;
    streamEl.textSpan.textContent = fullText + "▍";
    streamEl.container.scrollTop = streamEl.container.scrollHeight;
  }

  function finalizeStreamingAssistant(streamEl, fullText) {
    if (!streamEl) return;
    streamEl.div.classList.remove("cgia-message-streaming");
    streamEl.div.replaceChildren();
    streamEl.div.appendChild(markdownToFragment(fullText));
    streamEl.container.scrollTop = streamEl.container.scrollHeight;
  }

  function removeStreamingAssistant(streamEl) {
    if (streamEl?.div?.parentNode) {
      streamEl.div.remove();
    }
  }

  function persistNote(note) {
    note.updatedAt = new Date().toISOString();
    return window.CGIAStorage.saveNote(note);
  }

  function persistWithFeedback(noteEl, note) {
    return persistNote(note).catch((error) => {
      showSaveFeedback(noteEl, error.message, true);
    });
  }

  function showSaveFeedback(noteEl, text, isError = false) {
    const fb = noteEl.querySelector(".cgia-save-feedback");
    if (!fb) return;
    fb.textContent = text;
    fb.style.color = isError ? "#c0392b" : "#2e7d32";
    if (!isError) setTimeout(() => { fb.textContent = ""; }, 2500);
  }

  async function handleSaveAsNote(noteEl, note) {
    const button = noteEl.querySelector(".cgia-save-note-btn");
    if (button.disabled) return;
    button.disabled = true;
    try {
      await persistNote(note);
      const settings = window.CGIAStorage.getSettingsSync();
      const check = window.CGIANoteSchema.validateMdExportDir(settings.mdExportDir);
      if (!check.ok) throw new Error(check.error);
      const receipts = await window.CGIANoteClient.getReceipts();
      const plan = window.CGIANoteSchema.prepareMarkdownExport([note], { onlyChanged: true }, receipts, check.dir);
      if (!plan.files.length) { showSaveFeedback(noteEl, "内容与上次导出相同，已跳过"); return; }
      await window.CGIAExport.downloadMarkdown(plan.files, { ...settings, mdExportDir: check.dir });
      showSaveFeedback(noteEl, "已保存 Markdown 文件");
    } catch (error) {
      showSaveFeedback(noteEl, error.message, true);
    } finally { button.disabled = false; }
  }

  // chatgpt.com 启用 Trusted Types CSP，innerHTML 赋值会抛 TypeError，
  // 因此窗口 DOM 必须用 createElement 逐个构建。
  function buildNoteDom(note) {
    const el = document.createElement("div");
    el.className = "cgia-note";
    el.dataset.noteId = note.noteId;

    const header = document.createElement("div");
    header.className = "cgia-note-header";

    const title = document.createElement("span");
    title.className = "cgia-note-title";
    title.textContent = makeNoteTitle(note.selectedText);
    title.title = (note.selectedText || "").slice(0, 200); // hover 看完整内容

    const collapseBtn = document.createElement("button");
    collapseBtn.className = "cgia-note-collapse";
    collapseBtn.title = "折叠";
    collapseBtn.textContent = "−";

    const closeBtn = document.createElement("button");
    closeBtn.className = "cgia-note-close";
    closeBtn.title = "关闭";
    closeBtn.textContent = "×";

    header.appendChild(title);
    header.appendChild(collapseBtn);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "cgia-note-body";

    const meta = document.createElement("div");
    meta.className = "cgia-note-meta";

    const typeSelect = document.createElement("select");
    typeSelect.className = "cgia-note-type";
    typeSelect.title = "笔记类型";
    window.CGIANoteSchema.NOTE_TYPES.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.value;
      opt.textContent = t.label;
      typeSelect.appendChild(opt);
    });
    typeSelect.value = note.noteType || "general";

    const marksRow = document.createElement("div");
    marksRow.className = "cgia-marks-row";
    window.CGIANoteSchema.MARKS.forEach((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cgia-mark-btn";
      btn.dataset.mark = m.value;
      btn.textContent = m.label;
      btn.title = `标记：${m.label}`;
      if ((note.marks || []).includes(m.value)) {
        btn.classList.add("active");
      }
      marksRow.appendChild(btn);
    });

    const tagsInput = document.createElement("input");
    tagsInput.type = "text";
    tagsInput.className = "cgia-tags-input";
    tagsInput.placeholder = "标签，逗号分隔";
    tagsInput.value = window.CGIANoteSchema.formatTags(note.tags);

    meta.appendChild(typeSelect);
    meta.appendChild(marksRow);
    meta.appendChild(tagsInput);

    const quote = document.createElement("div");
    quote.className = "cgia-quote";

    const messages = document.createElement("div");
    messages.className = "cgia-messages";

    const inputRow = document.createElement("div");
    inputRow.className = "cgia-input-row";

    const actionsRow = document.createElement("div");
    actionsRow.className = "cgia-note-actions";

    const saveNoteBtn = document.createElement("button");
    saveNoteBtn.type = "button";
    saveNoteBtn.className = "cgia-save-note-btn";
    saveNoteBtn.textContent = "Save as Note";

    const saveFeedback = document.createElement("span");
    saveFeedback.className = "cgia-save-feedback";

    actionsRow.appendChild(saveNoteBtn);
    actionsRow.appendChild(saveFeedback);

    const textarea = document.createElement("textarea");
    textarea.className = "cgia-question-input";
    textarea.placeholder = "输入问题…";
    textarea.value = note.draftQuestion || "";

    const sendBtn = document.createElement("button");
    sendBtn.className = "cgia-send-button";
    sendBtn.textContent = "发送";
    const stopBtn = document.createElement("button");
    stopBtn.className = "cgia-stop-button";
    stopBtn.textContent = "停止";
    stopBtn.hidden = true;

    inputRow.appendChild(textarea);
    inputRow.appendChild(sendBtn);
    inputRow.appendChild(stopBtn);

    body.appendChild(meta);
    body.appendChild(quote);
    body.appendChild(messages);
    body.appendChild(actionsRow);
    body.appendChild(inputRow);

    el.appendChild(header);
    el.appendChild(body);

    // 原文引用：超过 300 字默认折叠，提供"展开引用"
    const quoteEl = el.querySelector(".cgia-quote");
    const fullQuote = note.selectedText || "";
    if (fullQuote.length > 300) {
      const short = fullQuote.slice(0, 300) + "…";
      quoteEl.textContent = short;
      const expandBtn = document.createElement("button");
      expandBtn.className = "cgia-quote-expand";
      expandBtn.textContent = "展开引用";
      let expanded = false;
      expandBtn.addEventListener("click", () => {
        expanded = !expanded;
        quoteEl.textContent = expanded ? fullQuote : short;
        quoteEl.appendChild(expandBtn);
        expandBtn.textContent = expanded ? "收起引用" : "展开引用";
      });
      quoteEl.appendChild(expandBtn);
    } else {
      quoteEl.textContent = fullQuote;
    }

    // position / size
    const size = note.size || DEFAULT_SIZE;
    el.style.width = `${size.width}px`;
    el.style.height = `${size.height}px`;
    const pos = clampPositionToViewport(note.position, size);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;

    // collapsed
    if (note.collapsed) {
      el.classList.add("collapsed");
      el.querySelector(".cgia-note-collapse").textContent = "+";
      applyCollapsedWidth(el, note);
    }

    // 历史消息
    const messagesEl = el.querySelector(".cgia-messages");
    (note.messages || []).forEach((m) => {
      if (m.role === "user" || m.role === "assistant") {
        const message = appendMessage(messagesEl, m.role, m.content);
        if (m.role === "assistant" && m.status && m.status !== "completed") {
          const status = document.createElement("div");
          status.className = "cgia-error-msg";
          status.textContent = m.error || "上次回答未完成，已保留收到的内容。";
          message.appendChild(status);
        }
      }
    });

    return el;
  }

  function initMetaBar(noteEl, note) {
    const typeSelect = noteEl.querySelector(".cgia-note-type");
    typeSelect.addEventListener("change", () => {
      note.noteType = typeSelect.value;
      persistWithFeedback(noteEl, note);
    });

    noteEl.querySelectorAll(".cgia-mark-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const mark = btn.dataset.mark;
        if (!note.marks) note.marks = [];
        const idx = note.marks.indexOf(mark);
        if (idx >= 0) {
          note.marks.splice(idx, 1);
          btn.classList.remove("active");
        } else {
          note.marks.push(mark);
          btn.classList.add("active");
        }
        persistWithFeedback(noteEl, note);
      });
    });

    const tagsInput = noteEl.querySelector(".cgia-tags-input");
    const saveTags = () => {
      note.tags = window.CGIANoteSchema.parseTagsInput(tagsInput.value);
      persistWithFeedback(noteEl, note);
    };
    tagsInput.addEventListener("change", saveTags);
    tagsInput.addEventListener("blur", saveTags);

    const saveBtn = noteEl.querySelector(".cgia-save-note-btn");
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleSaveAsNote(noteEl, note);
    });
  }

  // ---------- interactions ----------

  function initDrag(noteEl, note, state) {
    const header = noteEl.querySelector(".cgia-note-header");
    let dragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseInt(noteEl.style.left) || 0;
      startTop = parseInt(noteEl.style.top) || 0;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;

      const w = noteEl.offsetWidth;
      const h = noteEl.offsetHeight;
      newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - w));
      newTop = Math.max(0, Math.min(newTop, window.innerHeight - h));

      noteEl.style.left = `${newLeft}px`;
      noteEl.style.top = `${newTop}px`;
    }, { signal: state.listeners.signal });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      note.position.x = parseInt(noteEl.style.left);
      note.position.y = parseInt(noteEl.style.top);
      note.updatedAt = new Date().toISOString();
      persistWithFeedback(noteEl, note);
    }, { signal: state.listeners.signal });
  }

  function initCollapse(noteEl, note) {
    const btn = noteEl.querySelector(".cgia-note-collapse");
    btn.addEventListener("click", () => {
      note.collapsed = !note.collapsed;
      noteEl.classList.toggle("collapsed", note.collapsed);
      btn.textContent = note.collapsed ? "+" : "−";
      applyCollapsedWidth(noteEl, note);
      if (!note.collapsed && note.size) {
        noteEl.style.height = `${note.size.height}px`; // 展开时恢复保存的高度
      }
      note.updatedAt = new Date().toISOString();
      persistWithFeedback(noteEl, note);
    });
  }

  function initClose(noteEl, note) {
    const btn = noteEl.querySelector(".cgia-note-close");
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const previousStatus = note.status;
      note.status = "hidden";
      note.draftQuestion = noteEl.querySelector(".cgia-question-input").value;
      try {
        await persistNote(note);
        disposeNote(noteEl);
        noteEl.remove();
        activeNotes.delete(note.noteId);
      } catch (error) {
        note.status = previousStatus;
        showSaveFeedback(noteEl, error.message, true);
        btn.disabled = false;
      }
    });
  }

  async function handleSend(noteEl, note) {
    const state = noteStates.get(noteEl);
    if (!state || state.sending || state.disposed) return;
    const input = noteEl.querySelector(".cgia-question-input");
    const sendBtn = noteEl.querySelector(".cgia-send-button");
    const messagesEl = noteEl.querySelector(".cgia-messages");

    const question = input.value.trim();
    if (!question) return;
    state.sending = true;
    state.request = new AbortController();
    sendBtn.disabled = true;
    input.disabled = true;
    const stopBtn = noteEl.querySelector(".cgia-stop-button");
    stopBtn.hidden = false;
    const now = new Date().toISOString();
    const history = window.CGIANoteSchema.buildFollowups(note.messages)
      .filter((turn) => turn.status === "completed")
      .flatMap((turn) => [{ role: "user", content: turn.q }, { role: "assistant", content: turn.a }]);
    const userMessage = { role: "user", content: question, createdAt: now, status: "completed" };
    const assistantMessage = { role: "assistant", content: "", createdAt: now, status: "pending" };
    note.messages.push(userMessage, assistantMessage);
    note.draftQuestion = "";
    let streamEl;
    let answer = "";
    let initialSaveSucceeded = false;
    try {
      await persistNote(note);
      initialSaveSucceeded = true;
      input.value = "";
      input.disabled = false;
      appendMessage(messagesEl, "user", question);
      streamEl = appendStreamingAssistant(messagesEl);
      const payload = {
        noteId: note.noteId,
        pageUrl: note.pageUrl,
        siteId: note.siteId || "",
        siteName: note.siteName || "",
        selectedText: note.selectedText,
        surroundingText: note.surroundingText,
        fullMessageText: note.fullMessageText || "",
        mainConversation: note.mainConversation || [],
        userQuestion: question,
        conversationHistory: history,
        options: { language: "zh-CN", answerStyle: "clear_and_step_by_step" }
      };

      const res = await window.CGIAApiClient.askModelStream(payload, (_delta, full) => {
        answer = full;
        assistantMessage.content = full;
        assistantMessage.status = "streaming";
        updateStreamingAssistant(streamEl, full);
        if (!state.partialTimer) state.partialTimer = setTimeout(() => {
          state.partialTimer = null;
          persistWithFeedback(noteEl, note);
        }, 500);
      }, { signal: state.request.signal });

      answer = res.answer || "";
      finalizeStreamingAssistant(streamEl, answer);

      assistantMessage.content = answer;
      assistantMessage.status = "completed";
    } catch (err) {
      if (!initialSaveSucceeded) {
        note.messages.splice(note.messages.indexOf(userMessage), 2);
        note.draftQuestion = question;
        input.value = question;
      } else {
        assistantMessage.content = err.partialAnswer || answer;
        assistantMessage.status = err.code === "CANCELLED" ? "cancelled" : "failed";
        assistantMessage.error = err.message;
        if (assistantMessage.content) finalizeStreamingAssistant(streamEl, assistantMessage.content);
        else removeStreamingAssistant(streamEl);
      }
      const errDiv = document.createElement("div");
      errDiv.className = "cgia-error-msg";
      errDiv.textContent = `错误：${err.message}`;
      messagesEl.appendChild(errDiv);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } finally {
      clearTimeout(state.partialTimer);
      state.partialTimer = null;
      if (initialSaveSucceeded) await persistWithFeedback(noteEl, note);
      state.sending = false;
      state.request = null;
      sendBtn.disabled = false;
      input.disabled = false;
      stopBtn.hidden = true;
    }
  }

  // 用户拖右下角缩放（CSS resize）后，停止 300ms 再持久化新尺寸
  function initResize(noteEl, note, state) {
    const observer = new ResizeObserver(() => {
      if (note.collapsed) return; // 折叠态高度是 auto，不存档
      const w = noteEl.offsetWidth;
      const h = noteEl.offsetHeight;
      if (!w || !h) return;
      if (note.size && note.size.width === w && note.size.height === h) return;

      note.size = { width: w, height: h };
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(() => {
        persistWithFeedback(noteEl, note);
      }, 300);
    });
    observer.observe(noteEl);
    state.observer = observer;
  }

  function disposeNote(noteEl) {
    const state = noteStates.get(noteEl);
    if (!state) return;
    state.disposed = true;
    state.listeners.abort();
    state.request?.abort();
    state.observer?.disconnect();
    clearTimeout(state.resizeTimer);
    clearTimeout(state.draftTimer);
    clearTimeout(state.partialTimer);
  }

  function wireNote(noteEl, note) {
    const state = { listeners: new AbortController(), sending: false, disposed: false };
    noteStates.set(noteEl, state);
    noteEl.addEventListener("mousedown", () => bringNoteToFront(noteEl));
    initDrag(noteEl, note, state);
    initCollapse(noteEl, note);
    initClose(noteEl, note);
    initResize(noteEl, note, state);
    initMetaBar(noteEl, note);

    const sendBtn = noteEl.querySelector(".cgia-send-button");
    const input = noteEl.querySelector(".cgia-question-input");
    noteEl.querySelector(".cgia-stop-button").addEventListener("click", () => state.request?.abort());
    input.addEventListener("input", () => {
      note.draftQuestion = input.value;
      clearTimeout(state.draftTimer);
      state.draftTimer = setTimeout(() => persistWithFeedback(noteEl, note), 300);
    });
    sendBtn.addEventListener("click", () => handleSend(noteEl, note));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend(noteEl, note);
      }
    });
  }

  function renderNote(note) {
    const normalized = window.CGIANoteSchema.normalizeNote(
      note,
      window.CGIAStorage.getSettingsSync()
    );
    if (activeNotes.has(normalized.noteId)) return activeNotes.get(normalized.noteId).el;
    const el = buildNoteDom(normalized);
    document.body.appendChild(el);
    bringNoteToFront(el);
    wireNote(el, normalized);
    activeNotes.set(normalized.noteId, { note: normalized, el });
    return el;
  }

  // ---------- public API ----------

  async function createNote(selectionInfo) {
    const now = new Date().toISOString();
    const position = calculateNotePosition(selectionInfo.rect);
    const settings = window.CGIAStorage.getSettingsSync();

    const note = {
      noteId: createNoteId(),
      pageUrl: location.href,
      siteId: selectionInfo.siteId || "",
      siteName: selectionInfo.siteName || "",
      selectedText: selectionInfo.selectedText,
      selectedTextHash: selectionInfo.selectedTextHash,
      surroundingText: selectionInfo.surroundingText,
      fullMessageText: selectionInfo.fullMessageText || "",
      mainConversation: selectionInfo.mainConversation || [],
      mainTopic: selectionInfo.mainTopic || "",
      mainQuestion: selectionInfo.mainQuestion || "",
      noteType: settings.defaultNoteType || "general",
      marks: [],
      tags: [],
      status: "visible",
      position,
      size: { ...DEFAULT_SIZE },
      collapsed: false,
      messages: [],
      createdAt: now,
      updatedAt: now
    };

    await window.CGIAStorage.saveNote(note);
    if (location.href === note.pageUrl) renderNote(note);
    return note;
  }

  async function loadNotesForPage(pageUrl, force = false) {
    const settings = window.CGIAStorage.getSettingsSync();
    if (!force && !settings.autoRestoreNotes) return;

    const notes = await window.CGIAStorage.loadNotesForPage(pageUrl);
    if (location.href !== pageUrl) return;
    notes.filter((n) => n.status === "visible").forEach((note) => renderNote(note));
  }

  function clearNotesForPage(pageUrl) {
    for (const [noteId, { note, el }] of activeNotes.entries()) {
      if (note.pageUrl === pageUrl) {
        note.draftQuestion = el.querySelector(".cgia-question-input").value;
        persistWithFeedback(el, note);
        disposeNote(el);
        el.remove();
        activeNotes.delete(noteId);
      }
    }
  }

  window.CGIANoteManager = {
    createNote,
    loadNotesForPage,
    clearNotesForPage
  };
})();
