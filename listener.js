if (window.__es_listener_loaded) {
  // Prevent duplicate injections that redeclare top-level consts.
} else {
  window.__es_listener_loaded = true;

const showOverlay = () => {
  const cacheKey = `summary:${location.href}`;
  chrome.storage.local.get(cacheKey, (res) => {
    const cache = res?.[cacheKey] || {};
    let cacheEl = document.getElementById("es-cache");
    if (!cacheEl) {
      cacheEl = document.createElement("div");
      cacheEl.id = "es-cache";
      cacheEl.style.display = "none";
      document.documentElement.appendChild(cacheEl);
    }
    cacheEl.dataset.payload = JSON.stringify(cache);

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content.js");
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  });
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "showOverlay") {
    showOverlay();
    sendResponse({ ok: true });
    return;
  }
  sendResponse({ ok: false });
});

// Bridge page-context requests (content.js) to extension background.
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.type !== "ES_API_REQUEST") return;
  const { requestId, url, options } = msg;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "ES_API_REQUEST",
      url,
      options,
    });
    window.postMessage({ type: "ES_API_RESPONSE", requestId, result }, "*");
  } catch (err) {
    window.postMessage(
      {
        type: "ES_API_RESPONSE",
        requestId,
        result: { ok: false, error: err?.message || String(err) },
      },
      "*"
    );
  }
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.type !== "ES_RESTORE_SELECTION_POPUP") return;
  const popup = document.getElementById("es-selection-popup");
  if (!popup) return;
  if (popup.__esOriginalChildren) {
    popup.replaceChildren(...popup.__esOriginalChildren);
  }
  if (popup.__esOriginalStyle) {
    popup.setAttribute("style", popup.__esOriginalStyle);
  }
  if (popup.__esOriginalParent && popup.parentNode !== popup.__esOriginalParent) {
    if (popup.__esOriginalNextSibling && popup.__esOriginalNextSibling.parentNode === popup.__esOriginalParent) {
      popup.__esOriginalParent.insertBefore(popup, popup.__esOriginalNextSibling);
    } else {
      popup.__esOriginalParent.appendChild(popup);
    }
  }
  popup.dataset.expanded = "false";
});

