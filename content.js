(() => {
  console.log("AI Summarizer content script loaded!");

  const readJson = async (response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      throw new Error("Non-JSON response");
    }
    return response.json();
  };

  const readSelectionStore = () => {
    const store = document.getElementById("es-selection-store");
    if (!store?.dataset) return null;
    const mode = store.dataset.mode || "";
    const text = store.dataset.text || "";
    let rect = {};
    try {
      rect = store.dataset.rect ? JSON.parse(store.dataset.rect) : {};
    } catch {
      rect = {};
    }
    store.dataset.mode = "";
    return { mode, text, rect };
  };

  const selectionStore = readSelectionStore();

  // If mini overlay already exists, remove it (toggle behavior)
  const existingMini = document.getElementById("ai-overlay-mini");
  if (existingMini) {
    existingMini.remove();
    if (selectionStore?.mode === "selection") return;
  }

  if (selectionStore?.mode === "selection" && selectionStore.text) {
    const selectedText = selectionStore.text;
    const rect = selectionStore.rect || {};

    const mini = document.createElement("div");
    mini.id = "ai-overlay-mini";
    Object.assign(mini.style, {
      position: "fixed",
      zIndex: 1000003,
      maxWidth: "420px",
      width: "min(420px, 86vw)",
      padding: "0.8rem 0.9rem",
      borderRadius: "14px",
      border: "1px solid rgba(199, 210, 254, 0.35)",
      background: "rgba(10, 10, 30, 0.92)",
      color: "#e0e7ff",
      boxShadow: "0 16px 40px rgba(8, 8, 20, 0.45)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      opacity: "0",
      transform: "translateY(8px) scale(0.98)",
      transition: "opacity 0.22s ease, transform 0.22s ease",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      marginBottom: "0.5rem",
    });

    const icon = document.createElement("img");
    icon.src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAEfklEQVRIDe1WW2gcVRg+t7ls9pbU3GpNmprEmBip2ootSsXYPvmg74IIKuiLIEUFfatQRLQoPmigDypFH3wQRIu0aoOCtdI2pRpIE9ONppts0k2ymdndmdmZc47/7G5md8NuW0jok4dh9sx/+/47i+PxmEQSlQ9G/r30rroCoXQkRjgQBlKJUaLgolrALeswEArUi0ZKX8V31bUM4FNK1DKhSsW/An41A+6k1qMN3C34JJX0bIG1OiZIHdqWkv4HuGk6b5QimA+JxM1MQOMHvV9Htj4AFw48jGoKC0vEObekrEWSQnALSU6UJsJ0yQvSc+qYRwgGreaA10K4uzqfHO55Lh4f9IiSsednk99dnf3SLRiEqCAtpUtZtLXv+ea+p0hbN1eEtTaVGf88N3kKE2XD4GJYFVUIUkh+YOitR+49LIgKLhUwsrF0MV1Inz3/xytZYxJjooZ7uva+F+1+TDQpIqxynYoQ4dRb+fWD1ZNHEKHV0051XQsAPOHs7X3h4P1HueQcibR5ZdX6F7EIR5Q1dcXan1hOnRYStw0f1VvuE8gT0raMKddbxZEWwbA2cMDLLjpXf8dUCWxWACDLYb316Yc+0ZSYK+yfLr8xNv76lcRn84s/6tF7aKgL0ZgWHTTNFaR2SswcYyJ17s30+Q+NS1+4xj/6wIhUVbZjKH/ha1mwgkRVALh0ettGHt71Iib0YuL4LxPvQDZgdeVzc6n570PxPVht50gpWNfNpTHPSmX+/qhgJEAGCW7PnqUtnVrfPhxtdhLn3OQEpuXqwrIrRwMRbAvfTRCVgicWzxCiYFiFCOB0r5CZuvSqaSbyuSXC2pGXyc2fEK6JKaQXFijBVLWnzwgoP0Ossw8aJUjRxjb1uxpDY9e0NvSGlZ1JzoxCtbnwmNZbXMPrrvnGJMBI2Jxgzw+7cirbFIJdySdcxAUiOztGoFmLvS+hKTFWotFD+fSfWeMvHNlOm3Yq4X0IUSQ93zT4Kzxt8BCYBr+8pRkACxAqNYCE5N2V/h3PECUSjw3ZXjaTnQK5cFNfR8ezemgASdUyLijte2iolSgxqrQiYUqeh0GL7H8pevA1qSl8LWl+cwR5doBRMweesHf3vvzo7mMOd1yJ0sZ01l4WKGzZGcteNszJpdQojffHH3jXd5GvEYUjjdPObtIzLMIURVjmq8O5Ux9jJVQnAiBBsZYyFzlW4tv2c0wJizP1DkQ1mK2cNZ1aOO56y9xKesaE1v241vUga7uLbe8nrXfKsCYVZJ4+ljv5PmYwBJUyVFJUxAQGXrj+czozjmiIY+bynJmbTiZPzM196rrLGDN4eP6ac+0H4Rok0iJVRXgZZ+4349u382OjiLBgAkpB1KQoiEsIB+QUpRnMea4hhF3cQpXSQWEldzALET0GbS2sDCw+zPTAQnDB8eZYbU8GLOhqv52x/6+jEnKF7d+KG90XqsKulWCNrPtajdXWjcCUNcIuizREXjex2d/KqtispQb6tyGCmq3TwI1NkG9DBJvw7lZUbzWCGyTyBizw4D+pwOK3EPnBoQAAAABJRU5ErkJggg==";
    icon.alt = "";
    Object.assign(icon.style, {
      width: "18px",
      height: "18px",
      borderRadius: "4px",
      boxShadow: "0 0 0 1px rgba(255,255,255,0.2), 0 0 12px rgba(99,102,241,0.45)",
      animation: "miniPulse 1.6s ease-in-out infinite",
    });

    const title = document.createElement("div");
    title.textContent = "Summarize selection";
    Object.assign(title.style, {
      fontSize: "0.9rem",
      fontWeight: "600",
      letterSpacing: "0.2px",
      flex: "1",
    });

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    Object.assign(closeBtn.style, {
      padding: "0.25rem 0.6rem",
      borderRadius: "999px",
      border: "1px solid rgba(199, 210, 254, 0.35)",
      background: "rgba(99, 102, 241, 0.2)",
      color: "#e0e7ff",
      cursor: "pointer",
      fontSize: "0.75rem",
    });
    closeBtn.addEventListener("click", () => mini.remove());

    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    Object.assign(body.style, {
      fontSize: "0.92rem",
      lineHeight: "1.5",
      whiteSpace: "pre-wrap",
    });
    body.textContent = "Thinking…";

    const clarify = document.createElement("div");
    Object.assign(clarify.style, {
      marginTop: "0.6rem",
      display: "none",
      gap: "0.4rem",
      alignItems: "center",
    });

    const clarifyInput = document.createElement("input");
    clarifyInput.type = "text";
    clarifyInput.placeholder = "What should I focus on?";
    Object.assign(clarifyInput.style, {
      flex: "1",
      padding: "0.45rem 0.6rem",
      borderRadius: "999px",
      border: "1px solid rgba(199, 210, 254, 0.35)",
      background: "rgba(10, 10, 30, 0.7)",
      color: "#e0e7ff",
      fontSize: "0.85rem",
      outline: "none",
    });

    const clarifyBtn = document.createElement("button");
    clarifyBtn.textContent = "Ask";
    Object.assign(clarifyBtn.style, {
      padding: "0.45rem 0.7rem",
      borderRadius: "999px",
      border: "none",
      background: "linear-gradient(135deg, #6366f1, #a855f7)",
      color: "#fff",
      fontWeight: "600",
      cursor: "pointer",
      fontSize: "0.8rem",
    });

    clarify.appendChild(clarifyInput);
    clarify.appendChild(clarifyBtn);

    mini.appendChild(header);
    mini.appendChild(body);
    mini.appendChild(clarify);
    document.body.appendChild(mini);

    const positionMini = () => {
      const offset = 12;
      const miniRect = mini.getBoundingClientRect();
      const topCandidate = (rect.top || 0) - miniRect.height - offset;
      let top = topCandidate > 8 ? topCandidate : (rect.bottom || 0) + offset;
      let left = rect.left || 0;
      if (left + miniRect.width > window.innerWidth - 8) {
        left = window.innerWidth - miniRect.width - 8;
      }
      if (left < 8) left = 8;
      mini.style.top = `${Math.round(top)}px`;
      mini.style.left = `${Math.round(left)}px`;
    };

    requestAnimationFrame(() => {
      positionMini();
      mini.style.opacity = "1";
      mini.style.transform = "translateY(0) scale(1)";
    });
    window.addEventListener("scroll", positionMini, { passive: true });
    window.addEventListener("resize", positionMini);

    const style = document.createElement("style");
    style.textContent = `
      @keyframes miniPulse {
        0%, 100% { transform: scale(1); filter: brightness(1); }
        50% { transform: scale(1.08); filter: brightness(1.15); }
      }
    `;
    document.head.appendChild(style);

    const showClarify = (message) => {
      if (message) body.textContent = message;
      clarify.style.display = "flex";
      clarifyInput.focus();
    };

    const askClarify = async () => {
      const question = clarifyInput.value.trim();
      if (!question) return;
      body.textContent = "Thinking…";
      clarifyInput.value = "";
      try {
        const response = await fetch("https://ai-extension-backend.fly.dev/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: selectedText,
            messages: [{ role: "user", content: question }],
            selection: selectedText,
          }),
        });
        const data = await readJson(response);
        body.textContent = data.answer || "No answer received.";
      } catch (err) {
        body.textContent = "⚠️ Could not reach the AI server.";
        console.error(err);
      }
    };

    clarifyBtn.addEventListener("click", askClarify);
    clarifyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") askClarify();
    });

    (async () => {
      try {
        const response = await fetch("https://ai-extension-backend.fly.dev/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: selectedText,
            messages: [
              { role: "user", content: "Summarize and expand on the highlighted text." },
            ],
            selection: selectedText,
          }),
        });
        const data = await readJson(response);
        const answer = data.answer || "";
        body.textContent = answer || "No summary received.";
        const answerWords = answer.trim() ? answer.trim().split(/\s+/).length : 0;
        const selectionWords = selectedText.trim()
          ? selectedText.trim().split(/\s+/).length
          : 0;
        const selectionLooksNonsensical =
          selectionWords > 0 &&
          (!/[a-zA-Z]/.test(selectedText) ||
            (selectedText.match(/[a-zA-Z]{2,}/g)?.length || 0) < 3);
        const needsClarify =
          !answer || answerWords < 10 || selectionWords < 10 || selectionLooksNonsensical;
        if (needsClarify) {
          showClarify("I need a bit more direction. What should I focus on?");
        }
      } catch (err) {
        body.textContent = "⚠️ Could not reach the AI server.";
        console.error(err);
      }
    })();

    return;
  }

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
  container.style.padding = "1.2rem 1.4rem 1.4rem";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  Object.assign(closeBtn.style, {
    position: "fixed",
    top: "18px",
    right: "18px",
    padding: "0.45rem 0.8rem",
    borderRadius: "999px",
    border: "1px solid rgba(199, 210, 254, 0.35)",
    background: "rgba(10, 10, 30, 0.7)",
    color: "#e0e7ff",
    cursor: "pointer",
    fontSize: "0.85rem",
    zIndex: "1000000",
  });
  closeBtn.addEventListener("click", () => overlay.remove());
  overlay.appendChild(closeBtn);

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
  text.innerText = "Thinking";
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
  text.classList.add("thinking");
  const dotsWrap = document.createElement("span");
  dotsWrap.className = "thinking-dots";
  dotsWrap.innerHTML = "<span>.</span><span>.</span><span>.</span>";
  text.appendChild(dotsWrap);

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

  const selectionRow = document.createElement("div");
  Object.assign(selectionRow.style, {
    display: "none",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.5rem 0.8rem",
    borderRadius: "12px",
    border: "1px solid rgba(199, 210, 254, 0.25)",
    background: "rgba(10, 10, 30, 0.7)",
    color: "#c7d2fe",
    fontSize: "0.85rem",
  });

  const selectionText = document.createElement("div");
  selectionText.style.flex = "1";
  selectionText.style.overflow = "hidden";
  selectionText.style.textOverflow = "ellipsis";
  selectionText.style.whiteSpace = "nowrap";

  const askSelectionBtn = document.createElement("button");
  askSelectionBtn.textContent = "Ask about selection";
  Object.assign(askSelectionBtn.style, {
    padding: "0.35rem 0.6rem",
    borderRadius: "999px",
    border: "1px solid rgba(199, 210, 254, 0.35)",
    background: "rgba(99, 102, 241, 0.2)",
    color: "#e0e7ff",
    cursor: "pointer",
    fontSize: "0.8rem",
  });

  selectionRow.appendChild(selectionText);
  selectionRow.appendChild(askSelectionBtn);
  const summarizeSelectionBtn = document.createElement("button");
  summarizeSelectionBtn.textContent = "Summarize selection";
  Object.assign(summarizeSelectionBtn.style, {
    padding: "0.35rem 0.6rem",
    borderRadius: "999px",
    border: "1px solid rgba(199, 210, 254, 0.35)",
    background: "rgba(99, 102, 241, 0.2)",
    color: "#e0e7ff",
    cursor: "pointer",
    fontSize: "0.8rem",
  });
  selectionRow.appendChild(summarizeSelectionBtn);

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
  chatWrap.appendChild(selectionRow);
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
  const typeWriter = (el, textValue, delay = 22) => {
    el.textContent = "";
    let i = 0;
    const type = () => {
      if (i < textValue.length) {
        el.textContent += textValue[i++];
        setTimeout(type, delay);
      }
    };
    type();
  };

  const messages = [];
  const cacheKey = `eternal_summary:${location.href}`;
  let summaryDisplayed = false;

  const readPrecache = () => {
    const cacheEl = document.getElementById("es-cache");
    if (!cacheEl?.dataset?.payload) return null;
    try {
      return JSON.parse(cacheEl.dataset.payload);
    } catch {
      return null;
    }
  };

  const showToast = (label) => {
    const toast = document.createElement("div");
    toast.textContent = label;
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      background: "rgba(10, 10, 30, 0.85)",
      color: "#e0e7ff",
      padding: "0.6rem 0.9rem",
      borderRadius: "10px",
      border: "1px solid rgba(199, 210, 254, 0.25)",
      zIndex: "1000001",
      fontSize: "0.85rem",
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1600);
  };

  const showInputRow = () => {
    if (inputRow.style.opacity === "1") return;
    inputRow.style.opacity = "1";
    inputRow.style.pointerEvents = "auto";
    inputRow.style.transform = "translateY(0)";
  };

  const addSourcesRow = (sources) => {
    if (!Array.isArray(sources) || sources.length === 0) return;
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "0.4rem",
      marginTop: "0.2rem",
    });
    sources.slice(0, 6).forEach((snippet) => {
      const chip = document.createElement("button");
      chip.textContent = snippet.length > 80 ? `${snippet.slice(0, 80)}…` : snippet;
      Object.assign(chip.style, {
        padding: "0.25rem 0.6rem",
        borderRadius: "999px",
        border: "1px solid rgba(199, 210, 254, 0.35)",
        background: "rgba(99, 102, 241, 0.2)",
        color: "#e0e7ff",
        cursor: "pointer",
        fontSize: "0.75rem",
      });
      chip.addEventListener("click", () => {
        const p = findParagraphForSnippet(snippet);
        highlightParagraph(p);
      });
      row.appendChild(chip);
    });
    messagesEl.appendChild(row);
  };

  const addMessage = (role, textValue, typing = false, sources = []) => {
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
    if (sources.length) addSourcesRow(sources);
  };

  const stopThinking = () => {
    text.style.opacity = "0";
  };

  const showRetry = () => {
    const retry = document.createElement("button");
    retry.textContent = "Retry";
    Object.assign(retry.style, {
      marginTop: "0.4rem",
      padding: "0.5rem 0.9rem",
      borderRadius: "999px",
      border: "1px solid rgba(199, 210, 254, 0.35)",
      background: "rgba(10, 10, 30, 0.7)",
      color: "#e0e7ff",
      cursor: "pointer",
    });
    retry.addEventListener("click", () => {
      retry.remove();
      runSummary();
    });
    chatWrap.appendChild(retry);
  };

  const runSummary = async () => {
    chatWrap.style.opacity = "1";
    const pre = readPrecache();
    if (pre?.summary) {
      stopThinking();
      addMessage("assistant", pre.summary, true, pre.sources || []);
      summaryDisplayed = true;
    }

    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed?.summary) {
          stopThinking();
          if (!summaryDisplayed) {
            addMessage("assistant", parsed.summary, true, parsed.sources || []);
            summaryDisplayed = true;
          }
          showToast("Showing cached summary");
        }
      } catch {
        // ignore cache parse errors
      }
    }
    try {
      const pageText = document.body.innerText.slice(0, 3000);
      const response = await fetch("https://ai-extension-backend.fly.dev/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pageText }),
      });

      const data = await readJson(response);
      const aiResponse = data.summary || "No summary received.";
      messages.push({ role: "assistant", content: aiResponse });
      stopThinking();
      if (!summaryDisplayed) {
        addMessage("assistant", aiResponse, true, data.sources || []);
        summaryDisplayed = true;
      }
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ summary: aiResponse, sources: data.sources || [], ts: Date.now() })
      );
    } catch (err) {
      stopThinking();
      addMessage("assistant", "⚠️ Could not reach the AI server.");
      showRetry();
      console.error(err);
    }
  };

  // === Fetch summary from backend ===
  setTimeout(runSummary, 2000);

  let selectedText = "";

  const updateSelection = () => {
    const sel = window.getSelection();
    const textValue = sel ? sel.toString().trim() : "";
    selectedText = textValue;
    if (textValue) {
      selectionText.textContent = `Selected: ${textValue.slice(0, 120)}${
        textValue.length > 120 ? "…" : ""
      }`;
      selectionRow.style.display = "flex";
    } else {
      selectionText.textContent = "";
      selectionRow.style.display = "none";
    }
  };

  document.addEventListener("selectionchange", updateSelection);

  const askQuestion = async (overrideQuestion) => {
    const question = (overrideQuestion || input.value).trim();
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
        body: JSON.stringify({ text: pageText, messages, selection: selectedText }),
      });

      const data = await readJson(response);
      const answer = data.answer || "No answer received.";
      messages.push({ role: "assistant", content: answer });
      addMessage("assistant", answer, true, data.sources || []);
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
  askSelectionBtn.addEventListener("click", () => {
    const prompt = "Explain the highlighted text.";
    askQuestion(prompt);
  });
  summarizeSelectionBtn.addEventListener("click", async () => {
    if (!selectedText) return;
    addMessage("user", "Summarize the highlighted text.");
    messages.push({ role: "user", content: "Summarize the highlighted text." });

    sendBtn.disabled = true;
    input.disabled = true;
    sendBtn.style.opacity = "0.6";

    try {
      const response = await fetch("https://ai-extension-backend.fly.dev/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: selectedText }),
      });

      const data = await readJson(response);
      const aiResponse = data.summary || "No summary received.";
      messages.push({ role: "assistant", content: aiResponse });
      addMessage("assistant", aiResponse, true, data.sources || []);
    } catch (err) {
      addMessage("assistant", "⚠️ Could not reach the AI server.");
      console.error(err);
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      sendBtn.style.opacity = "1";
      input.focus();
    }
  });


  // No click-to-close. Use Close button or Esc.

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") overlay.remove();
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
    #ai-overlay .thinking-dots {
      display: inline-flex;
      gap: 0.2em;
      margin-left: 0.2em;
      vertical-align: bottom;
    }
    #ai-overlay .thinking-dots span {
      display: inline-block;
      opacity: 0.15;
      transform: translateY(0);
      animation: dotPulse 1.25s cubic-bezier(0.45, 0, 0.55, 1) infinite;
      will-change: transform, opacity;
    }
    #ai-overlay .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    #ai-overlay .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dotPulse {
      0% { opacity: 0.2; transform: translateY(0); }
      35% { opacity: 0.95; transform: translateY(-2px); }
      60% { opacity: 0.45; transform: translateY(0); }
      100% { opacity: 0.2; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
})();
