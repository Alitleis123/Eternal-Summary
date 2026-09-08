(() => {
  // Runs in the page's own context, injected by listener.js. It has no chrome.*
  // access, so every network call and cache write goes through the bridge.
  //
  // The whole UI lives in a shadow root. Page stylesheets cannot cross that
  // boundary, which matters: a site rule like `* { line-height: 1 !important }`
  // would otherwise collapse our text on top of itself.

  const MAX_PAGE_CHARS = 6000;
  const REQUEST_TIMEOUT_MS = 25000;
  const NEAR_BOTTOM_PX = 60;

  const MODES = [
    { id: "tldr", label: "Summary" },
    { id: "bullets", label: "Bullets" },
    { id: "key-points", label: "Key points" },
    { id: "simple", label: "Plain English" },
  ];
  const modeLabel = (id) => MODES.find((m) => m.id === id)?.label || id;

  const cacheEl = document.getElementById("es-cache");

  // listener.js owns the defaults and hands them over already merged, so there
  // is no second copy here to drift out of step.
  const settings = (() => {
    try {
      return JSON.parse(cacheEl?.dataset?.settings || "{}");
    } catch {
      return {};
    }
  })();
  const savedSummaries = Number(cacheEl?.dataset?.saved || 0);
  // One gate for every reveal, so the preference cannot be honoured in some
  // paths and missed in others.
  const animate = () => settings.animateText !== false;
  const putSettings = (patch) => {
    Object.assign(settings, patch);
    window.postMessage({ type: "ES_SETTINGS_SET", patch }, "*");
  };

  // The stylesheet is fetched by listener.js and handed over on the cache node.
  const UI_CSS = cacheEl?.dataset?.css || "";


  // =========================================================
  // Shadow host helpers
  // =========================================================
  const makeHost = (id, styles) => {
    const host = document.createElement("div");
    if (id) host.id = id;
    // Set with priority so page rules targeting our element cannot move it.
    const base = {
      position: "fixed",
      inset: "0",
      "z-index": "2147483647",
      display: "block",
      margin: "0",
      padding: "0",
      border: "0",
      background: "none",
      "pointer-events": "none",
      ...styles,
    };
    for (const [k, v] of Object.entries(base)) host.style.setProperty(k, v, "important");

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = UI_CSS;
    shadow.appendChild(style);

    const root = document.createElement("div");
    root.className = "root";
    shadow.appendChild(root);
    return { host, shadow, root };
  };

  const el = (tag, className, html) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  };

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
        });
      };
      window.addEventListener("message", onMessage);
      window.postMessage({ type: "ES_API_REQUEST", requestId, endpoint, payload }, "*");
    });
  };

  const writeCache = (value) => window.postMessage({ type: "ES_CACHE_SET", value }, "*");
  const writeModePref = (mode) => window.postMessage({ type: "ES_PREF_SET", mode }, "*");

  const friendlyError = (err) => {
    if (err?.code === "timeout") return "That took too long. Try again.";
    if (err?.status === 429) return "Too many requests. Wait a moment and try again.";
    // Upstream capacity, not our fault and not the reader's. Worth saying so,
    // because "the server had a problem" invites a pointless bug report.
    if (err?.status === 503) return "The model is busy. Try again in a moment.";
    if (err?.code === "http") return "The AI server had a problem. Try again shortly.";
    return "Could not reach the AI server.";
  };

  // =========================================================
  // Page text
  // =========================================================
  const extractPageText = () => {
    const candidates = ["article", "main", "[role='main']", "#content", ".post", ".article-body"];
    let root = null;
    let best = 0;
    for (const selector of candidates) {
      for (const node of document.querySelectorAll(selector)) {
        const length = node.innerText?.length || 0;
        if (length > best) {
          best = length;
          root = node;
        }
      }
    }
    const bodyText = document.body?.innerText || "";
    const text = best > 400 && best > bodyText.length * 0.25 ? root.innerText : bodyText;
    return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_PAGE_CHARS);
  };

  // =========================================================
  // Markdown
  //
  // The model returns "- item" lines for bullets mode and "1." for key points.
  // Rendering those as plain text showed the literal markers, so the two list
  // modes never looked like lists.
  // =========================================================
  const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;

  const renderInline = (text, parent) => {
    for (const part of text.split(INLINE)) {
      if (!part) continue;
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        const code = document.createElement("code");
        code.textContent = part.slice(1, -1);
        parent.appendChild(code);
      } else if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
        const em = document.createElement("em");
        em.textContent = part.slice(1, -1);
        parent.appendChild(em);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    }
  };

  const renderMarkdown = (text, host) => {
    host.replaceChildren();
    let list = null;
    let listTag = "";
    let prose = [];

    const flushProse = () => {
      if (!prose.length) return;
      const p = document.createElement("p");
      p.className = "md-p";
      renderInline(prose.join(" "), p);
      host.appendChild(p);
      prose = [];
    };
    const endList = () => {
      list = null;
      listTag = "";
    };

    for (const raw of (text || "").split("\n")) {
      const line = raw.trim();
      const bullet = line.match(/^[-*\u2022]\s+(.*)$/);
      const numbered = line.match(/^(\d{1,2})[.)]\s+(.*)$/);

      if (bullet || numbered) {
        flushProse();
        const tag = bullet ? "ul" : "ol";
        if (!list || listTag !== tag) {
          list = document.createElement(tag);
          list.className = "md-list";
          host.appendChild(list);
          listTag = tag;
        }
        const item = document.createElement("li");
        renderInline(bullet ? bullet[1] : numbered[2], item);
        list.appendChild(item);
        continue;
      }

      endList();
      if (!line) {
        flushProse();
        continue;
      }
      // A single newline inside prose is a soft wrap, not a new paragraph.
      prose.push(line);
    }
    flushProse();
    return host;
  };

  // =========================================================
  // Reveal
  //
  // Types across the rendered tree one block at a time, so list markers appear
  // with their text instead of all at once up front.
  // =========================================================
  const revealMarkdown = (container, { onTick, onDone } = {}) => {
    const units = Array.from(container.querySelectorAll("p, li")).map((el) => {
      const nodes = [];
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) nodes.push([child, child.nodeValue]);
          else walk(child);
        }
      };
      walk(el);
      return { el, nodes, len: nodes.reduce((sum, [, t]) => sum + t.length, 0) };
    });
    const total = units.reduce((sum, u) => sum + u.len, 0);

    const finish = () => {
      for (const unit of units) {
        unit.el.style.display = "";
        for (const [node, text] of unit.nodes) node.nodeValue = text;
      }
      if (onTick) onTick();
      if (onDone) onDone();
    };

    // Background tabs do not run animation frames.
    if (!total || document.hidden) {
      finish();
      return;
    }

    for (const unit of units) {
      unit.el.style.display = "none";
      for (const [node] of unit.nodes) node.nodeValue = "";
    }

    const perFrame = Math.max(1, Math.ceil(total / 80));
    let shown = 0;

    const step = () => {
      if (document.hidden) {
        finish();
        return;
      }
      shown = Math.min(total, shown + perFrame);
      let left = shown;
      for (const unit of units) {
        if (left <= 0) {
          unit.el.style.display = "none";
          continue;
        }
        unit.el.style.display = "";
        for (const [node, text] of unit.nodes) {
          if (left <= 0) {
            node.nodeValue = "";
          } else if (left >= text.length) {
            node.nodeValue = text;
            left -= text.length;
          } else {
            node.nodeValue = text.slice(0, left);
            left = 0;
          }
        }
      }
      if (onTick) onTick();
      if (shown >= total) {
        if (onDone) onDone();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // =========================================================
  // Source snippet lookup
  // =========================================================
  const SOURCE_SELECTOR = "p, li, blockquote, td, pre, dd, figcaption, h1, h2, h3, h4, h5, h6";
  const normalCache = new WeakMap();

  const normalize = (value) =>
    (value || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  const normalizedOf = (node) => {
    if (!normalCache.has(node)) normalCache.set(node, normalize(node.innerText));
    return normalCache.get(node);
  };

  const findParagraphForSnippet = (snippet) => {
    const needle = normalize(snippet);
    if (needle.length < 8) return null;

    const nodes = Array.from(document.querySelectorAll(SOURCE_SELECTOR)).filter(
      (node) => !node.closest("#ai-overlay, #es-selection-popup") && node.getClientRects().length > 0
    );

    for (const length of [140, 70, 35]) {
      const probe = needle.slice(0, length);
      if (probe.length < 8) continue;
      const hit = nodes.find((node) => normalizedOf(node).includes(probe));
      if (hit) return hit;
    }

    const terms = [...new Set(needle.split(" ").filter((t) => t.length > 4))];
    if (terms.length < 2) return null;

    let best = null;
    let bestScore = 0;
    for (const node of nodes) {
      const hay = normalizedOf(node);
      if (hay.length < 20) continue;
      const score = terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0) / terms.length;
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    return bestScore >= 0.5 ? best : null;
  };

  const HIGHLIGHT = {
    "background-color": "rgba(123, 140, 255, 0.24)",
    "box-shadow": "0 0 0 6px rgba(123, 140, 255, 0.16)",
    "border-radius": "4px",
    transition: "background-color 300ms ease",
  };
  const FLASH = "rgba(123, 140, 255, 0.46)";
  const HIGHLIGHT_MS = 2400;

  const highlightParagraph = (node) => {
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });

    // Jumping to the passage is the point; painting it is a preference.
    if (settings.highlightSources === false) return;

    // Restore only the properties we touch. Replacing the whole style attribute
    // would discard anything the page sets on this element in the meantime.
    const previous = Object.keys(HIGHLIGHT).map((name) => [
      name,
      node.style.getPropertyValue(name),
      node.style.getPropertyPriority(name),
    ]);
    for (const [name, value] of Object.entries(HIGHLIGHT)) {
      node.style.setProperty(name, value, "important");
    }

    // A brief brighter flash makes the jump land. This paints on the page's own
    // element, outside the shadow root, so the reduced-motion rule in ui.css
    // cannot reach it and it is checked here instead.
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.style.setProperty("background-color", FLASH, "important");
      setTimeout(() => {
        node.style.setProperty("background-color", HIGHLIGHT["background-color"], "important");
      }, 190);
    }

    setTimeout(() => {
      for (const [name, value, priority] of previous) {
        if (value) node.style.setProperty(name, value, priority);
        else node.style.removeProperty(name);
      }
      if (!node.getAttribute("style")) node.removeAttribute("style");
    }, HIGHLIGHT_MS);
  };

  // =========================================================
  // Toast
  // =========================================================
  // content.js is re-injected on every open, so the toast host is looked up by
  // id and torn down afterwards. Otherwise each toast would strand another
  // full-viewport host, each carrying its own copy of the stylesheet.
  const TOAST_ID = "es-toast";
  let toastTimer = 0;

  const showToast = (label) => {
    let host = document.getElementById(TOAST_ID);
    let root = host?.shadowRoot?.querySelector(".root");
    if (!root) {
      host?.remove();
      const made = makeHost(TOAST_ID);
      host = made.host;
      root = made.root;
      document.documentElement.appendChild(host);
    }

    root.replaceChildren();
    const node = el("div", "toast");
    node.textContent = label;
    root.appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.classList.remove("show");
      setTimeout(() => host.remove(), 220);
    }, 1900);
  };

  const copyText = (value) => {
    if (!navigator.clipboard?.writeText) {
      showToast("Could not copy");
      return;
    }
    navigator.clipboard.writeText(value).then(
      () => showToast("Copied"),
      () => showToast("Could not copy")
    );
  };

  // =========================================================
  // Conversation surface, shared by the rail and the selection card
  // =========================================================
  const ICONS = {
    close: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    gear: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.05A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.05a1.7 1.7 0 0 0-1.55 1z"/></svg>',
    back: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
    down: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  };

  const ring = (size) => {
    const node = el("div", `ring ${size}`);
    return node;
  };

  const createStream = (container, { onSourceClick } = {}) => {
    const stream = el("div", "stream");
    container.appendChild(stream);

    let pinned = true;
    let jump = null;

    const atBottom = () => stream.scrollHeight - stream.scrollTop - stream.clientHeight <= NEAR_BOTTOM_PX;
    stream.addEventListener("scroll", () => {
      pinned = atBottom();
      if (jump) jump.classList.toggle("show", !pinned);
    });

    const follow = (force) => {
      if (!force && !pinned) return;
      stream.scrollTop = stream.scrollHeight;
    };

    const addJump = () => {
      jump = el("button", "jump", `${ICONS.down}<span>Latest</span>`);
      jump.type = "button";
      jump.addEventListener("click", () => {
        pinned = true;
        follow(true);
        jump.classList.remove("show");
      });
      container.appendChild(jump);
    };

    // Sources render as footnotes rather than a disclosure. A numbered marker
    // reads as a citation, which is what it is.
    const addRefs = (entry, sources) => {
      const snippets = Array.isArray(sources) ? sources.slice(0, 6).filter(Boolean) : [];
      if (!snippets.length) return;

      const refs = el("div", "refs");
      const label = el("span", "label");
      label.textContent = "Sources";
      refs.appendChild(label);

      snippets.forEach((snippet, i) => {
        const ref = el("button", "ref");
        ref.type = "button";
        ref.textContent = String(i + 1);
        const found = onSourceClick ? findParagraphForSnippet(snippet) : null;
        ref.title = found
          ? `Jump to: ${snippet.slice(0, 90)}`
          : `Not found on this page: ${snippet.slice(0, 90)}`;
        if (!found) ref.classList.add("dead");
        ref.addEventListener("click", () => onSourceClick && onSourceClick(snippet));
        refs.appendChild(ref);
      });

      entry.appendChild(refs);
      follow();
    };

    const addEntry = (role, text, { label, typing = false, sources = [], copyable = true } = {}) => {
      if (role === "user") {
        const entry = el("div", "entry ask");
        const p = document.createElement("p");
        p.textContent = text;
        entry.appendChild(p);
        stream.appendChild(entry);
        follow(true);
        return entry;
      }

      const entry = el("article", `entry ${role === "warn" ? "warn" : ""}`.trim());
      const head = el("div", "entry-head");
      const tag = el("span", "label");
      tag.textContent = label || "Summary";
      head.appendChild(tag);
      entry.appendChild(head);

      const body = el("div", "entry-body");
      entry.appendChild(body);

      const acts = el("div", "acts");
      entry.__esActs = acts;
      entry.appendChild(acts);

      if (copyable) {
        const copy = el("button", "act");
        copy.type = "button";
        copy.textContent = "Copy";
        let revert = 0;
        copy.addEventListener("click", () => {
          copyText(text);
          // Clicking Copy used to look like nothing happened at all.
          copy.textContent = "Copied";
          copy.classList.add("ok");
          clearTimeout(revert);
          revert = setTimeout(() => {
            copy.textContent = "Copy";
            copy.classList.remove("ok");
          }, 1400);
        });
        acts.appendChild(copy);
      }

      stream.appendChild(entry);
      follow(true);

      renderMarkdown(text, body);
      if (typing) {
        revealMarkdown(body, {
          onTick: () => follow(),
          onDone: () => {
            addRefs(entry, sources);
            follow();
          },
        });
      } else {
        addRefs(entry, sources);
        follow(true);
      }
      return entry;
    };

    const addPending = (label) => {
      const entry = el("article", "entry");
      const head = el("div", "entry-head");
      const tag = el("span", "label");
      tag.textContent = label || "Working";
      head.appendChild(tag);
      const body = el("div", "entry-body");
      body.appendChild(el("span", "thinking", "<i></i><i></i><i></i>"));
      entry.append(head, body);
      stream.appendChild(entry);
      follow(true);
      return entry;
    };

    const addFailure = (message, onRetry) => {
      const entry = addEntry("warn", message, { label: "Error", copyable: false });
      if (onRetry) {
        const retry = el("button", "act pinned");
        retry.type = "button";
        retry.textContent = "Retry";
        retry.addEventListener("click", () => {
          entry.remove();
          onRetry();
        });
        entry.__esActs.appendChild(retry);
      }
      return entry;
    };

    // A skeleton in the shape of the answer, rather than a spinner in a void:
    // it fills the panel with what is about to arrive instead of dead space.
    const addLoader = (message) => {
      const box = el("div", "loading");
      const head = el("div", "entry-head");
      const tag = el("span", "label");
      tag.textContent = message;
      head.appendChild(tag);

      const lines = el("div", "skeleton");
      for (let i = 0; i < 4; i++) lines.appendChild(el("span", "sk-line"));

      box.append(head, lines);
      stream.appendChild(box);
      follow(true);
      return box;
    };

    return { stream, addEntry, addPending, addFailure, addLoader, addJump, follow };
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

  // =========================================================
  // Selection card
  // =========================================================
  const openSelectionCard = ({ text: selectedText, rect, anchorId, anchorOffset }) => {
    const popup = document.getElementById("es-selection-popup");
    if (!popup?.shadowRoot) return false;

    popup.dataset.expanded = "true";
    popup.style.setProperty("pointer-events", "none", "important");

    const root = popup.shadowRoot.querySelector(".root");
    if (!root) return false;
    root.replaceChildren();

    const card = el("div", "card");
    root.appendChild(card);
    requestAnimationFrame(() => root.classList.add("in"));

    const bar = el("div", "head");
    const mark = ring("ring-sm");
    const wordmark = el("div", "wordmark");
    const name = el("div", "name");
    name.textContent = "Selection";
    wordmark.appendChild(name);
    const close = el("button", "icon-btn", ICONS.close);
    close.type = "button";
    close.title = "Close";
    close.setAttribute("aria-label", "Close");
    bar.append(mark, wordmark, close);
    card.appendChild(bar);

    const body = el("div", "stream-wrap");
    card.appendChild(body);
    const chat = createStream(body);

    const composer = el("div", "composer");
    const field = el("div", "field");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Ask a follow-up";
    input.setAttribute("aria-label", "Ask a follow-up about the selection");
    field.appendChild(input);
    const send = el("button", "send", ICONS.send);
    send.type = "button";
    send.title = "Send";
    composer.append(field, send);
    card.appendChild(composer);

    // --- position against the original highlight
    const GAP = 10;
    const MARGIN = 8;
    const MAX_CARD = 380;
    const MIN_CARD = 130;
    let placing = false;

    const place = () => {
      // Resizing the card re-enters through the observer below.
      if (placing) return;
      placing = true;

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

      // Take whichever side of the highlight has more room and cap the card to
      // it, so a tall conversation scrolls inside the card instead of growing
      // across the text it is about.
      const spaceAbove = (base.top || 0) - GAP - MARGIN;
      const spaceBelow = window.innerHeight - (base.bottom || 0) - GAP - MARGIN;
      const above = spaceAbove >= spaceBelow;
      const room = Math.max(MIN_CARD, Math.floor(above ? spaceAbove : spaceBelow));
      card.style.maxHeight = `${Math.min(MAX_CARD, room)}px`;

      const box = card.getBoundingClientRect();
      let top = above ? (base.top || 0) - box.height - GAP : (base.bottom || 0) + GAP;
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - box.height - MARGIN));
      let left = base.left || 0;
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - box.width - MARGIN));

      card.style.position = "fixed";
      card.style.left = `${Math.round(left)}px`;
      card.style.top = `${Math.round(top)}px`;
      placing = false;
    };

    let frame = 0;
    const onViewport = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    document.addEventListener("scroll", onViewport, true);
    window.addEventListener("resize", onViewport);

    // The card is placed before the answer arrives, so it has to be placed
    // again as it grows. Without this it drifts down over the text it is
    // summarizing while the reply types in.
    const resize = new ResizeObserver(onViewport);
    resize.observe(card);

    popup.__esCleanup = () => {
      document.removeEventListener("scroll", onViewport, true);
      window.removeEventListener("resize", onViewport);
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (anchorId) document.getElementById(anchorId)?.remove();
    };

    requestAnimationFrame(place);

    const closeCard = () => window.postMessage({ type: "ES_RESTORE_SELECTION_POPUP" }, "*");
    close.addEventListener("click", closeCard);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCard();
    });

    // --- conversation
    const history = [];
    let busy = false;
    const setBusy = (value) => {
      busy = value;
      send.disabled = value;
    };

    const ask = async () => {
      const question = input.value.trim();
      if (!question || busy) return;
      setBusy(true);
      input.value = "";
      chat.addEntry("user", question);
      history.push({ role: "user", content: question });

      const pending = chat.addPending("Answer");
      const { ok, data, error } = await api("ask", {
        text: selectedText,
        selection: selectedText,
        messages: history.slice(-6),
      });
      pending.remove();

      if (ok) {
        const answer = data.answer || "No answer received.";
        history.push({ role: "assistant", content: answer });
        chat.addEntry("assistant", answer, { label: "Answer", typing: animate(), sources: data.sources || [] });
      } else {
        chat.addFailure(friendlyError(error), ask);
      }
      setBusy(false);
      place();
      input.focus();
    };

    send.addEventListener("click", ask);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ask();
    });

    const summarize = async () => {
      setBusy(true);
      const loader = chat.addLoader("Reading");
      const { ok, data, error } = await api("summarize", { text: selectedText, mode: "tldr" });
      loader.remove();

      if (!ok) {
        chat.addFailure(friendlyError(error), summarize);
      } else {
        const summary = data.summary || "";
        const words = selectedText.trim() ? selectedText.trim().split(/\s+/).length : 0;
        if (!summary || words < 10) {
          chat.addEntry("assistant", "There is not much to work with here. What would you like to know?", { label: "Selection", copyable: false });
        } else {
          history.push({ role: "assistant", content: summary });
          chat.addEntry("assistant", summary, { label: "Selection", typing: animate() });
        }
      }
      setBusy(false);
      place();
    };

    summarize();
    return true;
  };

  // =========================================================
  // Route: selection card, or toggle the panel
  // =========================================================
  const existing = document.getElementById("ai-overlay");
  const wantsSelection = selectionRequest?.mode === "selection" && selectionRequest.text;

  if (existing) {
    existing.__esClose?.(true);
    if (!wantsSelection) return;
  }

  if (wantsSelection && openSelectionCard(selectionRequest)) return;

  // =========================================================
  // The rail
  //
  // A side panel rather than a centred modal: the article stays readable
  // beside it, so jumping to a source scrolls the page without closing
  // anything.
  // =========================================================
  const { host, root } = makeHost("ai-overlay");
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-label", "Eternal Summary");
  // documentElement rather than body: a transformed body would become the
  // containing block for our fixed positioning.
  document.documentElement.appendChild(host);

  const pageText = extractPageText();

  // Average adult reading speed, rounded so short pages still read "1 min".
  const readingMinutes = (text) => {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return words ? Math.max(1, Math.round(words / 230)) : 0;
  };

  const teardown = [];
  const on = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    teardown.push(() => target.removeEventListener(event, handler, options));
  };

  const rail = el("div", "rail");
  root.dataset.width = settings.width || "medium";
  root.dataset.side = settings.side || "right";
  root.appendChild(rail);

  const closeRail = (immediate = false) => {
    if (host.dataset.closing === "true") return;
    host.dataset.closing = "true";
    while (teardown.length) teardown.pop()();
    if (immediate) {
      host.remove();
      return;
    }
    root.classList.remove("in");
    root.classList.add("out");
    setTimeout(() => host.remove(), 320);
  };
  host.__esClose = closeRail;
  requestAnimationFrame(() => root.classList.add("in"));

  // --- make room for the rail
  //
  // The rail is fixed, so on its own it would sit *over* the article rather
  // than beside it and the text would run underneath. Inset the document by
  // the rail's width instead: that is what lets a source jump stay readable,
  // and it is the whole reason this is a rail and not a modal. Narrow
  // viewports keep the overlay behaviour, since there is no room to split.
  const MIN_ARTICLE = 320;
  const EASE = "320ms cubic-bezier(0.32, 0.72, 0, 1)";
  let fitPage = () => {};
  {
    const doc = document.documentElement;
    // Restore only what we touch, the way the source highlight does, so a page
    // that sets its own margin on <html> gets it back. Both sides are captured
    // because the rail can move while it is open. Dropping the margin on
    // teardown is synchronous, so a rail opening while another is still
    // sliding out can never capture an inset we wrote ourselves.
    const saved = ["margin-right", "margin-left"].map((name) => [
      name,
      doc.style.getPropertyValue(name),
      doc.style.getPropertyPriority(name),
    ]);

    fitPage = () => {
      const width = Math.round(rail.getBoundingClientRect().width);
      const room = window.innerWidth - width >= MIN_ARTICLE;
      const left = settings.side === "left";
      doc.style.removeProperty(left ? "margin-right" : "margin-left");
      if (!room) {
        doc.style.removeProperty(left ? "margin-left" : "margin-right");
        return;
      }
      // The reduced-motion rule in ui.css only reaches the shadow root, and
      // this margin is on the page's own <html>, so honour it here too.
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      doc.style.setProperty("transition", still ? "none" : `margin ${EASE}`, "important");
      doc.style.setProperty(left ? "margin-left" : "margin-right", `${width}px`, "important");
    };

    fitPage();
    on(window, "resize", fitPage);
    teardown.push(() => {
      // Removing the inset animates the page back, because the transition is
      // still in force; that is the only reason it outlives the margin.
      for (const [name, value, priority] of saved) {
        if (value) doc.style.setProperty(name, value, priority);
        else doc.style.removeProperty(name);
      }
      setTimeout(() => {
        doc.style.removeProperty("transition");
        if (!doc.getAttribute("style")) doc.removeAttribute("style");
      }, 340);
    });
  }

  // --- head
  const head = el("div", "head");
  const mark = ring("ring-sm");
  const wordmark = el("div", "wordmark");
  const name = el("div", "name");
  name.textContent = "Eternal Summary";
  const meta = el("div", "meta");
  const minutes = readingMinutes(pageText);
  meta.innerHTML = minutes
    ? `${location.hostname} <b>&middot;</b> ${minutes} min read`
    : location.hostname;
  meta.title = document.title || location.hostname;
  wordmark.append(name, meta);

  const gearBtn = el("button", "icon-btn gear", ICONS.gear);
  gearBtn.type = "button";
  gearBtn.title = "Settings";
  gearBtn.setAttribute("aria-label", "Settings");

  const closeBtn = el("button", "icon-btn", ICONS.close);
  closeBtn.type = "button";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", () => closeRail());

  head.append(mark, wordmark, gearBtn, closeBtn);
  rail.appendChild(head);

  // --- segmented mode control
  const segments = el("div", "segments");
  segments.setAttribute("role", "group");
  segments.setAttribute("aria-label", "Summary style");
  const segTrack = el("span", "seg-track");
  segments.appendChild(segTrack);

  const known = (id) => MODES.some((m) => m.id === id);
  const savedMode = cacheEl?.dataset?.mode || "";
  const defaultMode = known(settings.format) ? settings.format : MODES[0].id;
  // Remembering is on by default, so this matches the old behaviour until the
  // reader turns it off and pins a format instead.
  let activeMode =
    settings.rememberFormat !== false && known(savedMode) ? savedMode : defaultMode;
  const segs = new Map();

  const paintModes = () => {
    for (const [id, seg] of segs) seg.setAttribute("aria-pressed", String(id === activeMode));
    const active = segs.get(activeMode);
    if (!active) return;
    segTrack.style.width = `${active.offsetWidth}px`;
    segTrack.style.transform = `translateX(${active.offsetLeft}px)`;
  };

  for (const mode of MODES) {
    const seg = el("button", "seg");
    seg.type = "button";
    seg.textContent = mode.label;
    seg.addEventListener("click", () => {
      if (busy || activeMode === mode.id) return;
      activeMode = mode.id;
      paintModes();
      writeModePref(activeMode);
      runSummary({ force: true });
    });
    segs.set(mode.id, seg);
    segments.appendChild(seg);
  }
  rail.appendChild(segments);
  // Pressed state now, track geometry once there is layout to measure. Leaving
  // both to the frame callback made the active mode briefly unreadable to
  // assistive tech, and to anyone reading it right after open.
  paintModes();
  requestAnimationFrame(paintModes);
  on(window, "resize", paintModes);

  // --- stream
  const streamWrap = el("div", "stream-wrap");
  rail.appendChild(streamWrap);

  const chat = createStream(streamWrap, {
    onSourceClick: (snippet) => {
      const target = findParagraphForSnippet(snippet);
      if (!target) {
        showToast("Not found on this page");
        return;
      }
      // The rail sits beside the article, so this needs no dismissal.
      highlightParagraph(target);
    },
  });
  chat.addJump();

  // --- selection strip
  const selStrip = el("div", "sel");
  const selText = el("div", "sel-txt");
  const explainBtn = el("button", "sel-act");
  explainBtn.type = "button";
  explainBtn.textContent = "Explain";
  const sumSelBtn = el("button", "sel-act");
  sumSelBtn.type = "button";
  sumSelBtn.textContent = "Summarize";
  selStrip.append(selText, explainBtn, sumSelBtn);
  rail.appendChild(selStrip);

  // --- composer
  const composer = el("div", "composer");
  const field = el("div", "field");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Ask about this page";
  input.setAttribute("aria-label", "Ask about this page");
  field.appendChild(input);
  const sendBtn = el("button", "send", ICONS.send);
  sendBtn.type = "button";
  sendBtn.title = "Send";
  sendBtn.setAttribute("aria-label", "Send");
  composer.append(field, sendBtn);
  rail.appendChild(composer);

  // =========================================================
  // Settings
  //
  // A second view inside the rail rather than a separate options page: it is
  // where the reader already is, and it shares this stylesheet.
  // =========================================================
  const sheet = el("div", "sheet");
  sheet.setAttribute("aria-label", "Settings");

  // Sheet children animate in on a stagger, so each one carries its position.
  let sheetIndex = 0;
  const stagger = (node) => {
    node.style.setProperty("--i", String(sheetIndex++));
    return node;
  };

  const setRow = (name, note, control, { stack = false } = {}) => {
    const row = el("div", `row${stack ? " stack" : ""}`);
    const copy = el("div", "row-copy");
    const title = el("div", "row-name");
    title.textContent = name;
    copy.appendChild(title);
    if (note) {
      const hint = el("div", "row-note");
      hint.textContent = note;
      copy.appendChild(hint);
    }
    row.append(copy, control);
    sheet.appendChild(stagger(row));
    return row;
  };

  const group = (text) => {
    const g = el("div", "group");
    g.textContent = text;
    sheet.appendChild(stagger(g));
  };

  // A switch reads its own state, so the caller never tracks it twice.
  const toggle = (key, { onChange } = {}) => {
    const btn = el("button", "switch");
    btn.type = "button";
    btn.setAttribute("role", "switch");
    const paint = () => btn.setAttribute("aria-checked", String(settings[key] !== false));
    paint();
    btn.addEventListener("click", () => {
      putSettings({ [key]: settings[key] === false });
      paint();
      onChange?.();
    });
    return btn;
  };

  const choices = (key, options, { onChange } = {}) => {
    const wrap = el("div", "choices");
    const buttons = new Map();
    const paint = () => {
      for (const [value, btn] of buttons) {
        btn.setAttribute("aria-pressed", String(settings[key] === value));
      }
    };
    for (const option of options) {
      const btn = el("button", "choice");
      btn.type = "button";
      btn.textContent = option.label;
      btn.addEventListener("click", () => {
        putSettings({ [key]: option.value });
        paint();
        onChange?.();
      });
      buttons.set(option.value, btn);
      wrap.appendChild(btn);
    }
    paint();
    return wrap;
  };

  group("Reading");
  setRow(
    "Default format",
    "What a page opens in when there is nothing remembered.",
    choices("format", MODES.map((m) => ({ value: m.id, label: m.label })), {
      onChange: () => {
        // Pinning a format only means something if we stop remembering.
        if (settings.rememberFormat !== false) {
          putSettings({ rememberFormat: false });
          rememberSwitch.setAttribute("aria-checked", "false");
          showToast("Every page will open in this format");
        }
      },
    }),
    { stack: true }
  );
  const rememberSwitch = toggle("rememberFormat");
  setRow("Remember my last format", "Otherwise every page opens in the default above.", rememberSwitch);
  setRow("Animate text as it arrives", null, toggle("animateText"));

  group("On the page");
  setRow("Highlight the passage when I open a source", null, toggle("highlightSources"));
  setRow(
    "Show the Summarize button when I select text",
    "The floating button beside a selection.",
    toggle("selectionButton")
  );

  group("Panel");
  setRow(
    "Width",
    null,
    choices("width", [
      { value: "narrow", label: "Narrow" },
      { value: "medium", label: "Medium" },
      { value: "wide", label: "Wide" },
    ], {
      onChange: () => {
        root.dataset.width = settings.width;
        // Measuring flushes style and layout, so there is nothing to wait for.
        // Deferring to a frame callback only made this miss when rAF is
        // throttled.
        fitPage();
        paintModes();
      },
    })
  );
  setRow(
    "Side",
    null,
    choices("side", [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ], {
      onChange: () => {
        root.dataset.side = settings.side;
        fitPage();
      },
    })
  );

  group("Saved summaries");
  let savedLeft = savedSummaries;
  const clearBtn = el("button", "row-act");
  clearBtn.type = "button";
  const paintClear = () => {
    clearBtn.textContent = savedLeft ? `Clear ${savedLeft}` : "Nothing saved";
    clearBtn.disabled = !savedLeft;
  };
  paintClear();
  clearBtn.addEventListener("click", () => {
    window.postMessage({ type: "ES_CACHE_CLEAR" }, "*");
    savedLeft = 0;
    paintClear();
    showToast("Saved summaries cleared");
  });
  setRow("Reuse a summary for 30 minutes", "Reopening a page is instant instead of asking again.", toggle("reuseSaved"));
  setRow("Stored on this device", null, clearBtn);

  rail.appendChild(sheet);

  const showSettings = (on) => {
    root.dataset.view = on ? "settings" : "stream";
    gearBtn.setAttribute("aria-expanded", String(on));
    gearBtn.innerHTML = on ? ICONS.back : ICONS.gear;
    gearBtn.title = on ? "Back" : "Settings";
    gearBtn.setAttribute("aria-label", on ? "Back to summary" : "Settings");
  };
  showSettings(false);
  gearBtn.addEventListener("click", () => showSettings(root.dataset.view !== "settings"));

  // =========================================================
  // Behaviour
  // =========================================================
  const history = [];
  let busy = false;

  const setBusy = (value) => {
    busy = value;
    sendBtn.disabled = value;
    segments.dataset.busy = String(value);
  };

  const readCache = () => {
    if (!cacheEl?.dataset?.payload) return null;
    try {
      return JSON.parse(cacheEl.dataset.payload);
    } catch {
      return null;
    }
  };

  // Switching modes appends a new turn instead of wiping the thread, so the
  // conversation up to that point stays readable.
  async function runSummary({ force = false, announce = false } = {}) {
    if (busy) return;
    setBusy(true);

    if (!force) {
      const cached = readCache();
      if (cached?.summary && cached.mode === activeMode) {
        chat.addEntry("assistant", cached.summary, { label: modeLabel(activeMode), typing: animate(), sources: cached.sources || [] });
        history.push({ role: "assistant", content: cached.summary });
        showToast("Showing a saved summary");
        setBusy(false);
        return;
      }
    }

    if (pageText.length < 40) {
      chat.addEntry("assistant", "There is not enough readable text on this page to summarize.", { label: "Nothing to read", copyable: false });
      setBusy(false);
      return;
    }

    const loader = chat.addLoader("Reading");
    const { ok, data, error } = await api("summarize", { text: pageText, mode: activeMode });
    loader.remove();

    if (!ok) {
      chat.addFailure(friendlyError(error), () => runSummary({ force: true }));
      setBusy(false);
      return;
    }

    const summary = data.summary || "No summary received.";
    const sources = data.sources || [];
    history.push({ role: "assistant", content: summary });
    chat.addEntry("assistant", summary, { label: modeLabel(activeMode), typing: animate(), sources });
    writeCache({ summary, sources, mode: activeMode });
    setBusy(false);
  }

  // --- selection awareness
  let selectedText = "";
  const refreshSelection = () => {
    const value = window.getSelection()?.toString().trim() || "";
    selectedText = value;
    if (!value) {
      selStrip.classList.remove("show");
      return;
    }
    selText.textContent = value.length > 90 ? `${value.slice(0, 90)}...` : value;
    selStrip.classList.add("show");
  };
  on(document, "selectionchange", refreshSelection);

  const ask = async (question, override) => {
    const value = (question || input.value).trim();
    if (!value || busy) return;

    input.value = "";
    chat.addEntry("user", value);
    history.push({ role: "user", content: value });
    setBusy(true);

    const pending = chat.addPending("Answer");
    const endpoint = override?.endpoint || "ask";
    const payload =
      override?.payload || {
        text: pageText,
        messages: history.slice(-6),
        selection: selectedText,
      };

    const { ok, data, error } = await api(endpoint, payload);
    pending.remove();

    if (ok) {
      const answer = data.answer || data.summary || "No answer received.";
      history.push({ role: "assistant", content: answer });
      chat.addEntry("assistant", answer, { label: "Answer", typing: animate(), sources: data.sources || [] });
    } else {
      chat.addFailure(friendlyError(error), () => ask(value, override));
    }
    setBusy(false);
    input.focus();
  };

  sendBtn.addEventListener("click", () => ask());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ask();
  });
  explainBtn.addEventListener("click", () => {
    if (selectedText) ask("Explain the highlighted text.");
  });
  sumSelBtn.addEventListener("click", () => {
    if (!selectedText) return;
    ask("Summarize the highlighted text.", {
      endpoint: "summarize",
      payload: { text: selectedText, mode: activeMode },
    });
  });

  on(document, "keydown", (e) => {
    if (e.key === "Escape") closeRail();
  });

  // Keep Tab inside the dialog. Without this a keyboard user tabs straight out
  // into the page behind an overlay they cannot see past.
  rail.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusable = Array.from(
      rail.querySelectorAll("button:not([disabled]), input:not([disabled])")
    ).filter((node) => node.getClientRects().length > 0);
    if (focusable.length < 2) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = host.shadowRoot.activeElement;

    if (e.shiftKey && (active === first || !focusable.includes(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  runSummary();
  setTimeout(() => input.focus(), 260);
})();
