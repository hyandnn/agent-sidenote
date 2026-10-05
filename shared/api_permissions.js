(function (root) {
  const SITE_ORIGINS = new Set([
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://www.doubao.com/*",
    "https://doubao.com/*",
    "https://gemini.google.com/*"
  ]);

  function getEndpoint(baseUrl) {
    const value = (baseUrl || "https://api.openai.com").trim();
    let parsed;
    try { parsed = new URL(value); }
    catch { throw new Error("API 地址无效，请填写完整的 HTTP 或 HTTPS 地址。"); }
    if (!["https:", "http:"].includes(parsed.protocol) || !parsed.hostname || parsed.hostname.includes("*")) {
      throw new Error("API 地址必须是具体的 HTTP 或 HTTPS 主机，不能使用通配符。");
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("API 地址不能包含账号密码、查询参数或片段；API Key 请填写在单独的输入框中。");
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = path.endsWith("/chat/completions") ? path
      : path.endsWith("/v1") ? `${path}/chat/completions` : `${path}/v1/chat/completions`;
    return {
      url: parsed.href,
      origin: parsed.origin,
      // Chrome host match patterns cover the host's ports and all paths.
      permissionOrigin: `${parsed.protocol}//${parsed.hostname}/*`
    };
  }

  function permissionCall(method, details) {
    return new Promise((resolve, reject) => {
      try {
        const callback = (result) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        };
        if (details === undefined) chrome.permissions[method](callback);
        else chrome.permissions[method](details, callback);
      } catch (error) { reject(error); }
    });
  }

  function permissionError(message) {
    const error = new Error(message);
    error.code = "API_PERMISSION_REQUIRED";
    return error;
  }

  function requestAccess(baseUrl) {
    const endpoint = getEndpoint(baseUrl);
    // Call request synchronously from the click handler, before any await.
    return permissionCall("request", { origins: [endpoint.permissionOrigin] }).then((granted) => {
      if (!granted) throw permissionError(`未授权访问 ${endpoint.origin}。请在扩展设置中点击“测试连接”或“保存设置”重新授权。`);
      return endpoint;
    });
  }

  function hasAccess(baseUrl) {
    return permissionCall("contains", { origins: [getEndpoint(baseUrl).permissionOrigin] });
  }

  async function removeBroadAccess() {
    const permissions = await permissionCall("getAll");
    const broad = (permissions.origins || []).filter((origin) => ["https://*/*", "http://*/*", "*://*/*", "<all_urls>"].includes(origin));
    if (broad.length) {
      await permissionCall("remove", { origins: broad });
      const remaining = await permissionCall("getAll");
      if ((remaining.origins || []).some((origin) => broad.includes(origin))) {
        throw permissionError("旧版的全部网站授权未能清理，请在 Chrome 扩展详情中撤销该授权后重试。");
      }
    }
  }

  async function requireAccess(baseUrl) {
    const endpoint = getEndpoint(baseUrl);
    await removeBroadAccess();
    if (!await hasAccess(baseUrl)) {
      throw permissionError(`API 主机 ${endpoint.origin} 尚未授权或授权已撤销。请打开扩展设置，点击“测试连接”或“保存设置”。`);
    }
    return endpoint;
  }

  async function retainOnlyApiAccess(settings) {
    const keep = settings.mode === "api" ? getEndpoint(settings.apiBaseUrl).permissionOrigin : "";
    const permissions = await permissionCall("getAll");
    const stale = (permissions.origins || []).filter((origin) => !SITE_ORIGINS.has(origin) && origin !== keep);
    if (stale.length) {
      await permissionCall("remove", { origins: stale });
      const remaining = await permissionCall("getAll");
      if ((remaining.origins || []).some((origin) => stale.includes(origin))) throw new Error("旧 API 主机授权未能撤销。");
    }
  }

  async function revokeAccess(baseUrl) {
    const endpoint = getEndpoint(baseUrl);
    if (SITE_ORIGINS.has(endpoint.permissionOrigin)) {
      throw new Error("该主机也是便签支持的网站。请在 Chrome 的扩展详情中管理该网站的访问权限。");
    }
    await removeBroadAccess();
    await permissionCall("remove", { origins: [endpoint.permissionOrigin] });
    if (await hasAccess(baseUrl)) throw new Error("API 授权未能撤销，请在 Chrome 的扩展详情中检查网站访问权限。");
  }

  root.CGIAApiPermissions = { getEndpoint, requestAccess, hasAccess, requireAccess, removeBroadAccess, retainOnlyApiAccess, revokeAccess };
})(typeof window === "undefined" ? globalThis : window);
