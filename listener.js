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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "showOverlay") {
    showOverlay();
  }
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
      padding: "0.3rem 0.55rem 0.3rem 0.45rem",
      borderRadius: "999px",
      border: "1px solid rgba(199, 210, 254, 0.35)",
      background: "rgba(10, 10, 30, 0.92)",
      color: "#e0e7ff",
      fontSize: "0.76rem",
      letterSpacing: "0.2px",
      boxShadow: "0 10px 30px rgba(8, 8, 20, 0.35)",
      cursor: "pointer",
      display: "none",
      transition: "opacity 0.22s ease, transform 0.22s ease, box-shadow 0.22s ease",
      opacity: "0",
      transform: "translateY(6px) scale(0.98)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
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
        50% { transform: scale(1.08); filter: brightness(1.15); }
      }
      @keyframes esFloat {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-2px); }
      }
      #${POPUP_ID}:hover {
        box-shadow: 0 12px 34px rgba(8, 8, 20, 0.5);
        transform: translateY(2px) scale(1);
      }
    `;
    document.head.appendChild(style);

    popup.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const selection = window.getSelection();
      const textValue = selection ? selection.toString().trim() : "";
      const store = ensureStore();
      store.dataset.text = textValue;
      store.dataset.mode = "selection";
      store.dataset.rect = JSON.stringify(lastRect || {});
      showOverlay();
    });

    (document.documentElement || document.body).appendChild(popup);
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
  const cacheKey = `summary:${location.href}`;
  const now = Date.now();
  const TTL = 10 * 60 * 1000;

  chrome.storage.local.get(cacheKey, async (res) => {
    const cached = res?.[cacheKey];
    if (cached && now - cached.ts < TTL) return;

    const pageText = document.body?.innerText || "";
    if (pageText.length < 200) return;

    const text = pageText.slice(0, 8000);
    try {
      const response = await fetch("https://ai-extension-backend.fly.dev/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!data?.summary) return;
      chrome.storage.local.set({
        [cacheKey]: {
          summary: data.summary,
          sources: data.sources || [],
          ts: Date.now(),
        },
      });
    } catch (err) {
      // Silent fail for precompute
      console.error("Precompute failed:", err);
    }
  });
})();
