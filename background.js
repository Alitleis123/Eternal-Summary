// background.js

// When the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  console.log("🌀 Eternal Summary icon clicked!");
  if (!tab?.id || !tab?.url) {
    console.warn("⚠️ No active tab to inject into.");
    return;
  }

  // Chrome blocks content scripts on these schemes.
  const blockedSchemes = ["chrome://", "chrome-extension://", "edge://", "about:", "view-source:"];
  if (blockedSchemes.some((scheme) => tab.url.startsWith(scheme))) {
    console.warn("⚠️ This page does not allow content scripts:", tab.url);
    return;
  }

  // Try sending the message; if the content script isn't there yet, inject it first.
  const sendShowOverlay = () => {
    chrome.tabs.sendMessage(tab.id, { action: "showOverlay" }, () => {
      if (!chrome.runtime.lastError) return;

      // Content script not present — inject it, then retry once.
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: ["listener.js"] },
        () => {
          if (chrome.runtime.lastError) {
            console.error("❌ Could not inject content script:", chrome.runtime.lastError.message);
            return;
          }
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: "showOverlay" }, () => {
              if (chrome.runtime.lastError) {
                console.error("❌ Could not establish connection after injection:", chrome.runtime.lastError.message);
              }
            });
          }, 100);
        }
      );
    });
  };

  sendShowOverlay();
});

// Handle API calls in the extension context to avoid page-origin CORS issues.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "ES_API_REQUEST") return;
  (async () => {
    try {
      const response = await fetch(msg.url, msg.options || {});
      const text = await response.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      sendResponse({
        ok: response.ok,
        status: response.status,
        data,
        text,
      });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err?.message || String(err),
      });
    }
  })();
  return true;
});

// Optional: backend summarizer call
async function getSummaryFromBackend(text) {
  try {
    const response = await fetch("https://ai-extension-backend-twilight-forest-3247.fly.dev/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error("Backend returned an error");

    const data = await response.json();
    return data.summary;
  } catch (err) {
    console.error("⚠️ Failed to connect to backend:", err);
    return "⚠️ Failed to connect to backend.";
  }
}
