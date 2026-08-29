// Content script. Bridges the page-context overlay to the extension, and owns
// the floating "Summarize" button that follows a text selection.

if (window.__esListenerLoaded) {
  // Injected twice (manifest plus the background fallback). Nothing to do.
} else {
  window.__esListenerLoaded = true;

  const CACHE_TTL_MS = 30 * 60 * 1000;
  const cacheKey = () => `summary:${location.href}`;
  const ICON_URL = chrome.runtime.getURL("icons/icon-32.png");

  const showOverlay = () => {
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

  const restoreSelectionPopup = () => {
    const popup = document.getElementById(POPUP_ID);
    if (!popup) return;
    if (popup.__esCleanup) {
      popup.__esCleanup();
      popup.__esCleanup = null;
    }
    if (popup.__esOriginalChildren) popup.replaceChildren(...popup.__esOriginalChildren);
    if (popup.__esOriginalStyle) popup.setAttribute("style", popup.__esOriginalStyle);
    if (popup.__esOriginalParent && popup.parentNode !== popup.__esOriginalParent) {
      const next = popup.__esOriginalNextSibling;
      if (next && next.parentNode === popup.__esOriginalParent) {
        popup.__esOriginalParent.insertBefore(popup, next);
      } else {
        popup.__esOriginalParent.appendChild(popup);
      }
    }
    popup.dataset.expanded = "false";
    popup.style.display = "none";
  };

  const ensureStore = () => {
    let store = document.getElementById(STORE_ID);
    if (!store) {
      store = document.createElement("div");
      store.id = STORE_ID;
      store.style.display = "none";
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
      Object.assign(anchor.style, {
        display: "inline-block",
        width: "0px",
        height: "0px",
        overflow: "hidden",
        padding: "0",
        margin: "0",
        border: "0",
        lineHeight: "0",
      });
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

  const ensurePopup = () => {
    let popup = document.getElementById(POPUP_ID);
    if (popup) return popup;

    popup = document.createElement("button");
    popup.id = POPUP_ID;
    popup.type = "button";
    Object.assign(popup.style, {
      position: "fixed",
      zIndex: "1000002",
      padding: "0.35rem 0.65rem 0.35rem 0.5rem",
      borderRadius: "12px",
      border: "1px solid rgba(99, 102, 241, 0.3)",
      background: "rgba(10, 10, 30, 0.95)",
      color: "#e0e7ff",
      fontSize: "0.78rem",
      letterSpacing: "0.2px",
      boxShadow: "0 8px 24px rgba(8, 8, 20, 0.4), 0 0 0 1px rgba(99, 102, 241, 0.08)",
      cursor: "pointer",
      display: "none",
      transition:
        "opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease",
      opacity: "0",
      transform: "translateY(6px) scale(0.96)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
    });

    const icon = document.createElement("img");
    icon.src = ICON_URL;
    icon.alt = "";
    Object.assign(icon.style, {
      width: "16px",
      height: "16px",
      borderRadius: "4px",
      marginRight: "0.35rem",
      boxShadow: "0 0 0 1px rgba(255,255,255,0.2), 0 0 12px rgba(99,102,241,0.45)",
      animation: "esPulse 1.6s ease-in-out infinite",
    });

    const label = document.createElement("span");
    label.textContent = "Summarize";
    Object.assign(label.style, {
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontWeight: "600",
      display: "inline-block",
      transform: "translateY(-0.5px)",
    });

    popup.appendChild(icon);
    popup.appendChild(label);

    const style = document.createElement("style");
    style.textContent = `
      @keyframes esPulse {
        0%, 100% { transform: scale(1); filter: brightness(1); }
        50% { transform: scale(1.06); filter: brightness(1.1); }
      }
      @keyframes esFloat {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-2px); }
      }
      #${POPUP_ID}:hover {
        box-shadow: 0 12px 32px rgba(8, 8, 20, 0.5), 0 0 0 1px rgba(99, 102, 241, 0.2);
        border-color: rgba(99, 102, 241, 0.5) !important;
        transform: translateY(1px) scale(1.02) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    popup.addEventListener("click", (e) => {
      // Already showing a summary card, let the card handle its own clicks.
      if (popup.dataset.expanded === "true") return;
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

    (document.documentElement || document.body).appendChild(popup);
    popup.__esOriginalChildren = Array.from(popup.childNodes);
    popup.__esOriginalStyle = popup.getAttribute("style") || "";
    popup.__esOriginalParent = popup.parentNode;
    popup.__esOriginalNextSibling = popup.nextSibling;
    return popup;
  };

  const positionPopup = (popup, rect) => {
    const offset = 10;
    const popupRect = popup.getBoundingClientRect();
    let top = rect.top - popupRect.height - offset;
    if (top < 8) top = rect.bottom + offset;
    let left = rect.left;
    if (left + popupRect.width > window.innerWidth - 8) {
      left = window.innerWidth - popupRect.width - 8;
    }
    if (left < 8) left = 8;
    popup.style.top = `${Math.round(top)}px`;
    popup.style.left = `${Math.round(left)}px`;
  };

  const updatePopup = () => {
    const selection = window.getSelection();
    const textValue = selection ? selection.toString().trim() : "";
    const popup = ensurePopup();

    if (popup.dataset.expanded === "true") {
      popup.style.display = "inline-flex";
      popup.style.alignItems = "stretch";
      return;
    }

    if (!textValue) {
      popup.style.opacity = "0";
      popup.style.transform = "translateY(6px) scale(0.98)";
      popup.style.animation = "none";
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        popup.style.display = "none";
      }, 220);
      return;
    }

    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    popup.style.display = "inline-flex";
    popup.style.alignItems = "center";
    popup.style.opacity = "0";
    popup.style.transform = "translateY(6px) scale(0.98)";
    popup.style.animation = "esFloat 2.6s ease-in-out infinite";
    requestAnimationFrame(() => {
      popup.style.opacity = "1";
      popup.style.transform = "translateY(0) scale(1)";

      let rect = range ? range.getBoundingClientRect() : null;
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        rect = {
          top: lastPointer.y,
          bottom: lastPointer.y,
          left: lastPointer.x,
          right: lastPointer.x,
        };
      }
      lastRect = rect;
      positionPopup(popup, rect);
    });
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
