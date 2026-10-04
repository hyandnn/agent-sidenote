(function () {
  const SCHEMA_VERSION = 1;

  const NOTE_TYPES = [
    { value: "general", label: "通用" },
    { value: "concept", label: "解释概念" },
    { value: "debug", label: "调试记录" },
    { value: "code", label: "代码方案" },
    { value: "paper", label: "论文/学习" },
    { value: "interview", label: "面试准备" },
    { value: "todo", label: "TODO" }
  ];

  const MARKS = [
    { value: "important", label: "重要" },
    { value: "concept", label: "概念" },
    { value: "reusable-code", label: "代码" },
    { value: "todo", label: "待办" }
  ];

  const VALID_NOTE_TYPES = new Set(NOTE_TYPES.map((t) => t.value));
  const VALID_MARKS = new Set(MARKS.map((m) => m.value));

  const NOTE_TYPE_LABELS = Object.fromEntries(NOTE_TYPES.map((t) => [t.value, t.label]));
  const MARK_LABELS = Object.fromEntries(MARKS.map((m) => [m.value, m.label]));

  function simpleHash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function hashUrl(url) {
    return simpleHash(url || "");
  }

  function parseTagsInput(raw) {
    return (raw || "")
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function formatTags(tags) {
    return (tags || []).join(", ");
  }

  function buildFollowups(messages) {
    const followups = [];
    const msgs = messages || [];

    for (let i = 0; i < msgs.length; i++) {
      const user = msgs[i];
      if (user?.role !== "user") continue;
      const assistant = msgs[i + 1];
      followups.push({
        q: user.content,
        a: assistant?.role === "assistant" ? assistant.content : "",
        status: assistant?.role === "assistant" ? assistant.status || "completed" : "pending",
        error: assistant?.role === "assistant" ? assistant.error || "" : "",
        time: user.createdAt || ""
      });
      if (assistant?.role === "assistant") i += 1;
    }

    return followups;
  }

  function computeContentHashForNote(note) {
    return noteToJsonlRecord(note).content_hash;
  }

  function computeContentHashForRecord(record) {
    const { content_hash, ...content } = record;
    return `hash_${simpleHash(JSON.stringify(content))}`;
  }

  function noteHasFollowups(note) {
    return buildFollowups(note.messages).length > 0;
  }

  function noteIsEmpty(note) {
    return !(note.selectedText || "").trim();
  }

  function filterNotesForExport(notes, options = {}) {
    const {
      excludeEmpty = false,
      excludeNoFollowups = false
    } = options;
    return (notes || []).filter((n) => {
      if (excludeEmpty && noteIsEmpty(n)) return false;
      if (excludeNoFollowups && !noteHasFollowups(n)) return false;
      // Change detection belongs to the final artifact, after URL grouping.
      return true;
    });
  }

  function buildExportPreview(notes) {
    const typeCounts = {};
    const topics = [];
    const seenTopics = new Set();

    (notes || []).forEach((n) => {
      const t = VALID_NOTE_TYPES.has(n.noteType) ? n.noteType : "general";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
      const topic = (n.mainTopic || "").trim();
      if (topic && !seenTopics.has(topic)) {
        seenTopics.add(topic);
        topics.push(topic);
      }
    });

    const urlGroups = {};
    (notes || []).forEach((n) => {
      const url = n.pageUrl || "";
      urlGroups[url] = (urlGroups[url] || 0) + 1;
    });
    const mergeableUrls = Object.values(urlGroups).filter((c) => c > 1).length;

    return {
      count: notes.length,
      typeCounts,
      topics: topics.slice(0, 8),
      moreTopics: Math.max(0, topics.length - 8),
      mergeableUrls,
      mdFiles: notes.length
    };
  }

  function buildExportPreviewWithMerge(notes, mergeByUrl) {
    const base = buildExportPreview(notes);
    if (!mergeByUrl) return base;

    const groups = groupNotesByUrl(notes);
    return {
      ...base,
      mdFiles: groups.length,
      mergeGroups: groups.filter((g) => g.notes.length > 1).length
    };
  }

  function groupNotesByUrl(notes) {
    const map = new Map();
    (notes || []).forEach((note) => {
      const url = note.pageUrl || "";
      if (!map.has(url)) map.set(url, []);
      map.get(url).push(note);
    });
    return Array.from(map.entries()).map(([url, groupNotes]) => ({
      url,
      notes: groupNotes.sort(
        (a, b) =>
          new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      )
    }));
  }

  function turnFromNote(note) {
    const noteType = VALID_NOTE_TYPES.has(note.noteType) ? note.noteType : "general";
    const marks = (note.marks || []).filter((m) => VALID_MARKS.has(m));
    const followups = buildFollowups(note.messages);

    return {
      id: `rec_${note.noteId}`,
      time: note.createdAt || note.updatedAt || new Date().toISOString(),
      selected_text: note.selectedText || "",
      followups,
      note_type: noteType,
      marks,
      tags: note.tags || []
    };
  }

  function mergeNotesToRecord(notes) {
    if (!notes.length) return null;
    const sorted = [...notes].sort(
      (a, b) =>
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
    );
    const first = sorted[0];
    const turns = sorted.map(turnFromNote);
    const allTags = [...new Set(sorted.flatMap((n) => n.tags || []))];
    const url = first.pageUrl || "";
    const record = {
      schema_version: SCHEMA_VERSION,
      id: `rec_url_${hashUrl(url)}`,
      time: first.createdAt || first.updatedAt || new Date().toISOString(),
      source: first.siteId || "unknown",
      url,
      main_topic: first.mainTopic || "",
      main_question: first.mainQuestion || "",
      selected_text: "",
      followups: [],
      note_type: first.noteType && VALID_NOTE_TYPES.has(first.noteType) ? first.noteType : "general",
      marks: [],
      tags: allTags,
      status: "draft",
      turns
    };
    record.content_hash = computeContentHashForRecord(record);
    return record;
  }

  function noteToJsonlRecord(note) {
    const noteType = VALID_NOTE_TYPES.has(note.noteType) ? note.noteType : "general";
    const marks = (note.marks || []).filter((m) => VALID_MARKS.has(m));
    const followups = buildFollowups(note.messages);

    const record = {
      schema_version: SCHEMA_VERSION,
      id: `rec_${note.noteId}`,
      time: note.createdAt || note.updatedAt || new Date().toISOString(),
      source: note.siteId || "unknown",
      url: note.pageUrl || "",
      main_topic: note.mainTopic || "",
      main_question: note.mainQuestion || "",
      selected_text: note.selectedText || "",
      followups,
      note_type: noteType,
      marks,
      tags: note.tags || [],
      status: "draft"
    };
    record.content_hash = computeContentHashForRecord(record);
    return record;
  }

  function notesToJsonlRecords(notes, options = {}) {
    const { mergeByUrl = false } = options;
    if (!mergeByUrl) {
      return notes.map((n) => noteToJsonlRecord(n));
    }

    return groupNotesByUrl(notes).map((group) => mergeNotesToRecord(group.notes));
  }

  function exportFilenameTopic(records) {
    if (!records?.length) return "notes";
    if (records.length === 1) {
      return records[0].main_topic || records[0].selected_text || "notes";
    }
    const first = records[0];
    return first.main_topic || first.source || "notes";
  }

  function exportFilenameSite(records) {
    if (!records?.length) return "notes";
    const sites = [...new Set(records.map((r) => r.source).filter(Boolean))];
    if (sites.length === 1) return sites[0];
    return "multi";
  }

  function parseTime(iso) {
    const d = iso ? new Date(iso) : new Date();
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  function formatFilenameTimestamp(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${y}${m}${day}-${h}${min}`;
  }

  function formatDisplayTimestamp(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${h}:${min}`;
  }

  function sanitizeFilename(str, maxLen = 40) {
    const safe = (str || "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, maxLen);
    return safe || "未命名";
  }

  function validateMdExportDir(dir) {
    const trimmed = (dir || "").trim();
    if (!trimmed) return { ok: true, dir: "Notes" };
    if (/^[\\/]|^[A-Za-z]:/.test(trimmed)) {
      return {
        ok: false,
        error: "不能使用绝对路径，请填写相对 Chrome 下载目录的子路径。"
      };
    }
    if (trimmed.includes("..")) {
      return {
        ok: false,
        error:
          "Chrome 不允许 .. 跳目录。若要保存到 ~/Note/00_Inbox，请先在终端执行：ln -s ~/Note/00_Inbox ~/Downloads/Note/00_Inbox，然后填写 Note/00_Inbox。"
      };
    }
    if (/[<>:"|?*]/.test(trimmed)) {
      return { ok: false, error: "路径包含非法字符。" };
    }
    const normalized = trimmed.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
    return { ok: true, dir: normalized };
  }

  function renderFrontMatter(record, created) {
    const tags = record.tags || [];
    const marks = record.marks || [];
    const contentHash = computeContentHashForRecord(record);
    const lines = [
      "---",
      `source: ${JSON.stringify(record.source || "unknown")}`,
      `url: ${JSON.stringify(record.url || "")}`,
      `type: ${JSON.stringify(record.note_type || "general")}`,
      `id: ${JSON.stringify(record.id || "")}`,
      `content_hash: ${JSON.stringify(contentHash)}`,
      `created: ${JSON.stringify(created.toISOString())}`
    ];
    if (tags.length) {
      lines.push("tags:");
      tags.forEach((t) => lines.push(`  - ${JSON.stringify(String(t))}`));
    }
    if (marks.length) {
      lines.push("marks:");
      marks.forEach((m) => lines.push(`  - ${JSON.stringify(String(m))}`));
    }
    lines.push("---");
    return lines.join("\n");
  }

  function renderFollowupsSection(followups) {
    const parts = ["## 追问记录", ""];
    if (followups?.length) {
      followups.forEach((item) => {
        const q = (item.q || "").trim();
        const a = (item.a || "").trim();
        if (q) {
          parts.push(`### ${q}`, "");
        }
        if (a) {
          parts.push(a, "");
        }
        if (item.status && item.status !== "completed") {
          const labels = { pending: "回答尚未完成", streaming: "回答尚未完成", failed: "请求失败", cancelled: "请求已停止", interrupted: "回答未完整生成" };
          parts.push(`> ${labels[item.status] || "回答尚未完成"}${item.error ? `：${item.error}` : ""}`, "");
        }
      });
    } else {
      parts.push("（暂无旁注追问）", "");
    }
    return parts;
  }

  function renderSelectedSection(selected) {
    if (!(selected || "").trim()) return [];
    const parts = ["## 选中的原文", ""];
    selected.split("\n").forEach((line) => {
      parts.push(line ? `> ${line}` : ">");
    });
    parts.push("");
    return parts;
  }

  function renderTurnSection(turn, index) {
    const created = parseTime(turn.time);
    const stamp = formatDisplayTimestamp(created);
    const noteType = turn.note_type || "general";
    const marks = turn.marks || [];
    const selected = (turn.selected_text || "").trim();
    const parts = [`## 便签 ${index} · ${stamp}`, ""];

    if (selected) {
      parts.push(...renderSelectedSection(selected));
    }
    parts.push(...renderFollowupsSection(turn.followups || []));

    const meta = [`- 类型：${NOTE_TYPE_LABELS[noteType] || noteType}`];
    if (marks.length) {
      meta.push(`- 标记：${marks.map((m) => MARK_LABELS[m] || m).join("、")}`);
    }
    if (turn.tags?.length) {
      meta.push(`- 标签：${turn.tags.join(", ")}`);
    }
    if (turn.id) {
      meta.push(`- 记录 id：${turn.id}`);
    }
    parts.push("### 元数据", "", ...meta, "");
    return parts;
  }

  function renderMarkdown(record) {
    const created = parseTime(record.time);
    const topic = (record.main_topic || "未命名对话").trim();
    const mainQuestion = (record.main_question || "").trim();
    const selected = (record.selected_text || "").trim();
    const noteType = record.note_type || "general";
    const marks = record.marks || [];
    const followups = record.followups || [];
    const turns = record.turns || [];

    const parts = [renderFrontMatter(record, created), "", `# ${topic}`, ""];

    if (mainQuestion) {
      parts.push("## 主问题", "", mainQuestion, "");
    }

    if (turns.length) {
      turns.forEach((turn, idx) => {
        parts.push(...renderTurnSection(turn, idx + 1));
      });
    } else {
      if (selected) {
        parts.push(...renderSelectedSection(selected));
      }
      parts.push(...renderFollowupsSection(followups));
    }

    const metaLines = [
      `- 类型：${NOTE_TYPE_LABELS[noteType] || noteType}`,
      `- 来源：${record.source || "unknown"}`
    ];
    if (marks.length) {
      metaLines.push(`- 标记：${marks.map((m) => MARK_LABELS[m] || m).join("、")}`);
    }
    if (record.url) {
      metaLines.push(`- 对话链接：${record.url}`);
    }
    if (turns.length) {
      metaLines.push(`- 便签数：${turns.length}`);
    }
    parts.push("## 元数据", "", ...metaLines, "");

    if (marks.includes("todo") || noteType === "todo") {
      parts.push("## TODO", "", "- [ ] （在此补充待办）", "");
    }

    return `${parts.join("\n").trim()}\n`;
  }

  function markdownOutputFilename(record, suffix = "") {
    const created = parseTime(record.time);
    const stamp = formatFilenameTimestamp(created);
    const topic = sanitizeFilename(record.main_topic || "未命名");
    const recId = sanitizeFilename((record.id || "").replace(/^rec_/, ""), 80);
    const extra = suffix ? `-${suffix}` : "";
    return `${stamp}-${topic}-${recId}${extra}.md`;
  }

  function noteToMarkdown(note) {
    return renderMarkdown(noteToJsonlRecord(note));
  }

  function notesToMarkdownFiles(notes, options = {}) {
    return notesToJsonlRecords(notes, options).map((record) => ({
      filename: markdownOutputFilename(record),
      content: renderMarkdown(record)
    }));
  }

  function prepareMarkdownExport(notes, options = {}, receipts = {}, exportDir = "Notes") {
    const eligible = filterNotesForExport(notes, options);
    const records = notesToJsonlRecords(eligible, options);
    const mode = options.mergeByUrl ? "merged" : "single";
    const files = records.map((record) => {
      const content = renderMarkdown(record);
      const filename = markdownOutputFilename(record);
      const receiptKey = `cgia_export:${JSON.stringify([exportDir, mode, options.mergeByUrl ? record.url : record.id])}`;
      // Compare the complete file, including metadata and all grouped notes.
      const contentHash = `md_${simpleHash(content)}`;
      const noteIds = record.turns?.length
        ? record.turns.map((turn) => turn.id.replace(/^rec_/, ""))
        : [record.id.replace(/^rec_/, "")];
      return { filename, content, receiptKey, contentHash, noteIds };
    }).filter((file) => !options.onlyChanged || receipts[file.receiptKey] !== file.contentHash);
    const included = new Set(files.flatMap((file) => file.noteIds));
    return { files, notes: eligible.filter((note) => included.has(note.noteId)) };
  }

  function normalizeNote(note, defaults = {}) {
    return {
      ...note,
      noteType: VALID_NOTE_TYPES.has(note.noteType)
        ? note.noteType
        : defaults.defaultNoteType || "general",
      marks: Array.isArray(note.marks)
        ? note.marks.filter((m) => VALID_MARKS.has(m))
        : [],
      tags: Array.isArray(note.tags) ? note.tags : [],
      messages: Array.isArray(note.messages) ? note.messages : [],
      position: note.position || { x: 20, y: 20 },
      status: note.status || "visible",
      revision: note.revision || 0,
      mainTopic: note.mainTopic || "",
      mainQuestion: note.mainQuestion || ""
    };
  }

  globalThis.CGIANoteSchema = {
    SCHEMA_VERSION,
    NOTE_TYPES,
    MARKS,
    NOTE_TYPE_LABELS,
    VALID_NOTE_TYPES,
    VALID_MARKS,
    parseTagsInput,
    formatTags,
    buildFollowups,
    simpleHash,
    computeContentHashForNote,
    computeContentHashForRecord,
    noteHasFollowups,
    noteIsEmpty,
    filterNotesForExport,
    buildExportPreview,
    buildExportPreviewWithMerge,
    groupNotesByUrl,
    noteToJsonlRecord,
    notesToJsonlRecords,
    exportFilenameTopic,
    exportFilenameSite,
    renderMarkdown,
    markdownOutputFilename,
    noteToMarkdown,
    notesToMarkdownFiles,
    prepareMarkdownExport,
    validateMdExportDir,
    normalizeNote
  };
})();
