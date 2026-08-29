// Content script. Bridges the page-context overlay to the extension, and owns
// the floating "Summarize" button that follows a text selection.

if (window.__esListenerLoaded) {
  // Injected twice (manifest plus the background fallback). Nothing to do.
} else {
  window.__esListenerLoaded = true;

  const CACHE_TTL_MS = 30 * 60 * 1000;
  const cacheKey = () => `summary:${location.href}`;
  const ICON_URL = chrome.runtime.getURL("icons/icon-32.png");

  // One stylesheet, shared by the trigger here and the panel in page context.
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

  const showOverlay = async () => {
    const css = await loadCss();
    const key = cacheKey();
    chrome.storage.local.get(key, (res) => {
      const entry = res?.[key];
      const fresh = entry && Date.now() - (entry.ts || 0) < CACHE_TTL_MS;

      let cacheEl = document.getElementById("es-cache");
      if (!cacheEl) {
        cacheEl = document.createElement("div");
        cacheEl.id = "es-cache";
        cacheEl.style.display = "none";
        document.documentElement.appendChild(cacheEl);
      }
      cacheEl.dataset.payload = JSON.stringify(fresh ? entry : {});
      cacheEl.dataset.iconUrl = ICON_URL;
      cacheEl.dataset.css = css;

      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("content.js");
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
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

  // === Page bridge ===
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "ES_API_REQUEST") {
      try {
        const result = await chrome.runtime.sendMessage({
          type: "ES_API_REQUEST",
          endpoint: msg.endpoint,
          payload: msg.payload,
        });
        window.postMessage({ type: "ES_API_RESPONSE", requestId: msg.requestId, result }, "*");
      } catch (err) {
        window.postMessage(
          {
            type: "ES_API_RESPONSE",
            requestId: msg.requestId,
            result: { ok: false, error: err?.message || String(err) },
          },
          "*"
        );
      }
      return;
    }

    if (msg.type === "ES_CACHE_SET") {
      if (!msg.value?.summary) return;
      chrome.storage.local.set({
        [cacheKey()]: { ...msg.value, ts: Date.now() },
      });
      return;
    }

    if (msg.type === "ES_RESTORE_SELECTION_POPUP") {
      restoreSelectionPopup();
    }
  });

  // === Floating selection button ===
  const POPUP_ID = "es-selection-popup";
  const STORE_ID = "es-selection-store";
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

    const mark = document.createElement("span");
    mark.className = "mark";
    mark.style.backgroundImage = `url("${ICON_URL}")`;

    const label = document.createElement("span");
    label.textContent = "Summarize";

    button.append(mark, label);
    root.appendChild(button);
    return button;
  };

  const restoreSelectionPopup = () => {
    const popup = document.getElementById(POPUP_ID);
    if (!popup?.shadowRoot) return;
    if (popup.__esCleanup) {
      popup.__esCleanup();
      popup.__esCleanup = null;
    }
    popup.dataset.expanded = "false";
    popup.style.setProperty("display", "none", "important");
    popup.style.setProperty("pointer-events", "none", "important");
    wireTrigger(buildTrigger(popup.shadowRoot));
  };

  const ensureStore = () => {
    let store = document.getElementById(STORE_ID);
    if (!store) {
      store = document.createElement("div");
      store.id = STORE_ID;
      store.style.setProperty("display", "none", "important");
      document.documentElement.appendChild(store);
    }
    return store;
  };

  const markSelectionAnchor = (selection) => {
    if (!selection?.rangeCount) return { anchorId: "", anchorOffset: "" };
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
        anchorOffset: JSON.stringify({
          top: selectionRect.top - anchorRect.top,
          bottom: selectionRect.bottom - anchorRect.top,
          left: selectionRect.left - anchorRect.left,
        }),
      };
    } catch {
      return { anchorId: "", anchorOffset: "" };
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

      const store = ensureStore();
      store.dataset.text = selectedText;
      store.dataset.mode = "selection";
      store.dataset.rect = JSON.stringify(lastRect || {});
      store.dataset.anchorId = anchorId;
      store.dataset.anchorOffset = anchorOffset;
      showOverlay();
    });
  };

  const ensurePopup = async () => {
    let popup = document.getElementById(POPUP_ID);
    if (popup) return popup;

    popup = document.createElement("div");
    popup.id = POPUP_ID;
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

    const shadow = popup.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = await loadCss();
    shadow.appendChild(style);
    const root = document.createElement("div");
    root.className = "root";
    shadow.appendChild(root);

    document.documentElement.appendChild(popup);
    wireTrigger(buildTrigger(shadow));
    return popup;
  };

  const placeTrigger = (popup, rect) => {
    const button = popup.shadowRoot?.querySelector(".trigger");
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

  const updatePopup = async () => {
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