// Floating popup on text selection (no need to click extension icon)
(() => {
  const POPUP_ID = "es-selection-popup";
  const STORE_ID = "es-selection-store";
  let lastPointer = { x: 0, y: 0 };
  let lastRect = null;
  let hideTimer = null;

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

  const ensurePopup = () => {
    let popup = document.getElementById(POPUP_ID);
    if (popup) return popup;

    popup = document.createElement("button");
    popup.id = POPUP_ID;
    popup.type = "button";
    popup.innerHTML = "";
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
      transition: "opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease",
      opacity: "0",
      transform: "translateY(6px) scale(0.96)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
    });

    const icon = document.createElement("img");
    const ICON_DATA =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAEfklEQVRIDe1WW2gcVRg+t7ls9pbU3GpNmprEmBip2ootSsXYPvmg74IIKuiLIEUFfatQRLQoPmigDypFH3wQRIu0aoOCtdI2pRpIE9ONppts0k2ymdndmdmZc47/7G5md8NuW0jok4dh9sx/+/47i+PxmEQSlQ9G/r30rroCoXQkRjgQBlKJUaLgolrALeswEArUi0ZKX8V31bUM4FNK1DKhSsW/An41A+6k1qMN3C34JJX0bIG1OiZIHdqWkv4HuGk6b5QimA+JxM1MQOMHvV9Htj4AFw48jGoKC0vEObekrEWSQnALSU6UJsJ0yQvSc+qYRwgGreaA10K4uzqfHO55Lh4f9IiSsednk99dnf3SLRiEqCAtpUtZtLXv+ea+p0hbN1eEtTaVGf88N3kKE2XD4GJYFVUIUkh+YOitR+49LIgKLhUwsrF0MV1Inz3/xytZYxJjooZ7uva+F+1+TDQpIqxynYoQ4dRb+fWD1ZNHEKHV0051XQsAPOHs7X3h4P1HueQcibR5ZdX6F7EIR5Q1dcXan1hOnRYStw0f1VvuE8gT0raMKddbxZEWwbA2cMDLLjpXf8dUCWxWACDLYb316Yc+0ZSYK+yfLr8xNv76lcRn84s/6tF7aKgL0ZgWHTTNFaR2SswcYyJ17s30+Q+NS1+4xj/6wIhUVbZjKH/ha1mwgkRVALh0ettGHt71Iib0YuL4LxPvQDZgdeVzc6n570PxPVht50gpWNfNpTHPSmX+/qhgJEAGCW7PnqUtnVrfPhxtdhLn3OQEpuXqwrIrRwMRbAvfTRCVgicWzxCiYFiFCOB0r5CZuvSqaSbyuSXC2pGXyc2fEK6JKaQXFijBVLWnzwgoP0Ossw8aJUjRxjb1uxpDY9e0NvSGlZ1JzoxCtbnwmNZbXMPrrvnGJMBI2Jxgzw+7cirbFIJdySdcxAUiOztGoFmLvS+hKTFWotFD+fSfWeMvHNlOm3Yq4X0IUSQ93zT4Kzxt8BCYBr+8pRkACxAqNYCE5N2V/h3PECUSjw3ZXjaTnQK5cFNfR8ezemgASdUyLijte2iolSgxqrQiYUqeh0GL7H8pevA1qSl8LWl+cwR5doBRMweesHf3vvzo7mMOd1yJ0sZ01l4WKGzZGcteNszJpdQojffHH3jXd5GvEYUjjdPObtIzLMIURVjmq8O5Ux9jJVQnAiBBsZYyFzlW4tv2c0wJizP1DkQ1mK2cNZ1aOO56y9xKesaE1v241vUga7uLbe8nrXfKsCYVZJ4+ljv5PmYwBJUyVFJUxAQGXrj+czozjmiIY+bynJmbTiZPzM196rrLGDN4eP6ac+0H4Rok0iJVRXgZZ+4349u382OjiLBgAkpB1KQoiEsIB+QUpRnMea4hhF3cQpXSQWEldzALET0GbS2sDCw+zPTAQnDB8eZYbU8GLOhqv52x/6+jEnKF7d+KG90XqsKulWCNrPtajdXWjcCUNcIuizREXjex2d/KqtispQb6tyGCmq3TwI1NkG9DBJvw7lZUbzWCGyTyBizw4D+pwOK3EPnBoQAAAABJRU5ErkJggg==";
    icon.src = ICON_DATA;
    icon.alt = "";
    Object.assign(icon.style, {
      width: "16px",
      height: "16px",
      borderRadius: "4px",
      marginRight: "0.35rem",
      boxShadow: "0 0 0 1px rgba(255,255,255,0.2), 0 0 12px rgba(99,102,241,0.45)",
      animation: "esPulse 1.6s ease-in-out infinite",
    });
    icon.addEventListener("error", () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none"><rect width="16" height="16" rx="3" fill="#6366F1"/><path d="M4 5.2h8v1.2H4V5.2Zm0 2.3h8v1.2H4V7.5Zm0 2.3h5.3V11H4V9.8Z" fill="#fff"/></svg>`;
      icon.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }, { once: true });

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
    document.head.appendChild(style);

    popup.addEventListener("click", (e) => {
      // If already expanded (showing summary/follow-up), don't re-trigger
      if (popup.dataset.expanded === "true") {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const selection = window.getSelection();
      const textValue = selection ? selection.toString().trim() : "";
      let anchorId = "";
      let anchorOffset = "";
      if (selection && selection.rangeCount) {
        try {
          const range = selection.getRangeAt(0).cloneRange();
          const selectionRect = range.getBoundingClientRect();
          const anchor = document.createElement("span");
          anchorId = `es-selection-anchor-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`;
          anchor.id = anchorId;
          anchor.setAttribute("data-es-anchor", "true");
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
          anchorOffset = JSON.stringify({
            top: selectionRect.top - anchorRect.top,
            bottom: selectionRect.bottom - anchorRect.top,
            left: selectionRect.left - anchorRect.left,
          });
        } catch {
          anchorId = "";
          anchorOffset = "";
        }
      }
      const store = ensureStore();
      store.dataset.text = textValue;
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

    if (textValue) {
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
      });
      requestAnimationFrame(() => {
        let rect = null;
        if (range) rect = range.getBoundingClientRect();
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
    } else {
      popup.style.opacity = "0";
      popup.style.transform = "translateY(6px) scale(0.98)";
      popup.style.animation = "none";
      hideTimer = setTimeout(() => {
        popup.style.display = "none";
      }, 220);
    }
  };

  // Only show after mouseup to avoid flicker while dragging
  document.addEventListener("mouseup", (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    updatePopup();
    setTimeout(updatePopup, 0);
    setTimeout(updatePopup, 80);
  }, true);
  document.addEventListener("keyup", updatePopup, true);
  window.addEventListener("scroll", updatePopup, { passive: true });
  window.addEventListener("resize", updatePopup);
})();

}

// Precompute summary on page load for instant overlay
(() => {
  // TEMP: disable precompute to reduce background load while diagnosing OOM.
  return;
  const cacheKey = `summary:${location.href}`;
  const now = Date.now();
  const TTL = 10 * 60 * 1000;

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

  const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await readJson(response);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err };
    } finally {
      clearTimeout(id);
    }
  };

  chrome.storage.local.get(cacheKey, async (res) => {
    const cached = res?.[cacheKey];
    if (cached && now - cached.ts < TTL) return;

    const pageText = document.body?.innerText || "";
    if (pageText.length < 200) return;

    const text = pageText.slice(0, 8000);
    const { ok, data, error } = await fetchJsonWithTimeout(
      "https://ai-extension-backend-twilight-forest-3247.fly.dev/api/summarize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }
    );
    if (!ok) {
      // Silent fail for precompute
      console.error("Precompute failed:", error);
      return;
    }
    if (!data?.summary) return;
      chrome.storage.local.set({
        [cacheKey]: {
          summary: data.summary,
          sources: data.sources || [],
          ts: Date.now(),
        },
      });
  });
})();
