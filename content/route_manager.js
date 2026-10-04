(function () {
  let currentUrl = location.href;
  let initialized = false;
  let poll;
  let observer;
  let queued = false;
  let hasStarted = false;

  function checkRoute() {
    queued = false;
    const nextUrl = location.href;
    if (nextUrl === currentUrl) return;
    const oldUrl = currentUrl;
    currentUrl = nextUrl;
    window.CGIANoteManager.clearNotesForPage(oldUrl);
    window.CGIASelection.hideSelectionButton();
    window.CGIANoteManager.loadNotesForPage(nextUrl)
      .catch((error) => console.error("Agent Sidenote restore failed:", error.message));
  }

  function scheduleCheck() {
    if (queued) return;
    queued = true;
    queueMicrotask(checkRoute);
  }

  function startWatching() {
    if (poll) return;
    const restoring = hasStarted && location.href === currentUrl;
    hasStarted = true;
    // Polling works across isolated worlds even for URL-only pushState calls.
    poll = setInterval(checkRoute, 500);
    observer = new MutationObserver(scheduleCheck);
    observer.observe(document.body, { childList: true, subtree: true });
    checkRoute();
    if (restoring) window.CGIANoteManager.loadNotesForPage(currentUrl)
      .catch((error) => console.error("Agent Sidenote restore failed:", error.message));
  }

  function stopWatching() {
    clearInterval(poll);
    poll = null;
    observer?.disconnect();
    window.CGIANoteManager.clearNotesForPage(currentUrl);
  }

  function initRouteManager() {
    if (initialized) return;
    initialized = true;
    window.addEventListener("popstate", scheduleCheck);
    window.addEventListener("hashchange", scheduleCheck);
    window.addEventListener("pageshow", startWatching);
    window.addEventListener("pagehide", stopWatching);
    startWatching();
  }

  window.CGIARouteManager = { initRouteManager };
})();
