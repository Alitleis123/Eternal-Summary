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

  // === Chat Container ===
  const chatWrap = document.createElement("div");
  Object.assign(chatWrap.style, {
    display: "flex",
    flexDirection: "column",
    gap: "0.9rem",
    width: "min(720px, 86vw)",
    maxHeight: "52vh",
    overflow: "hidden",
    opacity: "0",
    transition: "opacity 1s ease-out 0.8s",
  });

  const messagesEl = document.createElement("div");
  Object.assign(messagesEl.style, {
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    padding: "0.4rem 0.2rem",
    overflowY: "auto",
    maxHeight: "40vh",
  });

  const inputRow = document.createElement("div");
  Object.assign(inputRow.style, {
    display: "flex",
    gap: "0.6rem",
    alignItems: "center",
    opacity: "0",
    pointerEvents: "none",
    transform: "translateY(6px)",
    transition: "opacity 0.4s ease, transform 0.4s ease",
  });

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Ask a question about this page...";
  Object.assign(input.style, {
    flex: "1",
    padding: "0.7rem 0.9rem",
    borderRadius: "999px",
    border: "1px solid rgba(199, 210, 254, 0.35)",
    background: "rgba(10, 10, 30, 0.7)",
    color: "#e0e7ff",
    fontSize: "0.95rem",
    outline: "none",
  });

  const sendBtn = document.createElement("button");
  sendBtn.textContent = "Send";
  Object.assign(sendBtn.style, {
    padding: "0.7rem 1.1rem",
    borderRadius: "999px",
    border: "none",
    cursor: "pointer",
    background: "linear-gradient(135deg, #6366f1, #a855f7)",
    color: "#fff",
    fontWeight: "600",
    letterSpacing: "0.2px",
  });

  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  chatWrap.appendChild(messagesEl);
  chatWrap.appendChild(inputRow);

  container.appendChild(glowingRing);
  container.appendChild(text);
  container.appendChild(chatWrap);
  overlay.appendChild(container);

  // Animate fade-ins
  requestAnimationFrame(() => {
    glowingRing.style.opacity = "1";
    text.style.opacity = "1";
  });

  // === Typewriter effect for AI response ===
  const typeWriter = (el, text, delay = 22) => {
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

  const messages = [];

  const showInputRow = () => {
    if (inputRow.style.opacity === "1") return;
    inputRow.style.opacity = "1";
    inputRow.style.pointerEvents = "auto";
    inputRow.style.transform = "translateY(0)";
  };

  const addMessage = (role, textValue, typing = false) => {
    const bubble = document.createElement("div");
    Object.assign(bubble.style, {
      alignSelf: role === "user" ? "flex-end" : "flex-start",
      background:
        role === "user"
          ? "rgba(99, 102, 241, 0.25)"
          : "rgba(17, 24, 39, 0.65)",
      color: "#e0e7ff",
      padding: "0.6rem 0.9rem",
      borderRadius: "14px",
      maxWidth: "86%",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: "0.98rem",
      lineHeight: "1.5",
      whiteSpace: "pre-wrap",
      boxShadow: "0 10px 30px rgba(8,8,20,0.25)",
    });

    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (typing) {
      showInputRow();
      typeWriter(bubble, textValue, 16);
    } else {
      bubble.textContent = textValue;
    }
  };

  // === Fetch summary from backend ===
  setTimeout(async () => {
    text.style.opacity = "0";
    chatWrap.style.opacity = "1";

    try {
      const pageText = document.body.innerText.slice(0, 3000);
      const response = await fetch("https://ai-extension-backend.fly.dev/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pageText }),
      });

      const data = await response.json();
      const aiResponse = data.summary || "No summary received.";
      messages.push({ role: "assistant", content: aiResponse });
      addMessage("assistant", aiResponse, true);
    } catch (err) {
      addMessage("assistant", "⚠️ Could not reach the AI server.");
      console.error(err);
    }
  }, 2000);

  const askQuestion = async () => {
    const question = input.value.trim();
    if (!question) return;

    input.value = "";
    addMessage("user", question);
    messages.push({ role: "user", content: question });

    sendBtn.disabled = true;
    input.disabled = true;
    sendBtn.style.opacity = "0.6";

    try {
      const pageText = document.body.innerText.slice(0, 3000);
      const response = await fetch("https://ai-extension-backend.fly.dev/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pageText, messages }),
      });

      const data = await response.json();
      const answer = data.answer || "No answer received.";
      messages.push({ role: "assistant", content: answer });
      addMessage("assistant", answer, true);
    } catch (err) {
      addMessage("assistant", "⚠️ Could not reach the AI server.");
      console.error(err);
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      sendBtn.style.opacity = "1";
      input.focus();
    }
  };

  sendBtn.addEventListener("click", askQuestion);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") askQuestion();
  });

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
