// Stubs the slice of the chrome.* API the extension uses, and wires the
// service worker to the content script so the real message protocol runs.
(() => {
  const backgroundHandlers = [];
  const contentHandlers = [];

  window.__storage = {};
  window.__requests = [];
  window.__injections = [];
  window.__contentScope = false;
  window.__reply = null; // tests override to force failures

  window.chrome = {
    runtime: {
      lastError: undefined,
      getURL: (path) => `/${path}`,
      sendMessage: (msg) =>
        new Promise((resolve) => {
          for (const handler of backgroundHandlers) {
            if (handler(msg, {}, resolve) === true) return;
          }
          resolve(undefined);
        }),
      onMessage: {
        addListener: (h) => (window.__contentScope ? contentHandlers : backgroundHandlers).push(h),
      },
    },
    storage: {
      local: {
        get: (keys, cb) =>
          setTimeout(() => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const key of list) if (key in window.__storage) out[key] = window.__storage[key];
            cb(out);
          }, 0),
        set: (obj, cb) => {
          Object.assign(window.__storage, obj);
          if (cb) cb();
        },
      },
    },
    tabs: {
      query: (_q, cb) => cb([{ id: 1, url: location.href }]),
      sendMessage: (_id, msg, cb) => {
        chrome.runtime.lastError = undefined;
        if (!contentHandlers.length) {
          chrome.runtime.lastError = { message: "Receiving end does not exist." };
          if (cb) cb();
          return;
        }
        for (const handler of contentHandlers) handler(msg, {}, (r) => cb && cb(r));
      },
    },
    scripting: {
      executeScript: (opts, cb) => {
        window.__injections.push(opts);
        chrome.runtime.lastError = undefined;
        if (cb) cb();
      },
    },
    action: { onClicked: { addListener: (h) => (window.__onAction = h) } },
    commands: { onCommand: { addListener: (h) => (window.__onCommand = h) } },
  };

  const realFetch = window.fetch.bind(window);

  window.fetch = (url, options) => {
    if (String(url).endsWith("ui.css")) return realFetch("/ui.css");

    const payload = JSON.parse(options.body);
    window.__requests.push({ url: String(url), body: payload });

    if (window.__reply) return Promise.resolve(window.__reply(url, payload));

    const summarize = String(url).includes("summarize");
    const data = summarize
      ? {
          summary:
            payload.mode === "bullets"
              ? "- Built by the Ptolemaic Kingdom between 280 and 247 BC.\n- Stood up to **130 metres** tall.\n- Ruined by earthquakes between AD 956 and 1323."
              : payload.mode === "key-points"
                ? "1. Commissioned by Ptolemy I.\n2. One of the tallest structures for centuries.\n3. Rediscovered in the harbour in 1994."
                : `Summary in ${payload.mode} mode. The Pharos of Alexandria guided ships for over sixteen centuries.`,
          sources: ["Cras dapibus vivamus elementum semper nisi", "Phasellus viverra nulla ut metus varius"],
        }
      : { answer: `Answer: ${payload.messages.slice(-1)[0].content}`, sources: [] };

    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(data)),
    });
  };

  // background.js first, then listener.js in content-script scope.
  window.__boot = () =>
    new Promise((resolve) => {
      const bg = document.createElement("script");
      bg.src = "/background.js";
      bg.onload = () => {
        const cs = document.createElement("script");
        cs.src = "/listener.js";
        cs.onload = () => {
          window.__contentScope = false;
          resolve(true);
        };
        window.__contentScope = true;
        document.head.appendChild(cs);
      };
      document.head.appendChild(bg);
    });
})();
