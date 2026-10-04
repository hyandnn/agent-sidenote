(async function init() {
  try {
    await window.CGIAStorage.loadSettings();
    window.CGIASelection.initSelection();
    window.CGIARouteManager.initRouteManager();
    await window.CGIANoteManager.loadNotesForPage(location.href);
  } catch (error) {
    console.error("Agent Sidenote initialization failed:", error.message);
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type !== "RESTORE_NOTES") return false;
    window.CGIANoteManager.loadNotesForPage(location.href, true)
      .then(() => respond({ ok: true }))
      .catch((error) => respond({ error: error.message }));
    return true;
  });
})();
