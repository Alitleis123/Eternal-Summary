chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "showOverlay") {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content.js");
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  }
});