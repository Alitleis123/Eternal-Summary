(() => {
  // Runs in the page's own context, injected by listener.js. It has no chrome.*
  // access, so every network call and every cache write goes through the bridge.

  const MAX_PAGE_CHARS = 6000;
  const REQUEST_TIMEOUT_MS = 25000;

  const MODES = [
    { id: "tldr", label: "TL;DR" },
    { id: "bullets", label: "Bullets" },
    { id: "key-points", label: "Key points" },
    { id: "simple", label: "Plain English" },
  ];

  const cacheEl = document.getElementById("es-cache");
  const ICON_URL = cacheEl?.dataset?.iconUrl || "";

  // =========================================================
  // Bridge to the extension
  // =========================================================
  const api = (endpoint, payload, timeoutMs = REQUEST_TIMEOUT_MS) => {
    const requestId = `es_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(value);
      };

      const timer = setTimeout(
        () => finish({ ok: false, error: { code: "timeout", message: "Request timed out" } }),
        timeoutMs
      );

      const onMessage = (event) => {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.type !== "ES_API_RESPONSE" || msg.requestId !== requestId) return;

        const result = msg.result || {};
        if (result.ok && result.data) {
          finish({ ok: true, data: result.data });
          return;
        }
        finish({
          ok: false,
          error: {
            code: result.timedOut ? "timeout" : result.status ? "http" : "network",
            message: result.data?.error || result.error || "Request failed",
            status: result.status || null,
          },
          data: result.data || null,
        });
      };

      window.addEventListener("message", onMessage);
      window.postMessage({ type: "ES_API_REQUEST", requestId, endpoint, payload }, "*");
    });
  };

  const writeCache = (value) => {
    window.postMessage({ type: "ES_CACHE_SET", value }, "*");
  };

  const friendlyError = (err) => {
    if (err?.code === "timeout") return "That took too long. Try again.";
    if (err?.code === "http") return "The AI server had a problem. Try again shortly.";
    return "Could not reach the AI server.";
  };

  // =========================================================
  // Page text extraction
  // =========================================================
  const extractPageText = () => {
    const candidates = ["article", "main", "[role='main']", "#content", ".post", ".article-body"];
    let root = null;
    let bestLength = 0;
    for (const selector of candidates) {
      for (const el of document.querySelectorAll(selector)) {
        const length = el.innerText?.length || 0;
        if (length > bestLength) {
          bestLength = length;
          root = el;
        }
      }
    }
    // Only trust a container if it holds most of the readable page.
    const bodyText = document.body?.innerText || "";
    const text = bestLength > 400 && bestLength > bodyText.length * 0.25 ? root.innerText : bodyText;
    return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_PAGE_CHARS);
  };

  // =========================================================
  // Typewriter
  // =========================================================
  const typeWriter = (el, textValue, { onTick, onDone } = {}) => {
    const full = textValue || "";

    const finish = () => {
      el.textContent = full;
      if (onTick) onTick();
      if (onDone) onDone();
    };

    // Background tabs do not run animation frames. Render in one shot rather
    // than leaving the answer blank until the tab is focused again.
    if (!full || document.hidden) {
      finish();
      return;
    }

    // Scale the rate with length so even long answers land in about a second.
    const perFrame = Math.max(1, Math.ceil(full.length / 90));
    let i = 0;
    let lastHeight = 0;

    const step = () => {
      if (document.hidden) {
        finish();
        return;
      }
      if (i >= full.length) {
        if (onDone) onDone();
        return;
      }
      i = Math.min(full.length, i + perFrame);
      el.textContent = full.slice(0, i);
      if (onTick) {
        const height = el.scrollHeight;
        if (height !== lastHeight) {
          lastHeight = height;
          onTick();
        }
      }
      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  };

  // =========================================================
  // Source snippet lookup and highlight
  // =========================================================
  const SOURCE_SELECTOR = "p, li, blockquote, td, pre, dd, figcaption, h1, h2, h3, h4, h5, h6";
  const normalized = new WeakMap();

  const normalize = (value) =>
    (value || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const normalizedTextOf = (el) => {
    if (!normalized.has(el)) normalized.set(el, normalize(el.innerText));
    return normalized.get(el);
  };

  const sourceCandidates = () =>
    Array.from(document.querySelectorAll(SOURCE_SELECTOR)).filter((el) => {
      if (el.closest("#ai-overlay, #es-selection-popup, #es-cache, #es-selection-store")) return false;
      return el.getClientRects().length > 0;
    });

  const findParagraphForSnippet = (snippet) => {
    const needle = normalize(snippet);
    if (needle.length < 8) return null;

    const nodes = sourceCandidates();

    // Exact-ish containment first, shrinking the probe until something matches.
    for (const length of [140, 70, 35]) {
      const probe = needle.slice(0, length);
      if (probe.length < 8) continue;
      const hit = nodes.find((el) => normalizedTextOf(el).includes(probe));
      if (hit) return hit;
    }

    // Otherwise fall back to distinctive-word overlap.
    const terms = [...new Set(needle.split(" ").filter((t) => t.length > 4))];
    if (terms.length < 2) return null;

    let best = null;
    let bestScore = 0;
    for (const el of nodes) {
      const hay = normalizedTextOf(el);
      if (hay.length < 20) continue;
      const score = terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0) / terms.length;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return bestScore >= 0.5 ? best : null;
  };

  const highlightParagraph = (el) => {
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    const previous = el.getAttribute("style") || "";
    Object.assign(el.style, {
      transition: "background-color 0.35s ease, box-shadow 0.35s ease",
      backgroundColor: "rgba(99, 102, 241, 0.22)",
      boxShadow: "0 0 0 6px rgba(99, 102, 241, 0.15)",
      borderRadius: "6px",
    });
    setTimeout(() => {
      if (previous) el.setAttribute("style", previous);
      else el.removeAttribute("style");
    }, 2400);
    return true;
  };

  const showToast = (label) => {
    const toast = document.createElement("div");
    toast.textContent = label;
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      background: "rgba(10, 10, 30, 0.92)",
      color: "#a5b4fc",
      padding: "0.6rem 1rem",
      borderRadius: "12px",
      border: "1px solid rgba(99, 102, 241, 0.25)",
      zIndex: "1000004",
      fontSize: "0.82rem",
      fontFamily: "'Inter', system-ui, sans-serif",
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
    }, 1800);
  };

  // =========================================================
  // Shared styles
  // =========================================================
  const injectStyles = () => {
    if (document.getElementById("es-styles")) return;
    const style = document.createElement("style");
    style.id = "es-styles";
    style.textContent = `
      @keyframes esRingSpin { to { transform: rotate(360deg); } }
      @keyframes esDotPulse {
        0%, 100% { opacity: 0.2; transform: translateY(0); }
        35% { opacity: 1; transform: translateY(-2px); }
        60% { opacity: 0.4; transform: translateY(0); }
      }
      @keyframes esDotBounce {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30% { transform: translateY(-6px); opacity: 1; }
      }
      #ai-overlay *, #es-selection-popup * {
        font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        box-sizing: border-box;
      }
      #ai-overlay .es-dots { display: inline-flex; gap: 0.15em; margin-left: 0.15em; vertical-align: bottom; }
      #ai-overlay .es-dots span {
        display: inline-block;
        opacity: 0.2;
        animation: esDotPulse 1.2s cubic-bezier(0.45, 0, 0.55, 1) infinite;
      }
      #ai-overlay .es-dots span:nth-child(2) { animation-delay: 0.2s; }
      #ai-overlay .es-dots span:nth-child(3) { animation-delay: 0.4s; }
      .es-thinking { display: inline-flex; gap: 4px; padding: 4px 0; }
      .es-thinking span {
        width: 6px; height: 6px; border-radius: 50%;
        background: #6366f1;
        animation: esDotBounce 1.2s ease-in-out infinite;
      }
      .es-thinking span:nth-child(2) { animation-delay: 0.15s; }
      .es-thinking span:nth-child(3) { animation-delay: 0.3s; }
      #ai-overlay ::-webkit-scrollbar, #es-selection-popup ::-webkit-scrollbar { width: 4px; }
      #ai-overlay ::-webkit-scrollbar-track, #es-selection-popup ::-webkit-scrollbar-track { background: transparent; }
      #ai-overlay ::-webkit-scrollbar-thumb, #es-selection-popup ::-webkit-scrollbar-thumb {
        background: rgba(99, 102, 241, 0.3); border-radius: 4px;
      }
      #ai-overlay ::-webkit-scrollbar-thumb:hover { background: rgba(99, 102, 241, 0.5); }
      @media (prefers-reduced-motion: reduce) {
        #ai-overlay *, #es-selection-popup * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const thinkingDots = () => {
    const el = document.createElement("div");
    el.className = "es-thinking";
    el.innerHTML = "<span></span><span></span><span></span>";
    return el;
  };

  const hoverable = (el, over, out) => {
    el.addEventListener("mouseenter", over);
    el.addEventListener("mouseleave", out);
  };

  const iconButton = (svg, title) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.innerHTML = svg;
    Object.assign(btn.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "50%",
      border: "1px solid rgba(199, 210, 254, 0.2)",
      background: "transparent",
      color: "#a5b4fc",
      cursor: "pointer",
      transition: "all 0.2s ease",
      flexShrink: "0",
    });
    return btn;
  };

  const CLOSE_SVG = (size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const COPY_SVG =
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

  const copyToClipboard = (value) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(
        () => showToast("Copied to clipboard"),
        () => showToast("Could not copy")
      );
      return;
    }
    showToast("Could not copy");
  };

  // =========================================================
  // Selection store
  // =========================================================
  const readSelectionStore = () => {
    const store = document.getElementById("es-selection-store");
    if (!store?.dataset) return null;

    const parse = (value, fallback) => {
      try {
        return value ? JSON.parse(value) : fallback;
      } catch {
        return fallback;
      }
    };

    const request = {
      mode: store.dataset.mode || "",
      text: store.dataset.text || "",
      rect: parse(store.dataset.rect, {}),
      anchorId: store.dataset.anchorId || "",
      anchorOffset: parse(store.dataset.anchorOffset, null),
    };
    store.dataset.mode = "";
    return request;
  };

  const selectionRequest = readSelectionStore();
  injectStyles();

  // =========================================================
  // Selection card
  // =========================================================
  const openSelectionCard = ({ text: selectedText, rect, anchorId, anchorOffset }) => {
    const popup = document.getElementById("es-selection-popup");
    if (!popup) return false;

    if (!popup.__esOriginalChildren) {
      popup.__esOriginalChildren = Array.from(popup.childNodes);
      popup.__esOriginalStyle = popup.getAttribute("style") || "";
    }

    popup.dataset.expanded = "true";
    popup.replaceChildren();
    Object.assign(popup.style, {
      position: "absolute",
      zIndex: "1000003",
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
      alignItems: "stretch",
      textAlign: "left",
      opacity: "0",
      transform: "translateY(8px) scale(0.97)",
      transition:
        "opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      overflow: "hidden",
      cursor: "default",
    });

    // --- Header
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      padding: "0.7rem 0.85rem",
      borderBottom: "1px solid rgba(199, 210, 254, 0.12)",
      background: "rgba(99, 102, 241, 0.06)",
    });

    if (ICON_URL) {
      const icon = document.createElement("img");
      icon.src = ICON_URL;
      icon.alt = "";
      Object.assign(icon.style, {
        width: "18px",
        height: "18px",
        borderRadius: "4px",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.15), 0 0 10px rgba(99,102,241,0.35)",
      });
      header.appendChild(icon);
    }

    const title = document.createElement("div");
    title.textContent = "Selection summary";
    Object.assign(title.style, {
      fontSize: "0.82rem",
      fontWeight: "600",
      letterSpacing: "0.3px",
      flex: "1",
      opacity: "0.9",
    });

    const copyBtn = iconButton(COPY_SVG, "Copy summary");
    Object.assign(copyBtn.style, { width: "28px", height: "28px" });
    hoverable(
      copyBtn,
      () => {
        copyBtn.style.background = "rgba(99, 102, 241, 0.18)";
        copyBtn.style.color = "#e0e7ff";
      },
      () => {
        copyBtn.style.background = "transparent";
        copyBtn.style.color = "#a5b4fc";
      }
    );

    const closeBtn = iconButton(CLOSE_SVG(14), "Close");
    Object.assign(closeBtn.style, { width: "28px", height: "28px" });
    hoverable(
      closeBtn,
      () => {
        closeBtn.style.background = "rgba(239, 68, 68, 0.15)";
        closeBtn.style.borderColor = "rgba(239, 68, 68, 0.4)";
        closeBtn.style.color = "#f87171";
      },
      () => {
        closeBtn.style.background = "transparent";
        closeBtn.style.borderColor = "rgba(199, 210, 254, 0.2)";
        closeBtn.style.color = "#a5b4fc";
      }
    );

    header.append(title, copyBtn, closeBtn);

    // --- Body
    const body = document.createElement("div");
    Object.assign(body.style, {
      fontSize: "0.9rem",
      lineHeight: "1.6",
      whiteSpace: "pre-wrap",
      padding: "0.85rem 0.95rem",
      maxHeight: "250px",
      overflowY: "auto",
    });
    const dots = thinkingDots();
    body.appendChild(dots);

    // --- Follow-up row
    const followUp = document.createElement("div");
    Object.assign(followUp.style, {
      display: "none",
      gap: "0.4rem",
      alignItems: "center",
      padding: "0 0.85rem 0.75rem",
    });

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Ask a follow-up...";
    Object.assign(input.style, {
      flex: "1",
      minWidth: "0",
      padding: "0.5rem 0.7rem",
      borderRadius: "10px",
      border: "1px solid rgba(199, 210, 254, 0.2)",
      background: "rgba(10, 10, 30, 0.6)",
      color: "#e0e7ff",
      fontSize: "0.82rem",
      outline: "none",
      transition: "border-color 0.2s ease",
    });
    input.addEventListener("focus", () => {
      input.style.borderColor = "rgba(99, 102, 241, 0.5)";
    });
    input.addEventListener("blur", () => {
      input.style.borderColor = "rgba(199, 210, 254, 0.2)";
    });

    const askBtn = document.createElement("button");
    askBtn.type = "button";
    askBtn.textContent = "Ask";
    Object.assign(askBtn.style, {
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
    hoverable(
      askBtn,
      () => {
        askBtn.style.transform = "scale(1.03)";
      },
      () => {
        askBtn.style.transform = "scale(1)";
      }
    );

    followUp.append(input, askBtn);
    popup.append(header, body, followUp);

    // --- Positioning against the original selection
    const position = () => {
      const offset = 12;
      const popupRect = popup.getBoundingClientRect();
      const scrollY = window.scrollY || 0;
      const scrollX = window.scrollX || 0;

      let base = rect || {};
      if (anchorId) {
        const anchor = document.getElementById(anchorId);
        if (anchor) {
          const r = anchor.getBoundingClientRect();
          base = anchorOffset
            ? {
                top: r.top + (anchorOffset.top || 0),
                bottom: r.top + (anchorOffset.bottom || 0),
                left: r.left + (anchorOffset.left || 0),
              }
            : { top: r.top, bottom: r.bottom, left: r.left };
        }
      }

      const docTop = (base.top || 0) + scrollY;
      const docBottom = (base.bottom || 0) + scrollY;
      const above = docTop - popupRect.height - offset;
      const top = above > scrollY + 8 ? above : docBottom + offset;

      let left = (base.left || 0) + scrollX;
      const rightEdge = window.innerWidth - 8 + scrollX;
      if (left + popupRect.width > rightEdge) left = rightEdge - popupRect.width;
      if (left < scrollX + 8) left = scrollX + 8;

      popup.style.top = `${Math.round(top)}px`;
      popup.style.left = `${Math.round(left)}px`;
    };

    let frame = 0;
    const onViewportChange = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        position();
      });
    };
    document.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);

    popup.__esCleanup = () => {
      document.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      if (frame) cancelAnimationFrame(frame);
      if (anchorId) document.getElementById(anchorId)?.remove();
    };

    const close = () => {
      window.postMessage({ type: "ES_RESTORE_SELECTION_POPUP" }, "*");
    };
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
    });

    requestAnimationFrame(() => {
      position();
      popup.style.opacity = "1";
      popup.style.transform = "translateY(0) scale(1)";
    });

    // --- Conversation
    const history = [];
    let latestAnswer = "";

    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (latestAnswer) copyToClipboard(latestAnswer);
    });

    const setBusy = (busy) => {
      popup.dataset.busy = busy ? "true" : "false";
      askBtn.disabled = busy;
      askBtn.style.opacity = busy ? "0.6" : "1";
    };

    const render = (value, { revealFollowUp = true } = {}) => {
      latestAnswer = value;
      dots.remove();
      typeWriter(body, value, {
        onTick: position,
        onDone: () => {
          if (!revealFollowUp) return;
          followUp.style.display = "flex";
          requestAnimationFrame(position);
        },
      });
    };

    const renderError = (error) => {
      dots.remove();
      body.textContent = friendlyError(error);
      followUp.style.display = "flex";
      requestAnimationFrame(position);
    };

    const ask = async () => {
      if (popup.dataset.busy === "true") return;
      const question = input.value.trim();
      if (!question) return;

      setBusy(true);
      input.value = "";
      history.push({ role: "user", content: question });
      body.textContent = "";
      body.appendChild(dots);

      const { ok, data, error } = await api("ask", {
        text: selectedText,
        selection: selectedText,
        messages: history.slice(-6),
      });

      if (ok) {
        const answer = data.answer || "No answer received.";
        history.push({ role: "assistant", content: answer });
        render(answer);
      } else {
        renderError(error);
      }
      setBusy(false);
      input.focus();
    };

    askBtn.addEventListener("click", ask);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ask();
      if (e.key === "Escape") close();
    });

    const summarize = async () => {
      setBusy(true);
      const { ok, data, error } = await api("summarize", { text: selectedText, mode: "tldr" });
      if (!ok) {
        renderError(error);
        setBusy(false);
        return;
      }
      const summary = data.summary || "";
      if (summary) history.push({ role: "assistant", content: summary });

      const wordCount = selectedText.trim() ? selectedText.trim().split(/\s+/).length : 0;
      if (!summary || wordCount < 10) {
        render("There is not much to work with here. What would you like to know?");
      } else {
        render(summary);
      }
      setBusy(false);
    };

    summarize();
    return true;
  };

  // =========================================================
  // Route: selection card, or toggle the full overlay
  // =========================================================
  const existingOverlay = document.getElementById("ai-overlay");
  const wantsSelection = selectionRequest?.mode === "selection" && selectionRequest.text;

  if (existingOverlay) {
    existingOverlay.__esClose?.(true);
    if (!wantsSelection) return;
  }

  if (wantsSelection && openSelectionCard(selectionRequest)) return;

  // =========================================================
  // Full page overlay
  // =========================================================
  const overlay = document.createElement("div");
  overlay.id = "ai-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Eternal Summary");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0, 0, 0, 0)",
    backdropFilter: "blur(0px)",
    WebkitBackdropFilter: "blur(0px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4vh 2vw",
    zIndex: "999999",
    opacity: "0",
    transition:
      "background-color 0.5s cubic-bezier(0.16, 1, 0.3, 1), backdrop-filter 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
  });
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.background = "rgba(6, 6, 15, 0.78)";
    overlay.style.backdropFilter = "blur(10px)";
    overlay.style.WebkitBackdropFilter = "blur(10px)";
    overlay.style.opacity = "1";
  });

  const teardown = [];
  const on = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    teardown.push(() => target.removeEventListener(event, handler, options));
  };

  // --- Card
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "min(720px, 100%)",
    maxHeight: "100%",
    borderRadius: "20px",
    border: "1px solid rgba(199, 210, 254, 0.16)",
    background: "rgba(9, 9, 24, 0.94)",
    boxShadow: "0 30px 80px rgba(4, 4, 12, 0.65), 0 0 0 1px rgba(99, 102, 241, 0.08)",
    overflow: "hidden",
    textAlign: "left",
    opacity: "0",
    transform: "translateY(16px) scale(0.98)",
    transition:
      "opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.05s, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.05s",
  });
  requestAnimationFrame(() => {
    container.style.opacity = "1";
    container.style.transform = "translateY(0) scale(1)";
  });

  const closeOverlay = (immediate = false) => {
    if (overlay.dataset.closing === "true") return;
    overlay.dataset.closing = "true";
    while (teardown.length) teardown.pop()();
    if (immediate) {
      overlay.remove();
      return;
    }
    overlay.style.opacity = "0";
    overlay.style.backdropFilter = "blur(0px)";
    container.style.opacity = "0";
    container.style.transform = "translateY(10px) scale(0.98)";
    setTimeout(() => overlay.remove(), 320);
  };
  overlay.__esClose = closeOverlay;

  // --- Header
  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    gap: "0.7rem",
    padding: "0.85rem 1.1rem",
    borderBottom: "1px solid rgba(199, 210, 254, 0.1)",
    background: "linear-gradient(180deg, rgba(99, 102, 241, 0.09), rgba(99, 102, 241, 0))",
    flexShrink: "0",
  });

  const brandMark = document.createElement("div");
  Object.assign(brandMark.style, {
    width: "30px",
    height: "30px",
    borderRadius: "9px",
    flexShrink: "0",
    background: ICON_URL ? `center / cover no-repeat url("${ICON_URL}")` : "linear-gradient(135deg, #6366f1, #a855f7)",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.12), 0 0 16px rgba(99,102,241,0.35)",
  });

  const titleBlock = document.createElement("div");
  Object.assign(titleBlock.style, { flex: "1", minWidth: "0" });

  const brandName = document.createElement("div");
  brandName.textContent = "Eternal Summary";
  Object.assign(brandName.style, {
    fontSize: "0.92rem",
    fontWeight: "600",
    color: "#e0e7ff",
    letterSpacing: "0.2px",
  });

  const pageLabel = document.createElement("div");
  pageLabel.textContent = document.title ? `${location.hostname} - ${document.title}` : location.hostname;
  Object.assign(pageLabel.style, {
    fontSize: "0.74rem",
    color: "#7c8db5",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    marginTop: "0.1rem",
  });

  titleBlock.append(brandName, pageLabel);

  const closeBtn = iconButton(CLOSE_SVG(16), "Close overlay");
  Object.assign(closeBtn.style, { width: "32px", height: "32px" });
  hoverable(
    closeBtn,
    () => {
      closeBtn.style.background = "rgba(239, 68, 68, 0.15)";
      closeBtn.style.borderColor = "rgba(239, 68, 68, 0.45)";
      closeBtn.style.color = "#f87171";
    },
    () => {
      closeBtn.style.background = "transparent";
      closeBtn.style.borderColor = "rgba(199, 210, 254, 0.2)";
      closeBtn.style.color = "#a5b4fc";
    }
  );
  closeBtn.addEventListener("click", () => closeOverlay());

  header.append(brandMark, titleBlock, closeBtn);

  // --- Mode chips
  const modeRow = document.createElement("div");
  Object.assign(modeRow.style, {
    display: "flex",
    gap: "0.4rem",
    flexWrap: "wrap",
    padding: "0.8rem 1.1rem 0",
    transition: "opacity 0.25s ease",
    flexShrink: "0",
  });

  let activeMode = MODES[0].id;
  const modeButtons = new Map();

  const paintModes = () => {
    for (const [id, btn] of modeButtons) {
      const selected = id === activeMode;
      btn.style.background = selected ? "rgba(99, 102, 241, 0.3)" : "rgba(99, 102, 241, 0.07)";
      btn.style.borderColor = selected ? "rgba(129, 140, 248, 0.6)" : "rgba(199, 210, 254, 0.16)";
      btn.style.color = selected ? "#e0e7ff" : "#8fa0c8";
      btn.setAttribute("aria-pressed", String(selected));
    }
  };

  for (const mode of MODES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = mode.label;
    Object.assign(btn.style, {
      padding: "0.33rem 0.72rem",
      borderRadius: "999px",
      border: "1px solid rgba(199, 210, 254, 0.16)",
      background: "rgba(99, 102, 241, 0.07)",
      color: "#8fa0c8",
      cursor: "pointer",
      fontSize: "0.76rem",
      fontWeight: "500",
      transition: "all 0.2s ease",
    });
    btn.addEventListener("click", () => {
      if (activeMode === mode.id || busy) return;
      activeMode = mode.id;
      paintModes();
      runSummary({ force: true });
    });
    modeButtons.set(mode.id, btn);
    modeRow.appendChild(btn);
  }
  paintModes();

  // --- Messages
  const messagesEl = document.createElement("div");
  Object.assign(messagesEl.style, {
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
    padding: "0.85rem 1.1rem",
    overflowY: "auto",
    flex: "1",
    minHeight: "160px",
  });

  // --- Loader, shown inside the message area and removed once an answer lands
  const loader = document.createElement("div");
  Object.assign(loader.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.9rem",
    padding: "1.6rem 0",
    margin: "auto",
  });

  const ring = document.createElement("div");
  Object.assign(ring.style, {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    position: "relative",
    background: "conic-gradient(from 0deg, #6366f1, #a855f7, #ec4899, #6366f1)",
    animation: "esRingSpin 1.6s linear infinite",
    filter: "drop-shadow(0 0 18px rgba(99,102,241,0.45))",
    flexShrink: "0",
  });
  const ringMask = document.createElement("div");
  Object.assign(ringMask.style, {
    position: "absolute",
    inset: "5px",
    borderRadius: "50%",
    background: "rgb(11, 11, 26)",
  });
  ring.appendChild(ringMask);

  const statusText = document.createElement("div");
  statusText.textContent = "Reading the page";
  Object.assign(statusText.style, {
    fontSize: "0.88rem",
    fontWeight: "500",
    color: "#a5b4fc",
    letterSpacing: "0.2px",
  });
  const statusDots = document.createElement("span");
  statusDots.className = "es-dots";
  statusDots.innerHTML = "<span>.</span><span>.</span><span>.</span>";
  statusText.appendChild(statusDots);

  loader.append(ring, statusText);
  messagesEl.appendChild(loader);

  const showLoader = (label) => {
    statusText.firstChild.textContent = label;
    if (!loader.isConnected) messagesEl.appendChild(loader);
  };
  const hideLoader = () => loader.remove();

  // --- Selection row
  const selectionRow = document.createElement("div");
  Object.assign(selectionRow.style, {
    display: "none",
    alignItems: "center",
    gap: "0.5rem",
    margin: "0 1.1rem",
    padding: "0.5rem 0.75rem",
    borderRadius: "12px",
    border: "1px solid rgba(199, 210, 254, 0.16)",
    background: "rgba(99, 102, 241, 0.07)",
    color: "#c7d2fe",
    fontSize: "0.82rem",
    flexShrink: "0",
  });

  const selectionLabel = document.createElement("div");
  Object.assign(selectionLabel.style, {
    flex: "1",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });

  const pillButton = (label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    Object.assign(btn.style, {
      padding: "0.32rem 0.62rem",
      borderRadius: "999px",
      border: "1px solid rgba(199, 210, 254, 0.22)",
      background: "rgba(99, 102, 241, 0.16)",
      color: "#e0e7ff",
      cursor: "pointer",
      fontSize: "0.78rem",
      whiteSpace: "nowrap",
      transition: "all 0.2s ease",
    });
    hoverable(
      btn,
      () => {
        btn.style.background = "rgba(99, 102, 241, 0.3)";
      },
      () => {
        btn.style.background = "rgba(99, 102, 241, 0.16)";
      }
    );
    return btn;
  };

  const explainSelectionBtn = pillButton("Explain");
  const summarizeSelectionBtn = pillButton("Summarize");
  selectionRow.append(selectionLabel, explainSelectionBtn, summarizeSelectionBtn);

  // --- Composer
  const inputRow = document.createElement("div");
  Object.assign(inputRow.style, {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    padding: "0.85rem 1.1rem 1rem",
    borderTop: "1px solid rgba(199, 210, 254, 0.1)",
    marginTop: "0.5rem",
    flexShrink: "0",
  });

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Ask a question about this page...";
  input.setAttribute("aria-label", "Ask a question about this page");
  Object.assign(input.style, {
    flex: "1",
    minWidth: "0",
    padding: "0.7rem 0.95rem",
    borderRadius: "13px",
    border: "1px solid rgba(199, 210, 254, 0.18)",
    background: "rgba(4, 4, 14, 0.7)",
    color: "#e0e7ff",
    fontSize: "0.9rem",
    outline: "none",
    transition: "border-color 0.25s ease, box-shadow 0.25s ease",
  });
  input.addEventListener("focus", () => {
    input.style.borderColor = "rgba(99, 102, 241, 0.55)";
    input.style.boxShadow = "0 0 0 3px rgba(99, 102, 241, 0.12)";
  });
  input.addEventListener("blur", () => {
    input.style.borderColor = "rgba(199, 210, 254, 0.18)";
    input.style.boxShadow = "none";
  });

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.title = "Send";
  sendBtn.setAttribute("aria-label", "Send question");
  sendBtn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  Object.assign(sendBtn.style, {
    width: "42px",
    height: "42px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "13px",
    border: "none",
    cursor: "pointer",
    background: "linear-gradient(135deg, #6366f1, #a855f7)",
    color: "#fff",
    transition: "transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease",
    boxShadow: "0 4px 16px rgba(99, 102, 241, 0.3)",
    flexShrink: "0",
  });
  hoverable(
    sendBtn,
    () => {
      sendBtn.style.transform = "scale(1.05)";
      sendBtn.style.boxShadow = "0 6px 22px rgba(99, 102, 241, 0.45)";
    },
    () => {
      sendBtn.style.transform = "scale(1)";
      sendBtn.style.boxShadow = "0 4px 16px rgba(99, 102, 241, 0.3)";
    }
  );

  inputRow.append(input, sendBtn);

  // chatWrap keeps the retry button anchored under the conversation.
  const chatWrap = document.createElement("div");
  Object.assign(chatWrap.style, {
    display: "flex",
    flexDirection: "column",
    minHeight: "0",
    flex: "1",
  });
  chatWrap.append(messagesEl, selectionRow);

  container.append(header, modeRow, chatWrap, inputRow);
  overlay.appendChild(container);

  // =========================================================
  // Messages
  // =========================================================
  const history = [];
  let busy = false;
  let pageText = "";

  const addSourcesRow = (sources) => {
    const snippets = Array.isArray(sources) ? sources.slice(0, 6).filter(Boolean) : [];
    if (!snippets.length) return;

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, { marginTop: "0.1rem", textAlign: "left" });

    const toggle = document.createElement("button");
    toggle.type = "button";
    let expanded = false;
    toggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.25s cubic-bezier(0.16,1,0.3,1)"><path d="M9 18l6-6-6-6"/></svg><span style="margin-left:5px">Sources (${snippets.length})</span>`;
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
      transition: "all 0.25s ease",
    });
    hoverable(
      toggle,
      () => {
        toggle.style.background = "rgba(99, 102, 241, 0.2)";
      },
      () => {
        toggle.style.background = expanded ? "rgba(99, 102, 241, 0.2)" : "rgba(99, 102, 241, 0.1)";
      }
    );

    const list = document.createElement("div");
    Object.assign(list.style, {
      display: "flex",
      flexDirection: "column",
      gap: "0.35rem",
      marginTop: "0.5rem",
      padding: "0",
      borderRadius: "12px",
      background: "rgba(10, 10, 30, 0.5)",
      border: "1px solid rgba(199, 210, 254, 0.1)",
      maxHeight: "0",
      overflow: "hidden",
      opacity: "0",
      transition:
        "max-height 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease, padding 0.25s ease",
    });

    toggle.addEventListener("click", () => {
      expanded = !expanded;
      list.style.maxHeight = expanded ? "300px" : "0";
      list.style.opacity = expanded ? "1" : "0";
      list.style.padding = expanded ? "0.6rem" : "0";
      toggle.style.background = expanded ? "rgba(99, 102, 241, 0.2)" : "rgba(99, 102, 241, 0.1)";
      toggle.style.borderColor = expanded ? "rgba(99, 102, 241, 0.4)" : "rgba(199, 210, 254, 0.2)";
      const arrow = toggle.querySelector("svg");
      if (arrow) arrow.style.transform = expanded ? "rotate(90deg)" : "rotate(0deg)";
    });

    for (const snippet of snippets) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = snippet.length > 110 ? `${snippet.slice(0, 110)}...` : snippet;
      chip.title = "Jump to this passage on the page";
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
      });
      hoverable(
        chip,
        () => {
          chip.style.background = "rgba(99, 102, 241, 0.2)";
          chip.style.borderColor = "rgba(99, 102, 241, 0.35)";
        },
        () => {
          chip.style.background = "rgba(99, 102, 241, 0.08)";
          chip.style.borderColor = "rgba(199, 210, 254, 0.15)";
        }
      );
      chip.addEventListener("click", () => {
        const target = findParagraphForSnippet(snippet);
        if (!target) {
          showToast("Could not find that passage on the page");
          return;
        }
        // The overlay covers the page, so step out of the way before scrolling.
        closeOverlay();
        setTimeout(() => highlightParagraph(target), 380);
      });
      list.appendChild(chip);
    }

    wrapper.append(toggle, list);
    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const addMessage = (role, value, { typing = false, sources = [] } = {}) => {
    const isUser = role === "user";
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "flex-end",
      justifyContent: isUser ? "flex-end" : "flex-start",
      gap: "0.35rem",
      maxWidth: "100%",
    });

    const bubble = document.createElement("div");
    Object.assign(bubble.style, {
      background: isUser ? "rgba(99, 102, 241, 0.2)" : "rgba(17, 24, 39, 0.6)",
      color: "#e0e7ff",
      padding: "0.7rem 1rem",
      borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
      maxWidth: "min(88%, 560px)",
      fontSize: "0.95rem",
      lineHeight: "1.6",
      whiteSpace: "pre-wrap",
      textAlign: "left",
      boxShadow: "0 8px 24px rgba(8,8,20,0.2)",
      border: `1px solid ${isUser ? "rgba(99, 102, 241, 0.2)" : "rgba(199, 210, 254, 0.1)"}`,
      opacity: "0",
      transform: `translateX(${isUser ? "8px" : "-8px"})`,
      transition:
        "opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
    });

    row.appendChild(bubble);

    if (!isUser) {
      const copyBtn = iconButton(COPY_SVG, "Copy answer");
      Object.assign(copyBtn.style, {
        width: "26px",
        height: "26px",
        border: "none",
        opacity: "0",
        marginBottom: "0.2rem",
        transition: "opacity 0.2s ease, color 0.2s ease",
      });
      copyBtn.addEventListener("click", () => copyToClipboard(value));
      // Keep the action out of the way until the reader reaches for it.
      hoverable(
        row,
        () => {
          copyBtn.style.opacity = "0.7";
        },
        () => {
          copyBtn.style.opacity = "0";
        }
      );
      copyBtn.addEventListener("focus", () => {
        copyBtn.style.opacity = "1";
      });
      row.appendChild(copyBtn);
    }

    messagesEl.appendChild(row);
    requestAnimationFrame(() => {
      bubble.style.opacity = "1";
      bubble.style.transform = "translateX(0)";
    });

    const scrollDown = () => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    if (typing) {
      typeWriter(bubble, value, {
        onTick: scrollDown,
        onDone: () => {
          scrollDown();
          addSourcesRow(sources);
        },
      });
    } else {
      bubble.textContent = value;
      scrollDown();
      addSourcesRow(sources);
    }
  };

  const setBusy = (value) => {
    busy = value;
    sendBtn.disabled = value;
    input.disabled = value;
    sendBtn.style.opacity = value ? "0.5" : "1";
    modeRow.style.opacity = value ? "0.5" : "1";
    modeRow.style.pointerEvents = value ? "none" : "auto";
  };

  // --- Diagnostics panel
  let lastError = null;

  const showDiagnostics = (info) => {
    lastError = info;
    if (container.querySelector("[data-es-logs]")) return;

    const logsBtn = document.createElement("button");
    logsBtn.type = "button";
    logsBtn.dataset.esLogs = "true";
    logsBtn.textContent = "Details";
    Object.assign(logsBtn.style, {
      position: "absolute",
      top: "0.75rem",
      left: "0.85rem",
      padding: "0.3rem 0.6rem",
      borderRadius: "8px",
      border: "1px solid rgba(239, 68, 68, 0.3)",
      background: "rgba(239, 68, 68, 0.1)",
      color: "#f87171",
      cursor: "pointer",
      fontSize: "0.7rem",
      fontWeight: "600",
      letterSpacing: "0.3px",
      transition: "all 0.2s ease",
      zIndex: "10",
    });
    hoverable(
      logsBtn,
      () => {
        logsBtn.style.background = "rgba(239, 68, 68, 0.2)";
      },
      () => {
        logsBtn.style.background = "rgba(239, 68, 68, 0.1)";
      }
    );

    logsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = container.querySelector("[data-es-log-panel]");
      if (open) {
        open.remove();
        return;
      }
      const panel = document.createElement("div");
      panel.dataset.esLogPanel = "true";
      Object.assign(panel.style, {
        position: "absolute",
        top: "2.5rem",
        left: "0.85rem",
        right: "0.85rem",
        maxHeight: "200px",
        overflowY: "auto",
        padding: "0.75rem",
        borderRadius: "10px",
        border: "1px solid rgba(239, 68, 68, 0.2)",
        background: "rgba(10, 10, 20, 0.95)",
        backdropFilter: "blur(12px)",
        fontSize: "0.75rem",
        fontFamily: "monospace",
        color: "#fca5a5",
        lineHeight: "1.5",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        textAlign: "left",
        zIndex: "20",
      });
      const details = lastError || {};
      panel.textContent = [
        `Time:     ${new Date().toISOString()}`,
        `URL:      ${location.href}`,
        `Endpoint: ${details.endpoint || "n/a"}`,
        `Code:     ${details.code || "n/a"}`,
        `Status:   ${details.status ?? "n/a"}`,
        `Message:  ${details.message || "n/a"}`,
      ].join("\n");
      container.appendChild(panel);

      const closePanel = (ev) => {
        if (panel.contains(ev.target) || ev.target === logsBtn) return;
        panel.remove();
        document.removeEventListener("click", closePanel, true);
      };
      setTimeout(() => on(document, "click", closePanel, true), 0);
    });

    container.appendChild(logsBtn);
  };

  const failWith = (endpoint, error) => {
    const info = {
      endpoint,
      code: error?.code || "network",
      status: error?.status ?? null,
      message: error?.message || String(error),
    };
    addMessage("assistant", friendlyError(error));
    showDiagnostics(info);
  };

  const showRetry = () => {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    Object.assign(retry.style, {
      alignSelf: "center",
      padding: "0.55rem 1.1rem",
      borderRadius: "12px",
      border: "1px solid rgba(199, 210, 254, 0.25)",
      background: "rgba(10, 10, 30, 0.6)",
      color: "#e0e7ff",
      cursor: "pointer",
      fontWeight: "500",
      transition: "all 0.2s ease",
    });
    hoverable(
      retry,
      () => {
        retry.style.background = "rgba(99, 102, 241, 0.15)";
        retry.style.borderColor = "rgba(99, 102, 241, 0.4)";
      },
      () => {
        retry.style.background = "rgba(10, 10, 30, 0.6)";
        retry.style.borderColor = "rgba(199, 210, 254, 0.25)";
      }
    );
    retry.addEventListener("click", () => {
      retry.remove();
      container.querySelector("[data-es-logs]")?.remove();
      container.querySelector("[data-es-log-panel]")?.remove();
      runSummary({ force: true });
    });
    messagesEl.appendChild(retry);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const readCache = () => {
    if (!cacheEl?.dataset?.payload) return null;
    try {
      return JSON.parse(cacheEl.dataset.payload);
    } catch {
      return null;
    }
  };

  async function runSummary({ force = false } = {}) {
    if (busy) return;
    setBusy(true);
    messagesEl.replaceChildren();
    history.length = 0;
    showLoader("Reading the page");

    if (!force) {
      const cached = readCache();
      if (cached?.summary && cached.mode === activeMode) {
        hideLoader();
        addMessage("assistant", cached.summary, { typing: true, sources: cached.sources || [] });
        history.push({ role: "assistant", content: cached.summary });
        showToast("Showing a saved summary");
        setBusy(false);
        return;
      }
    }

    pageText = extractPageText();
    if (pageText.length < 40) {
      hideLoader();
      addMessage("assistant", "There is not enough readable text on this page to summarize.");
      setBusy(false);
      return;
    }

    const { ok, data, error } = await api("summarize", { text: pageText, mode: activeMode });
    hideLoader();

    if (!ok) {
      failWith("/api/summarize", error);
      showRetry();
      setBusy(false);
      return;
    }

    const summary = data.summary || "No summary received.";
    const sources = data.sources || [];
    history.push({ role: "assistant", content: summary });
    addMessage("assistant", summary, { typing: true, sources });
    writeCache({ summary, sources, mode: activeMode });
    setBusy(false);
  }

  // --- Selection awareness inside the overlay
  let selectedText = "";
  const refreshSelection = () => {
    const value = window.getSelection()?.toString().trim() || "";
    selectedText = value;
    if (!value) {
      selectionRow.style.display = "none";
      return;
    }
    selectionLabel.textContent = `Selected: ${value.slice(0, 120)}${value.length > 120 ? "..." : ""}`;
    selectionRow.style.display = "flex";
  };
  on(document, "selectionchange", refreshSelection);

  const ask = async (question, payloadOverride) => {
    const value = (question || input.value).trim();
    if (!value || busy) return;

    input.value = "";
    addMessage("user", value);
    history.push({ role: "user", content: value });
    setBusy(true);

    const pending = document.createElement("div");
    pending.appendChild(thinkingDots());
    Object.assign(pending.style, { alignSelf: "flex-start", padding: "0.2rem 0.4rem" });
    messagesEl.appendChild(pending);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const endpoint = payloadOverride?.endpoint || "ask";
    const payload =
      payloadOverride?.payload || {
        text: pageText || extractPageText(),
        messages: history.slice(-6),
        selection: selectedText,
      };

    const { ok, data, error } = await api(endpoint, payload);
    pending.remove();

    if (ok) {
      const answer = data.answer || data.summary || "No answer received.";
      history.push({ role: "assistant", content: answer });
      addMessage("assistant", answer, { typing: true, sources: data.sources || [] });
    } else {
      failWith(`/api/${endpoint}`, error);
    }

    setBusy(false);
    input.focus();
  };

  sendBtn.addEventListener("click", () => ask());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ask();
  });
  explainSelectionBtn.addEventListener("click", () => {
    if (selectedText) ask("Explain the highlighted text.");
  });
  summarizeSelectionBtn.addEventListener("click", () => {
    if (!selectedText) return;
    ask("Summarize the highlighted text.", {
      endpoint: "summarize",
      payload: { text: selectedText, mode: activeMode },
    });
  });

  on(document, "keydown", (e) => {
    if (e.key === "Escape") closeOverlay();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });

  // Small delay so the entrance animation is not fighting the first paint.
  setTimeout(() => runSummary(), 600);
})();
