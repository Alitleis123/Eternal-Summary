// Function to call your live Fly.io backend and get the AI summary
async function getSummaryFromBackend(text) {
  try {
    const response = await fetch("https://ai-extension-backend.fly.dev/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();
    return data.summary;
  } catch (err) {
    console.error("Error calling backend:", err);
    return "⚠️ Failed to connect to backend.";
  }
}

// background.js
chrome.action.onClicked.addListener((tab) => {
  console.log("AI Summarizer icon clicked!");
  // Send a message to the already loaded listener.js on the current tab
  chrome.tabs.sendMessage(tab.id, { action: "showOverlay" });
});