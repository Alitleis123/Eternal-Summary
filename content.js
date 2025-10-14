(() => {
  console.log("AI Summarizer content script loaded!");

  // If overlay already exists, remove it
  const existing = document.getElementById("ai-overlay");
  if (existing) {
    existing.remove();
    console.log("AI overlay removed.");
    return;
  }

  // === Overlay ===
  const overlay = document.createElement("div");
  overlay.id = "ai-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    background: "rgba(0, 0, 0, 0)",
    backdropFilter: "blur(0px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999999,
    transition:
      "background-color 1.8s cubic-bezier(0.83, 0, 0.17, 1), backdrop-filter 1.8s cubic-bezier(0.83, 0, 0.17, 1), opacity 1.8s cubic-bezier(0.83, 0, 0.17, 1)",
    opacity: "0",
  });
  document.body.appendChild(overlay);
  overlay.getBoundingClientRect();

  requestAnimationFrame(() => {
    overlay.style.background = "rgba(8, 8, 20, 0.75)";
    overlay.style.backdropFilter = "blur(8px)";
    overlay.style.opacity = "1";
  });

  // === Container ===
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.gap = "1.5rem";
  container.style.textAlign = "center";

  // === Glowing ring ===
  const glowingRing = document.createElement("div");
  glowingRing.id = "glowing-ring";
  Object.assign(glowingRing.style, {
    width: "150px",
    height: "150px",
    borderRadius: "50%",
    position: "relative",
    background: "conic-gradient(from 0deg, #6366f1, #a855f7, #ec4899, #6366f1)",
    backgroundSize: "200% 200%",
    animation: "ringSpin 6s linear infinite, glowShift 3s ease-in-out infinite",
    filter: "drop-shadow(0 0 25px rgba(99,102,241,0.6))",
    opacity: "0",
    transition: "opacity 1.3s cubic-bezier(0.4, 0, 0.2, 1) 0.3s",
  });

  // Inner mask
  const innerMask = document.createElement("div");
  Object.assign(innerMask.style, {
    position: "absolute",
    top: "8px",
    left: "8px",
    right: "8px",
    bottom: "8px",
    borderRadius: "50%",
    background: "rgba(10, 10, 30, 0.9)",
  });
  glowingRing.appendChild(innerMask);

  // === Text (Thinking...) ===
  const text = document.createElement("div");
  text.innerText = "Thinking...";
  Object.assign(text.style, {
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: "1.7rem",
    fontWeight: "600",
    color: "#e0e7ff",
    letterSpacing: "0.5px",
    textShadow: "0 0 15px rgba(99,102,241,0.7)",
    opacity: "0",
    transition: "opacity 1.2s cubic-bezier(0.4, 0, 0.2, 1) 0.6s",
  });

  // === AI Summary Placeholder ===
  const summary = document.createElement("div");
  Object.assign(summary.style, {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: "1.1rem",
    color: "#c7d2fe",
    marginTop: "1rem",
    maxWidth: "600px",
    lineHeight: "1.6",
    opacity: "0",
    transition: "opacity 1s ease-out 0.8s",
    whiteSpace: "pre-wrap",
  });

  container.appendChild(glowingRing);
  container.appendChild(text);
  container.appendChild(summary);
  overlay.appendChild(container);

  // Animate fade-ins
  requestAnimationFrame(() => {
    glowingRing.style.opacity = "1";
    text.style.opacity = "1";
  });

  // === Typewriter effect for AI response ===
  const typeWriter = (el, text, delay = 28) => {
    el.textContent = "";
    let i = 0;
    const type = () => {
      if (i < text.length) {
        el.textContent += text[i++];
        setTimeout(type, delay);
      }
    };
    type();
  };

  // === Fetch summary from backend ===
  setTimeout(async () => {
    text.style.opacity = "0";
    summary.style.opacity = "1";

    try {
      const pageText = document.body.innerText.slice(0, 3000);
      const response = await fetch("https://ai-extension-backend.fly.dev/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pageText }),
      });

      const data = await response.json();
      const aiResponse = data.summary || "No summary received.";
      typeWriter(summary, aiResponse, 22);
    } catch (err) {
      typeWriter(summary, "⚠️ Could not reach the AI server.", 30);
      console.error(err);
    }
  }, 2000);

  // === Click to close ===
  overlay.addEventListener("click", () => {
    overlay.style.opacity = "0";
    overlay.style.backdropFilter = "blur(0px)";
    overlay.style.background = "rgba(0,0,0,0)";
    setTimeout(() => overlay.remove(), 1200);
  });

  // === Keyframes ===
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ringSpin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes glowShift {
      0%, 100% { filter: drop-shadow(0 0 25px rgba(99,102,241,0.6)); }
      50% { filter: drop-shadow(0 0 40px rgba(168,85,247,0.8)); }
    }
  `;
  document.head.appendChild(style);
})();