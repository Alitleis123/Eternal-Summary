// background.js

// When the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  console.log("🌀 Eternal Summary icon clicked!");
  // Send a message to the active tab
  chrome.tabs.sendMessage(tab.id, { action: "showOverlay" }, () => {
    if (chrome.runtime.lastError) {
      console.error("❌ Could not establish connection:", chrome.runtime.lastError.message);
    }
  });
});

// Optional: backend summarizer call
async function getSummaryFromBackend(text) {
  try {
    const response = await fetch("https://ai-extension-backend.fly.dev/api/summarize", {
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