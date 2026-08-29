// Service worker: owns the backend address and brokers every network call.
// Page-context code never sees a URL, it only names an endpoint.

const API_BASE = "https://ai-extension-backend-twilight-forest-3247.fly.dev";
const ALLOWED_ENDPOINTS = new Set(["summarize", "ask"]);
const REQUEST_TIMEOUT_MS = 20000;

// Schemes where Chrome refuses to run content scripts.
const BLOCKED_SCHEMES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "brave://",
  "about:",
  "view-source:",
  "devtools://",
];
const BLOCKED_HOSTS = ["chromewebstore.google.com", "chrome.google.com/webstore"];

const canInject = (url) => {
  if (!url) return false;
  if (BLOCKED_SCHEMES.some((scheme) => url.startsWith(scheme))) return false;
  return !BLOCKED_HOSTS.some((host) => url.includes(host));
};

const openOverlay = (tab) => {
  if (!tab?.id || !canInject(tab.url)) return;

  const send = (onFail) =>
    chrome.tabs.sendMessage(tab.id, { action: "showOverlay" }, () => {
      if (chrome.runtime.lastError && onFail) onFail();
    });

  // The content script may not be present yet on pages loaded before install.
  send(() => {
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ["listener.js"] },
      () => {
        if (chrome.runtime.lastError) return;
        setTimeout(() => send(null), 100);
      }
    );
  });
};

chrome.action.onClicked.addListener(openOverlay);

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-overlay") return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab) openOverlay(tab);
  });
});

const callBackend = async (endpoint, payload) => {
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return { ok: false, error: "Unknown endpoint" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { ok: response.ok && data !== null, status: response.status, data };
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    return {
      ok: false,
      error: timedOut ? "Request timed out" : err?.message || String(err),
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "ES_API_REQUEST") return;
  callBackend(msg.endpoint, msg.payload).then(sendResponse);
  return true;
});
