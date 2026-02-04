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

  // Ensure the listener is present, then trigger the overlay.
  const sendShowOverlay = (attempt = 0) => {
    chrome.tabs.sendMessage(tab.id, { action: "showOverlay" }, () => {
      if (!chrome.runtime.lastError) return;
      if (attempt >= 2) {
        console.error("❌ Could not establish connection:", chrome.runtime.lastError.message);
        return;
      }
      setTimeout(() => sendShowOverlay(attempt + 1), 200);
    });
  };

  // listener.js is already loaded via manifest content_scripts.
  sendShowOverlay();
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
