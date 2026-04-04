(() => {
  console.log("AI Summarizer content script loaded!");

  const readJson = async (response) => {
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.code = "http";
      err.status = response.status;
      throw err;
    }
    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const err = new Error("Non-JSON response");
      err.code = "non_json";
      throw err;
    }
    return response.json();
  };

  const fetchJsonWithTimeout = (url, options = {}, timeoutMs = 15000) => {
    const requestId = `es_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ ok: false, error: { name: "AbortError" } });
      }, timeoutMs);

      const onMessage = (event) => {
        const msg = event.data;
        if (!msg || msg.type !== "ES_API_RESPONSE" || msg.requestId !== requestId) return;
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        const result = msg.result || {};
        if (result.ok && result.data) {
          resolve({ ok: true, data: result.data });
          return;
        }
        if (result.ok && !result.data) {
          const err = new Error("Non-JSON response");
          err.code = "non_json";
          resolve({ ok: false, error: err });
          return;
        }
        const err = new Error(result.error || "Request failed");
        err.code = result.status ? "http" : "network";
        err.status = result.status;
        resolve({ ok: false, error: err });
      };

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          type: "ES_API_REQUEST",
          requestId,
          url,
          options,
        },
        "*"
      );
    });
  };

  const friendlyFetchError = (err) => {
    if (err?.name === "AbortError") return "Request timed out. Try again.";
    if (err?.code === "http") return "Server error. Try again shortly.";
    if (err?.code === "non_json") return "Server returned an unexpected response.";
    return "Could not reach the AI server.";
  };

  // === Typewriter effect ===
  const typeWriter = (el, textValue, delay = 18, onResize) => {
    el.textContent = "";
    let i = 0;
    let lastHeight = 0;
    const type = () => {
      if (i < textValue.length) {
        el.textContent += textValue[i++];
        // Only reposition when height changes (new line)
        if (onResize) {
          const h = el.scrollHeight;
          if (h !== lastHeight) {
            lastHeight = h;
            onResize();
          }
        }
        setTimeout(type, delay);
      }
    };
    type();
  };

  const readSelectionStore = () => {
    const store = document.getElementById("es-selection-store");
    if (!store?.dataset) return null;
    const mode = store.dataset.mode || "";
    const text = store.dataset.text || "";
    const anchorId = store.dataset.anchorId || "";
    let anchorOffset = null;
    try {
      anchorOffset = store.dataset.anchorOffset
        ? JSON.parse(store.dataset.anchorOffset)
        : null;
    } catch {
      anchorOffset = null;
    }
    let rect = {};
    try {
      rect = store.dataset.rect ? JSON.parse(store.dataset.rect) : {};
    } catch {
      rect = {};
    }
    store.dataset.mode = "";
    return { mode, text, rect, anchorId, anchorOffset };
  };

  const selectionStore = readSelectionStore();

  const existingMini = document.getElementById("ai-overlay-mini");
  if (existingMini) {
    existingMini.remove();
    if (selectionStore?.mode === "selection") return;
  }

  // =============================================
  // === SELECTION POPUP (expanded inline card) ===
  // =============================================
  const expandSelectionPopup = (selectedText, rect, anchorId, anchorOffset) => {
    const popup = document.getElementById("es-selection-popup");
    if (!popup) return null;

    if (!popup.__esOriginalChildren) {
      popup.__esOriginalChildren = Array.from(popup.childNodes);
      popup.__esOriginalStyle = popup.getAttribute("style") || "";
    }

    popup.dataset.expanded = "true";
    popup.replaceChildren();
    Object.assign(popup.style, {
      position: "absolute",
      zIndex: 1000003,
      maxWidth: "460px",
      width: "min(460px, 86vw)",
      padding: "0",
      borderRadius: "16px",
      border: "1px solid rgba(199, 210, 254, 0.25)",
      background: "rgba(10, 10, 30, 0.95)",
      color: "#e0e7ff",
      boxShadow: "0 20px 50px rgba(8, 8, 20, 0.55), 0 0 0 1px rgba(99, 102, 241, 0.1)",
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
      display: "flex",
      flexDirection: "column",
      gap: "0",
      alignItems: "stretch",
      opacity: "0",
      transform: "translateY(8px) scale(0.97)",
      transition: "opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      overflow: "hidden",
    });

    // Header bar
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      padding: "0.7rem 0.85rem",
      borderBottom: "1px solid rgba(199, 210, 254, 0.12)",
      background: "rgba(99, 102, 241, 0.06)",
    });

    const icon = document.createElement("img");
    icon.src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAEfklEQVRIDe1WW2gcVRg+t7ls9pbU3GpNmprEmBip2ootSsXYPvmg74IIKuiLIEUFfatQRLQoPmigDypFH3wQRIu0aoOCtdI2pRpIE9ONppts0k2ymdndmdmZc47/7G5md8NuW0jok4dh9sx/+/47i+PxmEQSlQ9G/r30rroCoXQkRjgQBlKJUaLgolrALeswEArUi0ZKX8V31bUM4FNK1DKhSsW/An41A+6k1qMN3C34JJX0bIG1OiZIHdqWkv4HuGk6b5QimA+JxM1MQOMHvV9Htj4AFw48jGoKC0vEObekrEWSQnALSU6UJsJ0yQvSc+qYRwgGreaA10K4uzqfHO55Lh4f9IiSsednk99dnf3SLRiEqCAtpUtZtLXv+ea+p0hbN1eEtTaVGf88N3kKE2XD4GJYFVUIUkh+YOitR+49LIgKLhUwsrF0MV1Inz3/xytZYxJjooZ7uva+F+1+TDQpIqxynYoQ4dRb+fWD1ZNHEKHV0051XQsAPOHs7X3h4P1HueQcibR5ZdX6F7EIR5Q1dcXan1hOnRYStw0f1VvuE8gT0raMKddbxZEWwbA2cMDLLjpXf8dUCWxWACDLYb316Yc+0ZSYK+yfLr8xNv76lcRn84s/6tF7aKgL0ZgWHTTNFaR2SswcYyJ17s30+Q+NS1+4xj/6wIhUVbZjKH/ha1mwgkRVALh0ettGHt71Iib0YuL4LxPvQDZgdeVzc6n570PxPVht50gpWNfNpTHPSmX+/qhgJEAGCW7PnqUtnVrfPhxtdhLn3OQEpuXqwrIrRwMRbAvfTRCVgicWzxCiYFiFCOB0r5CZuvSqaSbyuSXC2pGXyc2fEK6JKaQXFijBVLWnzwgoP0Ossw8aJUjRxjb1uxpDY9e0NvSGlZ1JzoxCtbnwmNZbXMPrrvnGJMBI2Jxgzw+7cirbFIJdySdcxAUiOztGoFmLvS+hKTFWotFD+fSfWeMvHNlOm3Yq4X0IUSQ93zT4Kzxt8BCYBr+8pRkACxAqNYCE5N2V/h3PECUSjw3ZXjaTnQK5cFNfR8ezemgASdUyLijte2iolSgxqrQiYUqeh0GL7H8pevA1qSl8LWl+cwR5doBRMweesHf3vvzo7mMOd1yJ0sZ01l4WKGzZGcteNszJpdQojffHH3jXd5GvEYUjjdPObtIzLMIURVjmq8O5Ux9jJVQnAiBBsZYyFzlW4tv2c0wJizP1DkQ1mK2cNZ1aOO56y9xKesaE1v241vUga7uLbe8nrXfKsCYVZJ4+ljv5PmYwBJUyVFJUxAQGXrj+czozjmiIY+bynJmbTiZPzM196rrLGDN4eP6ac+0H4Rok0iJVRXgZZ+4349u382OjiLBgAkpB1KQoiEsIB+QUpRnMea4hhF3cQpXSQWEldzALET0GbS2sDCw+zPTAQnDB8eZYbU8GLOhqv52x/6+jEnKF7d+KG90XqsKulWCNrPtajdXWjcCUNcIuizREXjex2d/KqtispQb6tyGCmq3TwI1NkG9DBJvw7lZUbzWCGyTyBizw4D+pwOK3EPnBoQAAAABJRU5ErkJggg==";
    icon.alt = "";
    Object.assign(icon.style, {
      width: "18px",
      height: "18px",
      borderRadius: "4px",
      boxShadow: "0 0 0 1px rgba(255,255,255,0.15), 0 0 10px rgba(99,102,241,0.35)",
    });

    const title = document.createElement("div");
    title.textContent = "Selection Summary";
    Object.assign(title.style, {
      fontSize: "0.82rem",
      fontWeight: "600",
      letterSpacing: "0.3px",
      flex: "1",
      opacity: "0.9",
    });

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    Object.assign(closeBtn.style, {
      width: "28px",
      height: "28px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "50%",
      border: "1px solid rgba(199, 210, 254, 0.2)",
      background: "transparent",
      color: "#a5b4fc",
      cursor: "pointer",
      transition: "all 0.2s ease",
    });
    closeBtn.addEventListener("mouseenter", () => {
      closeBtn.style.background = "rgba(239, 68, 68, 0.15)";
      closeBtn.style.borderColor = "rgba(239, 68, 68, 0.4)";
      closeBtn.style.color = "#f87171";
    });
    closeBtn.addEventListener("mouseleave", () => {
      closeBtn.style.background = "transparent";
      closeBtn.style.borderColor = "rgba(199, 210, 254, 0.2)";
      closeBtn.style.color = "#a5b4fc";
    });

    const restorePopup = () => {
      if (popup.__esCleanup) popup.__esCleanup();
      if (anchorId) {
        const anchor = document.getElementById(anchorId);
        if (anchor) anchor.remove();
      }
      window.postMessage({ type: "ES_RESTORE_SELECTION_POPUP" }, "*");
    };
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      restorePopup();
    });

    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement("div");
    Object.assign(body.style, {
      fontSize: "0.9rem",
      lineHeight: "1.6",
      whiteSpace: "pre-wrap",
      padding: "0.85rem 0.95rem",
      maxHeight: "250px",
      overflowY: "auto",
    });
    body.textContent = "";

    // Thinking indicator
    const thinkingDots = document.createElement("div");
    thinkingDots.className = "es-thinking-indicator";
    thinkingDots.innerHTML = `<span></span><span></span><span></span>`;
    body.appendChild(thinkingDots);

    // Clarify row
    const clarify = document.createElement("div");
    Object.assign(clarify.style, {
      display: "none",
      gap: "0.4rem",
      alignItems: "center",
      padding: "0 0.85rem 0.75rem",
    });

    const clarifyInput = document.createElement("input");
    clarifyInput.type = "text";
    clarifyInput.placeholder = "Ask a follow-up...";
    Object.assign(clarifyInput.style, {
      flex: "1",
      padding: "0.5rem 0.7rem",
      borderRadius: "10px",
      border: "1px solid rgba(199, 210, 254, 0.2)",
      background: "rgba(10, 10, 30, 0.6)",
      color: "#e0e7ff",
      fontSize: "0.82rem",
      outline: "none",
      transition: "border-color 0.2s ease",
    });
    clarifyInput.addEventListener("focus", () => { clarifyInput.style.borderColor = "rgba(99, 102, 241, 0.5)"; });
    clarifyInput.addEventListener("blur", () => { clarifyInput.style.borderColor = "rgba(199, 210, 254, 0.2)"; });

    const clarifyBtn = document.createElement("button");
    clarifyBtn.textContent = "Ask";
    Object.assign(clarifyBtn.style, {
      padding: "0.5rem 0.75rem",
      borderRadius: "10px",
      border: "none",
      background: "linear-gradient(135deg, #6366f1, #a855f7)",
      color: "#fff",
      fontWeight: "600",
      cursor: "pointer",
      fontSize: "0.8rem",
      transition: "opacity 0.2s ease, transform 0.15s ease",
    });
    clarifyBtn.addEventListener("mouseenter", () => { clarifyBtn.style.transform = "scale(1.03)"; });
    clarifyBtn.addEventListener("mouseleave", () => { clarifyBtn.style.transform = "scale(1)"; });

    clarify.appendChild(clarifyInput);
    clarify.appendChild(clarifyBtn);

    popup.appendChild(header);
    popup.appendChild(body);
    popup.appendChild(clarify);

    // === Scroll tracking: keep popup anchored to highlighted text ===
    const positionPopup = () => {
      const offset = 12;
      const popupRect = popup.getBoundingClientRect();
      const scrollY = window.scrollY || window.pageYOffset || 0;
      const scrollX = window.scrollX || window.pageXOffset || 0;
      let baseRect = rect || {};
      if (anchorId) {
        const anchor = document.getElementById(anchorId);
        if (anchor) {
          const r = anchor.getBoundingClientRect();
          if (anchorOffset) {
            baseRect = {
              top: r.top + (anchorOffset.top || 0),
              bottom: r.top + (anchorOffset.bottom || 0),
              left: r.left + (anchorOffset.left || 0),
            };
          } else {
            baseRect = { top: r.top, bottom: r.bottom, left: r.left };
          }
        }
      }
      const docTop = (baseRect.top || 0) + scrollY;
      const docBottom = (baseRect.bottom || 0) + scrollY;
      const docLeft = (baseRect.left || 0) + scrollX;
      const topCandidate = docTop - popupRect.height - offset;
      let top = topCandidate > scrollY + 8 ? topCandidate : docBottom + offset;
      let left = docLeft;
      const viewportRight = (window.innerWidth - 8) + scrollX;
      if (left + popupRect.width > viewportRight) {
        left = viewportRight - popupRect.width;
      }
      if (left < scrollX + 8) left = scrollX + 8;
      popup.style.top = `${Math.round(top)}px`;
      popup.style.left = `${Math.round(left)}px`;
    };

    requestAnimationFrame(() => {
      positionPopup();
      popup.style.opacity = "1";
      popup.style.transform = "translateY(0) scale(1)";
    });

    // Smooth scroll tracking with RAF
    let rafId = 0;
    const onScroll = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        positionPopup();
      });
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    popup.__esCleanup = () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };

    // Inject styles for thinking indicator
    const style = document.createElement("style");
    style.textContent = `
      .es-thinking-indicator {
        display: inline-flex;
        gap: 4px;
        padding: 4px 0;
      }
      .es-thinking-indicator span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #6366f1;
        animation: esDotBounce 1.2s ease-in-out infinite;
      }
      .es-thinking-indicator span:nth-child(2) { animation-delay: 0.15s; }
      .es-thinking-indicator span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes esDotBounce {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30% { transform: translateY(-6px); opacity: 1; }
      }
    `;
    document.head.appendChild(style);

    const showClarify = (message) => {
      if (message) {
        thinkingDots.remove();
        typeWriter(body, message, 16, positionPopup);
      }
      clarify.style.display = "flex";
      requestAnimationFrame(positionPopup);
      setTimeout(() => {
        positionPopup();
        clarifyInput.focus();
      }, 300);
    };

    const askClarify = async () => {
      if (popup.dataset.busy === "true") return;
      popup.dataset.busy = "true";
      clarifyBtn.disabled = true;
      const question = clarifyInput.value.trim();
      if (!question) {
        popup.dataset.busy = "false";
        clarifyBtn.disabled = false;
        return;
      }
      body.textContent = "";
      body.appendChild(thinkingDots);
      clarifyInput.value = "";
      const { ok, data, error } = await fetchJsonWithTimeout(
        "https://ai-extension-backend-twilight-forest-3247.fly.dev/api/ask",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: selectedText,
            messages: [{ role: "user", content: question }],
            selection: selectedText,
          }),
        }
      );
      if (ok) {
        thinkingDots.remove();
        typeWriter(body, data.answer || "No answer received.", 16, positionPopup);
        popup.dataset.busy = "false";
        clarifyBtn.disabled = false;
        return;
      }
      thinkingDots.remove();
      body.textContent = friendlyFetchError(error);
      console.error("Ask failed:", error);
      popup.dataset.busy = "false";
      clarifyBtn.disabled = false;
    };

    clarifyBtn.addEventListener("click", askClarify);
    clarifyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") askClarify();
    });

    // Detect garbled AI output (shuffled characters)
    const looksGarbled = (text) => {
      if (!text || text.length < 20) return false;
      const words = text.split(/\s+/).filter(w => w.length > 2);
      if (words.length < 3) return false;
      // Common English short words — if most words don't match any, it's garbled
      const common = new Set(["the","be","to","of","and","a","in","that","have","i","it","for","not","on","with","he","as","you","do","at","this","but","his","by","from","they","we","her","she","or","an","will","my","one","all","would","there","their","what","so","up","out","if","about","who","get","which","go","me","when","make","can","like","time","no","just","him","know","take","people","into","year","your","good","some","could","them","see","other","than","then","now","look","only","come","its","over","think","also","back","after","use","two","how","our","work","first","well","way","even","new","want","because","any","these","give","day","most","us","was","is","are","were","been","has","had","did","said","does","may","should","each","much","before","between","being","same","made","find","here","many","through","long","very","own","still","high","last","since","both","might","came","right","got","old","while"]);
      let garbledCount = 0;
      for (const w of words) {
        const lower = w.toLowerCase().replace(/[^a-z]/g, "");
        if (lower.length > 2 && !common.has(lower)) {
          // Check if it looks like a real word (has vowels + consonants in normal pattern)
          const vowelRatio = (lower.match(/[aeiou]/g) || []).length / lower.length;
          if (vowelRatio < 0.15 || vowelRatio > 0.7) garbledCount++;
          // Check for too many consonant clusters
          if (/[bcdfghjklmnpqrstvwxyz]{4,}/i.test(lower)) garbledCount++;
        }
      }
      return garbledCount / words.length > 0.3;
    };

    // Auto-summarize selection with typing effect
    const runSelectionSummary = async (retryCount = 0) => {
      if (popup.dataset.busy === "true" && retryCount === 0) return;
      popup.dataset.busy = "true";
      const { ok, data, error } = await fetchJsonWithTimeout(
        "https://ai-extension-backend-twilight-forest-3247.fly.dev/api/summarize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: selectedText,
          }),
        }
      );
      if (!ok) {
        thinkingDots.remove();
        body.textContent = friendlyFetchError(error);
        console.error("Auto-summarize failed:", error);
        popup.dataset.busy = "false";
        return;
      }
      let answer = data.summary || "";

      // If garbled, retry once
      if (looksGarbled(answer) && retryCount < 1) {
        console.warn("Garbled response detected, retrying...");
        body.textContent = "";
        body.appendChild(thinkingDots);
        return runSelectionSummary(retryCount + 1);
      }
      thinkingDots.remove();
      typeWriter(body, answer || "No summary received.", 16, positionPopup);
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
        requestAnimationFrame(positionPopup);
      } else {
        setTimeout(() => {
          clarify.style.display = "flex";
          requestAnimationFrame(positionPopup);
        }, answer.length * 16 + 200);
      }
      popup.dataset.busy = "false";
    };
    runSelectionSummary();

    return { body, clarify };
  };

  // If overlay already exists and this is NOT a selection request, toggle it off
  const existing = document.getElementById("ai-overlay");
  if (existing && !(selectionStore?.mode === "selection" && selectionStore.text)) {
    existing.remove();
    console.log("AI overlay removed.");
    return;
  }
  // Remove overlay if open so selection popup can work cleanly
  if (existing) existing.remove();

  if (selectionStore?.mode === "selection" && selectionStore.text) {
    const selectedText = selectionStore.text;
    const rect = selectionStore.rect || {};
    const anchorId = selectionStore.anchorId || "";
    const anchorOffset = selectionStore.anchorOffset || null;
    const expanded = expandSelectionPopup(selectedText, rect, anchorId, anchorOffset);
    if (expanded) return;
  }

  // =============================================
  // === MAIN OVERLAY ===
  // =============================================
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
    transition: "background-color 0.8s cubic-bezier(0.16, 1, 0.3, 1), backdrop-filter 0.8s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
    opacity: "0",
  });
  document.body.appendChild(overlay);
  overlay.getBoundingClientRect();

  requestAnimationFrame(() => {
    overlay.style.background = "rgba(6, 6, 15, 0.82)";
    overlay.style.backdropFilter = "blur(12px)";
    overlay.style.opacity = "1";
  });

  // === Container ===
  const container = document.createElement("div");
  Object.assign(container.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1.5rem",
    textAlign: "center",
    padding: "1.2rem 1.4rem 1.4rem",
    opacity: "0",
    transform: "translateY(20px) scale(0.97)",
    transition: "opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.15s, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.15s",
  });
  requestAnimationFrame(() => {
    container.style.opacity = "1";
    container.style.transform = "translateY(0) scale(1)";
  });

  // === Close button (X) ===
  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  Object.assign(closeBtn.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    width: "40px",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    border: "1px solid rgba(199, 210, 254, 0.25)",
    background: "rgba(10, 10, 30, 0.6)",
    color: "#a5b4fc",
    cursor: "pointer",
    zIndex: "1000000",
    backdropFilter: "blur(8px)",
    transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
    opacity: "0",
    transform: "scale(0.8)",
  });
  requestAnimationFrame(() => {
    setTimeout(() => {
      closeBtn.style.opacity = "1";
      closeBtn.style.transform = "scale(1)";
    }, 300);
  });
  closeBtn.addEventListener("mouseenter", () => {
    closeBtn.style.background = "rgba(239, 68, 68, 0.15)";
    closeBtn.style.borderColor = "rgba(239, 68, 68, 0.5)";
    closeBtn.style.color = "#f87171";
    closeBtn.style.transform = "scale(1.1)";
  });
  closeBtn.addEventListener("mouseleave", () => {
    closeBtn.style.background = "rgba(10, 10, 30, 0.6)";
    closeBtn.style.borderColor = "rgba(199, 210, 254, 0.25)";
    closeBtn.style.color = "#a5b4fc";
    closeBtn.style.transform = "scale(1)";
  });
  closeBtn.addEventListener("click", () => {
    overlay.style.opacity = "0";
    overlay.style.backdropFilter = "blur(0px)";
    container.style.opacity = "0";
    container.style.transform = "translateY(10px) scale(0.97)";
    setTimeout(() => overlay.remove(), 400);
  });
  overlay.appendChild(closeBtn);

  // === Glowing ring ===
  const glowingRing = document.createElement("div");
  glowingRing.id = "glowing-ring";
  Object.assign(glowingRing.style, {
    width: "130px",
    height: "130px",
    borderRadius: "50%",
    position: "relative",
    background: "conic-gradient(from 0deg, #6366f1, #a855f7, #ec4899, #6366f1)",
    animation: "ringSpin 4s linear infinite",
    filter: "drop-shadow(0 0 30px rgba(99,102,241,0.5))",
    opacity: "0",
    transition: "opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s",
  });

  const innerMask = document.createElement("div");
  Object.assign(innerMask.style, {
    position: "absolute",
    top: "7px",
    left: "7px",
    right: "7px",
    bottom: "7px",
    borderRadius: "50%",
    background: "rgba(6, 6, 15, 0.95)",
  });
  glowingRing.appendChild(innerMask);

  // === Thinking text ===
  const text = document.createElement("div");
  text.innerText = "Thinking";
  Object.assign(text.style, {
    fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: "1.5rem",
    fontWeight: "600",
    color: "#e0e7ff",
    letterSpacing: "0.5px",
    textShadow: "0 0 20px rgba(99,102,241,0.5)",
    opacity: "0",
    transition: "opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.4s",
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
    gap: "0.7rem",
    width: "min(680px, 88vw)",
    maxHeight: "55vh",
    overflow: "hidden",
    opacity: "0",
    transform: "translateY(12px)",
    transition: "opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
  });

  const messagesEl = document.createElement("div");
  Object.assign(messagesEl.style, {
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    padding: "0.4rem 0.2rem",
    overflowY: "auto",
    maxHeight: "42vh",
    scrollBehavior: "smooth",
  });

  const selectionRow = document.createElement("div");
  Object.assign(selectionRow.style, {
    display: "none",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.5rem 0.8rem",
    borderRadius: "12px",
    border: "1px solid rgba(199, 210, 254, 0.2)",
    background: "rgba(10, 10, 30, 0.6)",
    color: "#c7d2fe",
    fontSize: "0.85rem",
    transition: "all 0.3s ease",
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
    border: "1px solid rgba(199, 210, 254, 0.25)",
    background: "rgba(99, 102, 241, 0.15)",
    color: "#e0e7ff",
    cursor: "pointer",
    fontSize: "0.8rem",
    transition: "all 0.2s ease",
  });

  selectionRow.appendChild(selectionText);
  selectionRow.appendChild(askSelectionBtn);
  const summarizeSelectionBtn = document.createElement("button");
  summarizeSelectionBtn.textContent = "Summarize selection";
  Object.assign(summarizeSelectionBtn.style, {
    padding: "0.35rem 0.6rem",
    borderRadius: "999px",
    border: "1px solid rgba(199, 210, 254, 0.25)",
    background: "rgba(99, 102, 241, 0.15)",
    color: "#e0e7ff",
    cursor: "pointer",
    fontSize: "0.8rem",
    transition: "all 0.2s ease",
  });
  selectionRow.appendChild(summarizeSelectionBtn);

  // === Input row ===
  const inputRow = document.createElement("div");
  Object.assign(inputRow.style, {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    opacity: "0",
    pointerEvents: "none",
    transform: "translateY(8px)",
    transition: "opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1), transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
  });

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Ask a question about this page...";
  Object.assign(input.style, {
    flex: "1",
    padding: "0.75rem 1rem",
    borderRadius: "14px",
    border: "1px solid rgba(199, 210, 254, 0.2)",
    background: "rgba(10, 10, 30, 0.6)",
    color: "#e0e7ff",
    fontSize: "0.92rem",
    outline: "none",
    transition: "border-color 0.25s ease, box-shadow 0.25s ease",
    fontFamily: "'Inter', system-ui, sans-serif",
  });
  input.addEventListener("focus", () => {
    input.style.borderColor = "rgba(99, 102, 241, 0.5)";
    input.style.boxShadow = "0 0 0 3px rgba(99, 102, 241, 0.1)";
  });
  input.addEventListener("blur", () => {
    input.style.borderColor = "rgba(199, 210, 254, 0.2)";
    input.style.boxShadow = "none";
  });

  const sendBtn = document.createElement("button");
  sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  Object.assign(sendBtn.style, {
    width: "44px",
    height: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "14px",
    border: "none",
    cursor: "pointer",
    background: "linear-gradient(135deg, #6366f1, #a855f7)",
    color: "#fff",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    boxShadow: "0 4px 16px rgba(99, 102, 241, 0.3)",
    flexShrink: "0",
  });
  sendBtn.addEventListener("mouseenter", () => {
    sendBtn.style.transform = "scale(1.05)";
    sendBtn.style.boxShadow = "0 6px 24px rgba(99, 102, 241, 0.45)";
  });
  sendBtn.addEventListener("mouseleave", () => {
    sendBtn.style.transform = "scale(1)";
    sendBtn.style.boxShadow = "0 4px 16px rgba(99, 102, 241, 0.3)";
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
      background: "rgba(10, 10, 30, 0.9)",
      color: "#a5b4fc",
      padding: "0.6rem 1rem",
      borderRadius: "12px",
      border: "1px solid rgba(99, 102, 241, 0.2)",
      zIndex: "1000001",
      fontSize: "0.82rem",
      backdropFilter: "blur(8px)",
      opacity: "0",
      transform: "translateY(8px)",
      transition: "opacity 0.3s ease, transform 0.3s ease",
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      setTimeout(() => toast.remove(), 300);
    }, 1600);
  };

  const showInputRow = () => {
    if (inputRow.style.opacity === "1") return;
    inputRow.style.opacity = "1";
    inputRow.style.pointerEvents = "auto";
    inputRow.style.transform = "translateY(0)";
  };

  // === Collapsible Sources dropdown ===
  const addSourcesRow = (sources) => {
    if (!Array.isArray(sources) || sources.length === 0) return;

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      marginTop: "0.3rem",
      opacity: "0",
      transform: "translateY(4px)",
      transition: "opacity 0.4s ease, transform 0.4s ease",
    });
    requestAnimationFrame(() => {
      wrapper.style.opacity = "1";
      wrapper.style.transform = "translateY(0)";
    });

    const toggle = document.createElement("button");
    toggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.25s cubic-bezier(0.16,1,0.3,1)"><path d="M9 18l6-6-6-6"/></svg><span style="margin-left:5px">Sources (${sources.length})</span>`;
    Object.assign(toggle.style, {
      display: "inline-flex",
      alignItems: "center",
      padding: "0.35rem 0.75rem",
      borderRadius: "10px",
      border: "1px solid rgba(199, 210, 254, 0.2)",
      background: "rgba(99, 102, 241, 0.1)",
      color: "#a5b4fc",
      cursor: "pointer",
      fontSize: "0.78rem",
      fontWeight: "500",
      fontFamily: "'Inter', system-ui, sans-serif",
      transition: "all 0.25s ease",
    });
    toggle.addEventListener("mouseenter", () => {
      toggle.style.background = "rgba(99, 102, 241, 0.2)";
      toggle.style.borderColor = "rgba(99, 102, 241, 0.4)";
    });
    toggle.addEventListener("mouseleave", () => {
      if (!expanded) {
        toggle.style.background = "rgba(99, 102, 241, 0.1)";
        toggle.style.borderColor = "rgba(199, 210, 254, 0.2)";
      }
    });

    const chipContainer = document.createElement("div");
    Object.assign(chipContainer.style, {
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: "0.35rem",
      marginTop: "0.5rem",
      padding: "0.6rem",
      borderRadius: "12px",
      background: "rgba(10, 10, 30, 0.5)",
      border: "1px solid rgba(199, 210, 254, 0.1)",
      maxHeight: "0",
      overflow: "hidden",
      opacity: "0",
      transition: "max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, padding 0.3s ease",
    });

    let expanded = false;
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      if (expanded) {
        chipContainer.style.maxHeight = "300px";
        chipContainer.style.opacity = "1";
        chipContainer.style.padding = "0.6rem";
      } else {
        chipContainer.style.maxHeight = "0";
        chipContainer.style.opacity = "0";
        chipContainer.style.padding = "0";
      }
      const arrow = toggle.querySelector("svg");
      if (arrow) arrow.style.transform = expanded ? "rotate(90deg)" : "rotate(0deg)";
      toggle.style.background = expanded ? "rgba(99, 102, 241, 0.2)" : "rgba(99, 102, 241, 0.1)";
      toggle.style.borderColor = expanded ? "rgba(99, 102, 241, 0.4)" : "rgba(199, 210, 254, 0.2)";
    });

    sources.slice(0, 6).forEach((snippet) => {
      const chip = document.createElement("button");
      chip.textContent = snippet.length > 100 ? `${snippet.slice(0, 100)}...` : snippet;
      Object.assign(chip.style, {
        padding: "0.4rem 0.7rem",
        borderRadius: "10px",
        border: "1px solid rgba(199, 210, 254, 0.15)",
        background: "rgba(99, 102, 241, 0.08)",
        color: "#c7d2fe",
        cursor: "pointer",
        fontSize: "0.76rem",
        lineHeight: "1.4",
        textAlign: "left",
        transition: "all 0.2s ease",
        fontFamily: "'Inter', system-ui, sans-serif",
      });
      chip.addEventListener("mouseenter", () => {
        chip.style.background = "rgba(99, 102, 241, 0.2)";
        chip.style.borderColor = "rgba(99, 102, 241, 0.35)";
      });
      chip.addEventListener("mouseleave", () => {
        chip.style.background = "rgba(99, 102, 241, 0.08)";
        chip.style.borderColor = "rgba(199, 210, 254, 0.15)";
      });
      chip.addEventListener("click", () => {
        const p = findParagraphForSnippet(snippet);
        highlightParagraph(p);
      });
      chipContainer.appendChild(chip);
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(chipContainer);
    messagesEl.appendChild(wrapper);
  };

  const addMessage = (role, textValue, typing = false, sources = []) => {
    const bubble = document.createElement("div");
    Object.assign(bubble.style, {
      alignSelf: role === "user" ? "flex-end" : "flex-start",
      background:
        role === "user"
          ? "rgba(99, 102, 241, 0.2)"
          : "rgba(17, 24, 39, 0.6)",
      color: "#e0e7ff",
      padding: "0.7rem 1rem",
      borderRadius: role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
      maxWidth: "88%",
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: "0.95rem",
      lineHeight: "1.6",
      whiteSpace: "pre-wrap",
      boxShadow: "0 8px 24px rgba(8,8,20,0.2)",
      border: "1px solid " + (role === "user" ? "rgba(99, 102, 241, 0.2)" : "rgba(199, 210, 254, 0.1)"),
      opacity: "0",
      transform: role === "user" ? "translateX(8px)" : "translateX(-8px)",
      transition: "opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
    });

    messagesEl.appendChild(bubble);
    requestAnimationFrame(() => {
      bubble.style.opacity = "1";
      bubble.style.transform = "translateX(0)";
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (typing) {
      showInputRow();
      typeWriter(bubble, textValue, 16);
    } else {
      bubble.textContent = textValue;
    }
    if (sources.length) {
      if (typing) {
        setTimeout(() => addSourcesRow(sources), textValue.length * 16 + 200);
      } else {
        addSourcesRow(sources);
      }
    }
  };

  const stopThinking = () => {
    text.style.transition = "opacity 0.4s ease";
    text.style.opacity = "0";
    glowingRing.style.transition = "opacity 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)";
    glowingRing.style.opacity = "0.3";
    glowingRing.style.transform = "scale(0.6)";
  };

  const showRetry = () => {
    const retry = document.createElement("button");
    retry.textContent = "Retry";
    Object.assign(retry.style, {
      marginTop: "0.4rem",
      padding: "0.55rem 1rem",
      borderRadius: "12px",
      border: "1px solid rgba(199, 210, 254, 0.25)",
      background: "rgba(10, 10, 30, 0.6)",
      color: "#e0e7ff",
      cursor: "pointer",
      fontWeight: "500",
      transition: "all 0.2s ease",
    });
    retry.addEventListener("mouseenter", () => {
      retry.style.background = "rgba(99, 102, 241, 0.15)";
      retry.style.borderColor = "rgba(99, 102, 241, 0.4)";
    });
    retry.addEventListener("mouseleave", () => {
      retry.style.background = "rgba(10, 10, 30, 0.6)";
      retry.style.borderColor = "rgba(199, 210, 254, 0.25)";
    });
    retry.addEventListener("click", () => {
      retry.remove();
      runSummary();
    });
    chatWrap.appendChild(retry);
  };

  const runSummary = async () => {
    chatWrap.style.opacity = "1";
    chatWrap.style.transform = "translateY(0)";
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
    const pageText = document.body.innerText.slice(0, 3000);
    const { ok, data, error } = await fetchJsonWithTimeout(
      "https://ai-extension-backend-twilight-forest-3247.fly.dev/api/summarize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pageText }),
      }
    );
    if (ok) {
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
    } else {
      stopThinking();
      addMessage("assistant", "Could not reach the AI server.");
      showRetry();
      console.error(error);
    }
  };

  // === Fetch summary with slight delay for entrance animation ===
  setTimeout(runSummary, 1200);

  let selectedText = "";

  const updateSelection = () => {
    const sel = window.getSelection();
    const textValue = sel ? sel.toString().trim() : "";
    selectedText = textValue;
    if (textValue) {
      selectionText.textContent = `Selected: ${textValue.slice(0, 120)}${
        textValue.length > 120 ? "..." : ""
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
    sendBtn.style.opacity = "0.5";

    const pageText = document.body.innerText.slice(0, 3000);
    const { ok, data, error } = await fetchJsonWithTimeout(
      "https://ai-extension-backend-twilight-forest-3247.fly.dev/api/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pageText, messages, selection: selectedText }),
      }
    );
    if (ok) {
      const answer = data.answer || "No answer received.";
      messages.push({ role: "assistant", content: answer });
      addMessage("assistant", answer, true, data.sources || []);
    } else {
      addMessage("assistant", "Could not reach the AI server.");
      console.error(error);
    }
    sendBtn.disabled = false;
    input.disabled = false;
    sendBtn.style.opacity = "1";
    input.focus();
  };

  sendBtn.addEventListener("click", () => askQuestion());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") askQuestion();
  });
  askSelectionBtn.addEventListener("click", () => {
    askQuestion("Explain the highlighted text.");
  });
  summarizeSelectionBtn.addEventListener("click", async () => {
    if (!selectedText) return;
    addMessage("user", "Summarize the highlighted text.");
    messages.push({ role: "user", content: "Summarize the highlighted text." });

    sendBtn.disabled = true;
    input.disabled = true;
    sendBtn.style.opacity = "0.5";

    const { ok: selOk, data: selData, error: selError } = await fetchJsonWithTimeout(
      "https://ai-extension-backend-twilight-forest-3247.fly.dev/api/summarize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: selectedText }),
      }
    );
    if (selOk) {
      const aiResponse = selData.summary || "No summary received.";
      messages.push({ role: "assistant", content: aiResponse });
      addMessage("assistant", aiResponse, true, selData.sources || []);
    } else {
      addMessage("assistant", "Could not reach the AI server.");
      console.error(selError);
    }
    sendBtn.disabled = false;
    input.disabled = false;
    sendBtn.style.opacity = "1";
    input.focus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      overlay.style.opacity = "0";
      overlay.style.backdropFilter = "blur(0px)";
      container.style.opacity = "0";
      container.style.transform = "translateY(10px) scale(0.97)";
      setTimeout(() => overlay.remove(), 400);
    }
  });

  // === Keyframes ===
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ringSpin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    #ai-overlay * {
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #ai-overlay .thinking-dots {
      display: inline-flex;
      gap: 0.15em;
      margin-left: 0.15em;
      vertical-align: bottom;
    }
    #ai-overlay .thinking-dots span {
      display: inline-block;
      opacity: 0.2;
      animation: dotPulse 1.2s cubic-bezier(0.45, 0, 0.55, 1) infinite;
    }
    #ai-overlay .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    #ai-overlay .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dotPulse {
      0% { opacity: 0.2; transform: translateY(0); }
      35% { opacity: 1; transform: translateY(-2px); }
      60% { opacity: 0.4; transform: translateY(0); }
      100% { opacity: 0.2; transform: translateY(0); }
    }
    #ai-overlay ::-webkit-scrollbar {
      width: 4px;
    }
    #ai-overlay ::-webkit-scrollbar-track {
      background: transparent;
    }
    #ai-overlay ::-webkit-scrollbar-thumb {
      background: rgba(99, 102, 241, 0.3);
      border-radius: 4px;
    }
    #ai-overlay ::-webkit-scrollbar-thumb:hover {
      background: rgba(99, 102, 241, 0.5);
    }
  `;
  document.head.appendChild(style);
})();
