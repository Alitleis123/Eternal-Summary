// Content script. Owns the floating "Summarize" button that follows a text
// selection, keeps storage and settings, and opens the panel by importing
// content.js into this same isolated world, out of the page's reach.

if (window.__esListenerLoaded) {
  // Injected twice (manifest plus the background fallback). Nothing to do.
} else {
  window.__esListenerLoaded = true;

  const CACHE_TTL_MS = 30 * 60 * 1000;
  const cacheKey = () => `summary:${location.href}`;
  const CACHE_PREFIX = "summary:";
  const MODE_KEY = "es:mode";
  const SETTINGS_KEY = "es:settings";

  // Defaults live only here. The panel is handed a fully merged object, so it
  // never has to know what a default is, and the two can never disagree.
  const DEFAULTS = {
    format: "tldr",
    rememberFormat: true,
    highlightSources: true,
    selectionButton: true,
    animateText: true,
    reuseSaved: true,
    // "page" means leave it in whatever language the page is written in.
    language: "page",
    width: "medium",
    side: "right",
    cardSize: "medium",
  };
  const merge = (raw) => ({ ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) });

  let settings = { ...DEFAULTS };
  chrome.storage.local.get([SETTINGS_KEY], (res) => {
    settings = merge(res?.[SETTINGS_KEY]);
    if (!settings.selectionButton) hideTrigger();
  });

  // One stylesheet, shared by the trigger here and the panel.
  let cssPromise = null;
  const loadCss = () => {
    if (!cssPromise) {
      cssPromise = fetch(chrome.runtime.getURL("ui.css"))
        .then((r) => r.text())
        .catch(() => "");
    }
    return cssPromise;
  };
  loadCss();

  // Everything the panel may do to storage, as plain calls. These were page
  // messages once, and any script on the page could post them too.
  const panelCalls = {
    setSettings: (patch) => {
      settings = merge({ ...settings, ...patch });
      chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      // Take effect on the page immediately, not on the next load.
      if (!settings.selectionButton) hideTrigger();
    },
    setMode: (mode) => {
      if (typeof mode === "string" && mode) chrome.storage.local.set({ [MODE_KEY]: mode });
    },
    writeCache: (value) => {
      if (!value?.summary || !settings.reuseSaved) return;
      chrome.storage.local.set({ [cacheKey()]: { ...value, ts: Date.now() } });
    },
    clearCache: () => {
      chrome.storage.local.get(null, (res) => {
        const keys = Object.keys(res || {}).filter((k) => k.startsWith(CACHE_PREFIX));
        if (keys.length) chrome.storage.local.remove(keys);
      });
    },
    restorePopup: () => restoreSelectionPopup(),
  };

  // `selection` is set when the floating button asked for this, and absent for
  // the toolbar and the shortcut.
  const showOverlay = async (selection = null) => {
    const [css, panel] = await Promise.all([loadCss(), import(chrome.runtime.getURL("content.js"))]);
    const key = cacheKey();
    // Read everything: the settings view shows how many summaries are saved.
    chrome.storage.local.get(null, (res) => {
      settings = merge(res?.[SETTINGS_KEY]);
      // Past thirty minutes a summary is deleted, not only passed over, or the
      // store would keep every URL ever summarized.
      const isFresh = (value) => Date.now() - (value?.ts || 0) < CACHE_TTL_MS;
      const cached = Object.keys(res || {}).filter((k) => k.startsWith(CACHE_PREFIX));
      const expired = cached.filter((k) => !isFresh(res[k]));
      if (expired.length) chrome.storage.local.remove(expired);

      const entry = res?.[key];
      const fresh = settings.reuseSaved && entry && isFresh(entry);

      panel.open({
        ...panelCalls,
        popup: popupEl,
        css,
        settings: { ...settings },
        saved: cached.length - expired.length,
        cached: fresh ? entry : null,
        mode: res?.[MODE_KEY] || "",
        selection,
      });
    });
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action === "showOverlay") {
      showOverlay();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false });
  });

  // === Floating selection button ===
  const POPUP_ID = "es-selection-popup";
  // Held here rather than looked up by id, which a page may use for its own.
  let popupEl = null;
  let lastPointer = { x: 0, y: 0 };
  let lastRect = null;
  let hideTimer = null;

  // The trigger lives in a shadow root so page stylesheets cannot restyle it.
  const buildTrigger = (shadowRoot) => {
    const root = shadowRoot.querySelector(".root");
    root.replaceChildren();

    const button = document.createElement("button");
    button.type = "button";
    button.className = "trigger";

    // The same mark as the rail, so the trigger reads as the same tool.
    const mark = document.createElement("span");
    mark.className = "mark mark-sm";

    const label = document.createElement("span");
    label.textContent = "Summarize";

    button.append(mark, label);
    root.appendChild(button);
    return button;
  };

  const restoreSelectionPopup = () => {
    const popup = popupEl;
    if (!popup?.__esShadow) return;
    if (popup.__esCleanup) {
      popup.__esCleanup();
      popup.__esCleanup = null;
    }
    popup.dataset.expanded = "false";
    popup.style.setProperty("display", "none", "important");
    popup.style.setProperty("pointer-events", "none", "important");
    // The card collapses the host to a zero-sized box at the document origin so
    // it can be positioned in page coordinates. The trigger wants the viewport
    // layer back.
    for (const [k, v] of Object.entries({
      position: "fixed",
      top: "0", right: "0", bottom: "0", left: "0",
      width: "auto", height: "auto",
    })) {
      popup.style.setProperty(k, v, "important");
    }
    wireTrigger(buildTrigger(popup.__esShadow));
  };

  const markSelectionAnchor = (selection) => {
    if (!selection?.rangeCount) return { anchorId: "", anchorOffset: null };
    try {
      const range = selection.getRangeAt(0).cloneRange();
      const selectionRect = range.getBoundingClientRect();
      const anchor = document.createElement("span");
      const anchorId = `es-anchor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      anchor.id = anchorId;
      anchor.dataset.esAnchor = "true";
      for (const [k, v] of Object.entries({
        display: "inline-block",
        width: "0px",
        height: "0px",
        overflow: "hidden",
        padding: "0",
        margin: "0",
        border: "0",
        "line-height": "0",
      })) {
        anchor.style.setProperty(k, v, "important");
      }
      range.collapse(true);
      range.insertNode(anchor);
      const anchorRect = anchor.getBoundingClientRect();
      return {
        anchorId,
        anchorOffset: {
          top: selectionRect.top - anchorRect.top,
          bottom: selectionRect.bottom - anchorRect.top,
          left: selectionRect.left - anchorRect.left,
        },
      };
    } catch {
      return { anchorId: "", anchorOffset: null };
    }
  };

  const wireTrigger = (button) => {
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const selection = window.getSelection();
      // Read the text first: inserting the anchor mutates the selected nodes,
      // which collapses the live selection.
      const selectedText = selection ? selection.toString().trim() : "";
      const { anchorId, anchorOffset } = markSelectionAnchor(selection);

      showOverlay({ mode: "selection", text: selectedText, rect: lastRect || {}, anchorId, anchorOffset });
    });
  };

  const ensurePopup = async () => {
    if (popupEl?.isConnected) return popupEl;
    // One left by an earlier copy of the extension, updated or reloaded since,
    // cannot be driven from this world. Clear it away rather than reuse it.
    for (const stale of document.querySelectorAll('[data-es-host="popup"]')) stale.remove();

    const popup = document.createElement("div");
    popup.id = POPUP_ID;
    popup.dataset.esHost = "popup";
    for (const [k, v] of Object.entries({
      position: "fixed",
      inset: "0",
      "z-index": "2147483646",
      display: "none",
      margin: "0",
      padding: "0",
      border: "0",
      background: "none",
      "pointer-events": "none",
    })) {
      popup.style.setProperty(k, v, "important");
    }

    // Closed, so the page cannot press the button for the reader. The root is
    // kept on the host, which only this world and content.js can see.
    const shadow = popup.attachShadow({ mode: "closed" });
    popup.__esShadow = shadow;
    const style = document.createElement("style");
    style.textContent = await loadCss();
    shadow.appendChild(style);
    const root = document.createElement("div");
    root.className = "root";
    shadow.appendChild(root);

    document.documentElement.appendChild(popup);
    wireTrigger(buildTrigger(shadow));
    popupEl = popup;
    return popup;
  };

  const placeTrigger = (popup, rect) => {
    const button = popup.__esShadow?.querySelector(".trigger");
    if (!button) return;
    const gap = 8;
    const box = button.getBoundingClientRect();
    let top = rect.top - box.height - gap;
    if (top < 8) top = rect.bottom + gap;
    let left = Math.min(rect.left, window.innerWidth - box.width - 8);
    if (left < 8) left = 8;
    button.style.top = `${Math.round(top)}px`;
    button.style.left = `${Math.round(left)}px`;
  };

  const hideTrigger = () => {
    popupEl?.style.setProperty("display", "none", "important");
  };

  const updatePopup = async () => {
    // An earlier copy of the extension, updated or reloaded since, keeps its
    // listeners on pages that were already open. Everything it would call
    // into is gone, so it stands down instead of offering a dead button.
    if (!chrome.runtime?.id) return;
    if (!settings.selectionButton) {
      hideTrigger();
      return;
    }
    const selection = window.getSelection();
    const textValue = selection ? selection.toString().trim() : "";
    const popup = await ensurePopup();

    if (popup.dataset.expanded === "true") return;

    if (!textValue) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        popup.style.setProperty("display", "none", "important");
      }, 180);
      return;
    }

    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    popup.style.setProperty("display", "block", "important");

    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    let rect = range ? range.getBoundingClientRect() : null;
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      rect = { top: lastPointer.y, bottom: lastPointer.y, left: lastPointer.x };
    }
    lastRect = rect;
    requestAnimationFrame(() => placeTrigger(popup, rect));
  };

  // mouseup rather than selectionchange, so the button does not flicker mid-drag.
  document.addEventListener(
    "mouseup",
    (e) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      updatePopup();
      setTimeout(updatePopup, 0);
    },
    true
  );
  document.addEventListener("keyup", updatePopup, true);
  window.addEventListener("scroll", updatePopup, { passive: true });
  window.addEventListener("resize", updatePopup);
}
