// End-to-end tests. Real Chrome, real message protocol: the page posts to
// listener.js, which forwards to background.js, which calls a stubbed backend.
// Only the chrome.* API surface and the network are faked.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { launch, startServer, connect, sleep, findChrome } from "./driver.js";

const PORT = 4173;
const CDP_PORT = 9273;
const PAGE = `http://localhost:${PORT}/article.html`;

let server;
let chrome;
let cdp;

const evaluate = (expr) => cdp.evaluate(expr);
const inPanel = (expr) =>
  evaluate(`(() => { const s = document.getElementById('ai-overlay')?.shadowRoot; return s ? (${expr}) : null; })()`);
const inCard = (expr) =>
  evaluate(`(() => { const s = document.getElementById('es-selection-popup')?.shadowRoot; return s ? (${expr}) : null; })()`);

const reload = async () => {
  await cdp.call("Page.navigate", { url: PAGE });
  await sleep(700);
  await evaluate("window.__boot()");
  await sleep(400);
};

const openPanel = async () => {
  await evaluate("window.__onAction({ id: 1, url: location.href })");
  await sleep(1400);
};

const closePanel = () => evaluate("document.getElementById('ai-overlay')?.__esClose(true)");

const select = (id) =>
  evaluate(`(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('${id}'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  })()`);

const ask = async (question) => {
  await evaluate(`(() => {
    const s = document.getElementById('ai-overlay').shadowRoot;
    const input = s.querySelector('.field input');
    input.value = ${JSON.stringify(question)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await sleep(1400);
};

before(async () => {
  if (!findChrome()) throw new Error("No Chrome binary found. Set CHROME_PATH.");
  server = await startServer(PORT);
  chrome = await launch({ port: PORT, cdpPort: CDP_PORT, url: PAGE });
  cdp = await connect(chrome.target.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Network.enable");
  await cdp.call("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await reload();
});

after(async () => {
  cdp?.close();
  chrome?.proc.kill();
  server?.close();
  // Chrome is still flushing its profile as it exits, so retry the cleanup.
  for (let i = 0; i < 5; i++) {
    try {
      await rm(new URL("./.profile", import.meta.url), { recursive: true, force: true });
      break;
    } catch {
      await sleep(400);
    }
  }
});

describe("panel", () => {
  test("opens from the toolbar and summarizes the page", async () => {
    await reload();
    await openPanel();
    assert.equal(await evaluate("!!document.getElementById('ai-overlay')"), true);
    assert.match(await inPanel("s.textContent"), /tldr mode/);
    assert.equal(await evaluate("window.__requests.length"), 1);
  });

  test("extracts the article and leaves navigation out", async () => {
    const sent = await evaluate("window.__requests[0].body.text");
    assert.match(sent, /Pharos of Alexandria/);
    assert.doesNotMatch(sent, /Home About Contact Subscribe/);
  });

  test("shows an estimated reading time", async () => {
    assert.match(await inPanel("s.querySelector('.wordmark .meta').textContent"), /^localhost · \d+ min read$/);
  });

  test("opens from the keyboard shortcut", async () => {
    await closePanel();
    await evaluate("window.__onCommand('toggle-overlay')");
    await sleep(1400);
    assert.equal(await evaluate("!!document.getElementById('ai-overlay')"), true);
  });

  test("a second toolbar click closes it", async () => {
    await openPanel();
    assert.equal(await evaluate("!!document.getElementById('ai-overlay')"), false);
  });

  test("escape closes it", async () => {
    await openPanel();
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await sleep(500);
    assert.equal(await evaluate("!!document.getElementById('ai-overlay')"), false);
  });

  test("the rail sits beside the article, not on top of it", async () => {
    await openPanel();
    // The page is inset by the rail's width, so no line may run underneath it.
    // Sampling one point on the left would pass even with the text covered.
    const geom = JSON.parse(await evaluate(`(() => {
      const rail = document.getElementById('ai-overlay').shadowRoot
        .querySelector('.rail').getBoundingClientRect();
      const p = document.getElementById('p1').getBoundingClientRect();
      const hit = document.elementFromPoint(40, Math.round(innerHeight / 2));
      return JSON.stringify({ railLeft: rail.left, textRight: p.right,
        covered: hit ? hit.id === 'ai-overlay' : true });
    })()`));
    assert.equal(geom.covered, false, "the page must still take clicks beside the rail");
    assert.ok(
      geom.textRight <= geom.railLeft + 1,
      `article text runs under the rail (right edge ${geom.textRight} > ${geom.railLeft})`
    );
  });

  test("closing gives the page its width back", async () => {
    await closePanel();
    await sleep(700);
    assert.equal(await evaluate("document.documentElement.style.marginRight"), "");
    assert.equal(await evaluate("document.documentElement.hasAttribute('style')"), false,
      "the rail should hand <html> back exactly as it found it");
  });

  test("refuses pages where content scripts cannot run", async () => {
    await evaluate("window.__injections.length = 0");
    for (const url of ["chrome://settings", "about:blank", "view-source:http://x", "https://chromewebstore.google.com/detail/x"]) {
      await evaluate(`window.__onAction({ id: 1, url: ${JSON.stringify(url)} })`);
    }
    await sleep(500);
    assert.equal(await evaluate("!!document.getElementById('ai-overlay')"), false);
    assert.equal(await evaluate("window.__injections.length"), 0);
  });
});

describe("style isolation", () => {
  test("the host page cannot restyle the panel", async () => {
    await reload();
    await openPanel();
    // The fixture forces line-height 1, 24px buttons and 2px letter spacing.
    const lineHeight = parseFloat(await inPanel("getComputedStyle(s.querySelector('.entry-body')).lineHeight"));
    assert.ok(lineHeight > 20, `page CSS collapsed the line height to ${lineHeight}`);
    assert.equal(await inPanel("getComputedStyle(s.querySelector('.seg')).fontSize"), "12.5px");
    assert.equal(await inPanel("getComputedStyle(s.querySelector('.seg')).textTransform"), "none");
    assert.equal(await inPanel("getComputedStyle(s.querySelector('.entry-body')).letterSpacing"), "normal");
  });

  test("the trigger is isolated too", async () => {
    await closePanel();
    await select("p1");
    await sleep(500);
    assert.equal(await inCard("s.querySelector('.trigger').textContent"), "Summarize");
    assert.equal(await inCard("getComputedStyle(s.querySelector('.trigger')).fontSize"), "13px");
    assert.equal(await inCard("getComputedStyle(s.querySelector('.trigger')).textTransform"), "none");
  });
});

describe("markdown", () => {
  test("bullets render as a list, not literal dashes", async () => {
    await reload();
    await openPanel();
    await inPanel("[...s.querySelectorAll('.seg')].find(c => c.textContent === 'Bullets').click()");
    await sleep(1600);
    assert.equal(await inPanel("s.querySelectorAll('.entry-body ul.md-list li').length"), 3);
    assert.doesNotMatch(await inPanel("s.querySelector('ul.md-list li').textContent"), /^-/);
  });

  test("bold markers are rendered, not shown", async () => {
    assert.equal(await inPanel("!!s.querySelector('.entry-body strong')"), true);
    assert.doesNotMatch(await inPanel("s.querySelector('ul.md-list').textContent"), /\*\*/);
  });

  test("numbered lists render as an ordered list", async () => {
    await inPanel("[...s.querySelectorAll('.seg')].find(c => c.textContent === 'Key points').click()");
    await sleep(1600);
    assert.equal(await inPanel("s.querySelectorAll('.entry-body ol.md-list li').length"), 3);
  });

  test("questions the user typed are never parsed as markdown", async () => {
    await ask("why is 2 * 3 * 4 = 24");
    assert.equal(await inPanel("!!s.querySelector('.entry.ask em')"), false);
    assert.match(await inPanel("s.querySelector('.entry.ask p').textContent"), /2 \* 3 \* 4/);
  });
});

describe("conversation", () => {
  test("keeps every turn as the thread grows", async () => {
    await reload();
    await openPanel();
    await ask("First question");
    await ask("Second question");
    assert.equal(await inPanel("s.querySelectorAll('.entry').length"), 5);
    assert.match(await inPanel("s.querySelector('.entry').textContent"), /tldr mode/);
  });

  test("switching mode adds to the thread instead of clearing it", async () => {
    await inPanel("[...s.querySelectorAll('.seg')].find(c => c.textContent === 'Bullets').click()");
    await sleep(1600);
    assert.equal(await inPanel("s.querySelectorAll('.entry').length"), 6);
    assert.match(await inPanel("s.textContent"), /First question/);
    assert.match(await inPanel("s.textContent"), /Second question/);
    assert.equal(
      await inPanel("[...s.querySelectorAll('.entry-head .label')].pop().textContent"),
      "Bullets",
      "the new summary should be labelled with the mode that produced it"
    );
  });

  test("the thread scrolls instead of the panel growing", async () => {
    for (let i = 0; i < 5; i++) await ask(`Filler question ${i}`);
    assert.equal(
      await inPanel(`(() => { const p = s.querySelector('.rail').getBoundingClientRect();
        return p.top >= -1 && p.bottom <= innerHeight + 1; })()`),
      true
    );
    assert.equal(
      await inPanel("(() => { const t = s.querySelector('.stream'); return t.scrollHeight > t.clientHeight; })()"),
      true
    );
  });

  test("scrolling up stops auto-follow and offers a jump back", async () => {
    await inPanel("(() => { const t = s.querySelector('.stream'); t.scrollTop = 0; t.dispatchEvent(new Event('scroll')); })()");
    await sleep(300);
    assert.equal(await inPanel("s.querySelector('.jump').classList.contains('show')"), true);
    await inPanel("s.querySelector('.jump').click()");
    await sleep(300);
    assert.equal(
      await inPanel("(() => { const t = s.querySelector('.stream'); return t.scrollHeight - t.scrollTop - t.clientHeight < 4; })()"),
      true
    );
  });

  test("tab stays inside the dialog", async () => {
    const trapped = await inPanel(`(() => {
      const focusable = [...s.querySelectorAll('button:not([disabled]), input:not([disabled])')]
        .filter(n => n.getClientRects().length > 0);
      focusable[focusable.length - 1].focus();
      const before = s.activeElement;
      s.querySelector('.rail').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      return { moved: s.activeElement !== before, inside: s.contains(s.activeElement) };
    })()`);
    assert.equal(trapped.inside, true);
  });
});

describe("sources", () => {
  test("a snippet jumps to the passage and highlights it", async () => {
    await reload();
    await openPanel();
    await evaluate("window.__error = null; window.onerror = (m) => (window.__error = m);");
    assert.ok((await inPanel("s.querySelectorAll('.ref').length")) >= 1, "footnote markers should render");
    await inPanel("s.querySelector('.ref').click()");
    await sleep(900);

    assert.equal(await evaluate("window.__error"), null);
    assert.equal(
      await evaluate("!!document.getElementById('ai-overlay')"),
      true,
      "the rail sits beside the article, so it should stay open"
    );
    assert.match(await evaluate("document.getElementById('p2').style.backgroundColor"), /123, 140, 255/);
  });

  test("the highlight is removed afterwards", async () => {
    await closePanel();
    await sleep(3200);
    assert.match(
      await evaluate("getComputedStyle(document.getElementById('p2')).backgroundColor"),
      /rgba\(0, 0, 0, 0\)|transparent/
    );
    assert.equal(await evaluate("document.getElementById('p2').style.backgroundColor"), "");
    assert.equal(await evaluate("document.getElementById('p2').hasAttribute('style')"), false);
  });

  test("a snippet that is not on the page says so instead of throwing", async () => {
    await evaluate(`window.__reply = () => ({ ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({ summary: 'A summary.', sources: ['zzqq not present anywhere on this page'] })) });`);
    await evaluate("window.__storage = {}");
    await closePanel();
    await openPanel();
    assert.equal(await inPanel("s.querySelector('.ref').classList.contains('dead')"), true,
      "a snippet that is not on the page should be marked unavailable");
    await inPanel("s.querySelector('.ref').click()");
    await sleep(500);
    assert.equal(await evaluate("!!document.getElementById('ai-overlay')"), true);
    assert.equal(await evaluate("!!document.getElementById('es-toast')"), true);
    await evaluate("window.__reply = null");
  });
});

describe("caching", () => {
  test("stores the summary with the mode it was produced in", async () => {
    await reload();
    await evaluate("window.__storage = {}");
    await openPanel();
    assert.equal(await evaluate("window.__storage['summary:' + location.href].mode"), "tldr");
  });

  test("reuses a fresh summary instead of asking again", async () => {
    await closePanel();
    await evaluate("window.__requests.length = 0");
    await openPanel();
    assert.equal(await evaluate("window.__requests.length"), 0);
    assert.match(await inPanel("s.textContent"), /tldr mode/);
  });

  test("ignores a summary older than the cache window", async () => {
    await closePanel();
    await evaluate(`window.__storage['summary:' + location.href].ts = Date.now() - 31 * 60 * 1000;`);
    await evaluate("window.__requests.length = 0");
    await openPanel();
    assert.equal(await evaluate("window.__requests.length"), 1);
  });

  test("remembers the chosen mode across opens", async () => {
    await inPanel("[...s.querySelectorAll('.seg')].find(c => c.textContent === 'Key points').click()");
    await sleep(1600);
    assert.equal(await evaluate("window.__storage['es:mode']"), "key-points");

    await closePanel();
    await evaluate("window.__requests.length = 0");
    await openPanel();
    assert.equal(
      await inPanel("[...s.querySelectorAll('.seg')].find(c => c.getAttribute('aria-pressed') === 'true').textContent"),
      "Key points"
    );
    assert.equal(await evaluate("window.__requests.length"), 0, "the cached key-points summary should be reused");
  });

  test("falls back when the stored mode is not one we know", async () => {
    await closePanel();
    await evaluate("window.__storage['es:mode'] = 'nonsense'");
    await openPanel();
    assert.equal(
      await inPanel("[...s.querySelectorAll('.seg')].find(c => c.getAttribute('aria-pressed') === 'true').textContent"),
      "Summary"
    );
  });
});

describe("selection", () => {
  test("summarizes only the highlighted text", async () => {
    await reload();
    await select("p1");
    await sleep(500);
    await evaluate("window.__requests.length = 0");
    await inCard("s.querySelector('.trigger').click()");
    await sleep(1600);

    const sent = await evaluate("window.__requests[0].body.text");
    assert.match(sent, /^Lighthouses have guided/);
    assert.ok(sent.length < 250, "should not send the whole page");
    assert.equal(await evaluate("!!document.getElementById('ai-overlay')"), false, "no full panel for a selection");
  });

  test("never covers the text it is summarizing", async () => {
    const clear = await evaluate(`(() => {
      const card = document.getElementById('es-selection-popup').shadowRoot.querySelector('.card').getBoundingClientRect();
      const anchor = document.querySelector('[data-es-anchor]').getBoundingClientRect();
      return (anchor.top - card.bottom >= 2) || (card.top - anchor.bottom >= 2);
    })()`);
    assert.equal(clear, true);
  });

  test("keeps its own conversation", async () => {
    await evaluate(`(() => {
      const s = document.getElementById('es-selection-popup').shadowRoot;
      const input = s.querySelector('.field input');
      input.value = 'How tall was it?';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await sleep(1600);
    assert.match(await evaluate("window.__requests.slice(-1)[0].url"), /\/api\/ask$/);
    assert.equal(await inCard("s.querySelectorAll('.entry').length"), 3);
  });

  test("closing restores the trigger and cleans up the anchor", async () => {
    await inCard("s.querySelector('.icon-btn').click()");
    await sleep(500);
    assert.equal(await inCard("s.querySelector('.trigger').textContent"), "Summarize");
    assert.equal(await evaluate("document.getElementById('es-selection-popup').dataset.expanded"), "false");
    assert.equal(await evaluate("!!document.querySelector('[data-es-anchor]')"), false);
  });
});

describe("failures", () => {
  test("a server error is reported with a retry that works", async () => {
    await reload();
    await evaluate("window.__storage = {}");
    await evaluate(`window.__reply = () => ({ ok: false, status: 500,
      text: () => Promise.resolve(JSON.stringify({ error: 'Failed to summarize text.' })) });`);
    await openPanel();

    assert.match(await inPanel("s.querySelector('.entry.warn').textContent"), /AI server had a problem/);
    assert.equal(await evaluate("Object.keys(window.__storage).length"), 0, "nothing should be cached on failure");

    await evaluate("window.__reply = null");
    await inPanel("s.querySelector('.entry.warn .act').click()");
    await sleep(1600);
    assert.match(await inPanel("s.textContent"), /tldr mode/);
    assert.equal(await inPanel("!!s.querySelector('.entry.warn')"), false);
  });

  test("rate limiting gets its own message", async () => {
    await closePanel();
    await evaluate("window.__storage = {}");
    await evaluate(`window.__reply = () => ({ ok: false, status: 429,
      text: () => Promise.resolve(JSON.stringify({ error: 'Too many requests.' })) });`);
    await openPanel();
    assert.match(await inPanel("s.querySelector('.entry.warn').textContent"), /Too many requests/);
    await evaluate("window.__reply = null");
  });
});

describe("settings", () => {
  const gear = () => inPanel("s.querySelector('.gear').click()");
  // Rows are addressed by their visible label, the way a reader finds them.
  const rowSwitch = (label) =>
    `[...s.querySelectorAll('.row')].find(r => r.textContent.startsWith(${JSON.stringify(label)}))` +
    `.querySelector('.switch')`;
  const flip = (label) => inPanel(`${rowSwitch(label)}.click()`);
  const pick = (text) =>
    inPanel(`[...s.querySelectorAll('.choice')].find(c => c.textContent === ${JSON.stringify(text)}).click()`);

  test("the gear opens a settings view and comes back", async () => {
    await reload();
    await evaluate("window.__storage = {}");
    await openPanel();
    await gear();
    await sleep(300);

    assert.equal(await inPanel("s.querySelector('.root').dataset.view"), "settings");
    // The stream steps aside rather than sitting behind the settings.
    assert.equal(await inPanel("getComputedStyle(s.querySelector('.composer')).display"), "none");
    assert.equal(await inPanel("getComputedStyle(s.querySelector('.sheet')).display"), "block");

    await gear();
    await sleep(300);
    assert.equal(await inPanel("s.querySelector('.root').dataset.view"), "stream");
    assert.notEqual(await inPanel("getComputedStyle(s.querySelector('.composer')).display"), "none");
  });

  test("a switch writes through to storage", async () => {
    await gear();
    await sleep(250);
    await flip("Animate text as it arrives");
    await sleep(250);
    assert.equal(await evaluate("window.__storage['es:settings'].animateText"), false);
    assert.equal(await inPanel(`${rowSwitch('Animate text as it arrives')}.getAttribute('aria-checked')`), "false");
  });

  test("pinning a default format stops remembering and holds across opens", async () => {
    await pick("Bullets");
    await sleep(300);
    assert.equal(await evaluate("window.__storage['es:settings'].format"), "bullets");
    assert.equal(
      await evaluate("window.__storage['es:settings'].rememberFormat"),
      false,
      "a pinned format is meaningless while the last one is still remembered"
    );

    // Switching mode in the stream must not override the pin on the next open.
    await gear();
    await sleep(250);
    await inPanel("[...s.querySelectorAll('.seg')].find(c => c.textContent === 'Key points').click()");
    await sleep(1600);
    await closePanel();
    await sleep(400);
    await openPanel();
    assert.equal(
      await inPanel("[...s.querySelectorAll('.seg')].find(c => c.getAttribute('aria-pressed') === 'true').textContent"),
      "Bullets"
    );
  });

  test("with highlighting off a source still jumps but paints nothing", async () => {
    await gear();
    await sleep(250);
    await flip("Highlight the passage when I open a source");
    await sleep(200);
    await gear();
    await sleep(300);

    assert.ok((await inPanel("s.querySelectorAll('.ref').length")) >= 1, "there should be a source to open");
    await inPanel("s.querySelector('.ref:not(.dead)').click()");
    await sleep(800);
    assert.equal(
      await evaluate("document.querySelectorAll('article [style*=\"background-color\"]').length"),
      0,
      "nothing on the page should be painted while highlighting is off"
    );
    assert.equal(await evaluate("!!document.getElementById('ai-overlay')"), true);
  });

  test("turning off the selection button stops it appearing", async () => {
    await gear();
    await sleep(250);
    await flip("Show the Summarize button when I select text");
    await sleep(300);

    await select("p3");
    await sleep(600);
    const visible = await evaluate(`(() => {
      const p = document.getElementById('es-selection-popup');
      return !!p && p.style.display !== 'none';
    })()`);
    assert.equal(visible, false, "the floating trigger should stay hidden");
  });

  test("moving the panel to the left insets the page from the left", async () => {
    await pick("Left");
    await sleep(700);
    assert.equal(await inPanel("s.querySelector('.root').dataset.side"), "left");
    assert.equal(await inPanel("Math.round(s.querySelector('.rail').getBoundingClientRect().left)"), 0);
    assert.match(await evaluate("document.documentElement.style.marginLeft"), /^\d+px$/);
    assert.equal(
      await evaluate("document.documentElement.style.marginRight"),
      "",
      "the old side's inset must be released, not left behind"
    );
  });

  test("a narrower panel gives the article more room", async () => {
    const before = await inPanel("Math.round(s.querySelector('.rail').getBoundingClientRect().width)");
    await pick("Narrow");
    await sleep(700);
    const after = await inPanel("Math.round(s.querySelector('.rail').getBoundingClientRect().width)");
    assert.ok(after < before, `narrow (${after}) should be under medium (${before})`);
    assert.equal(await evaluate("document.documentElement.style.marginLeft"), `${after}px`);
  });

  test("clearing saved summaries removes them", async () => {
    await closePanel();
    await sleep(400);
    await openPanel();
    assert.ok(
      (await evaluate("Object.keys(window.__storage).filter(k => k.startsWith('summary:')).length")) >= 1,
      "there should be something saved to clear"
    );

    await gear();
    await sleep(250);
    await inPanel("s.querySelector('.row-act').click()");
    await sleep(400);
    assert.equal(
      await evaluate("Object.keys(window.__storage).filter(k => k.startsWith('summary:')).length"),
      0
    );
    assert.equal(await inPanel("s.querySelector('.row-act').disabled"), true);
  });

  test("settings survive a reload", async () => {
    // Navigating resets the fake storage, so carry the value through Node.
    const saved = await evaluate("JSON.stringify(window.__storage['es:settings'])");
    await reload();
    await evaluate(`window.__storage['es:settings'] = ${saved}`);
    await openPanel();
    assert.equal(await inPanel("s.querySelector('.root').dataset.side"), "left");
    assert.equal(await inPanel("s.querySelector('.root').dataset.width"), "narrow");
  });
});

describe("hygiene", () => {
  test("repeated opens do not strand elements on the page", async () => {
    await reload();
    for (let i = 0; i < 8; i++) {
      await openPanel();
      await closePanel();
    }
    await sleep(2400); // let any toast expire
    const hosts = await evaluate("[...document.documentElement.children].filter(n => n.shadowRoot).map(n => n.id)");
    assert.ok(
      hosts.every((id) => id === "es-selection-popup"),
      `unexpected leftover hosts: ${JSON.stringify(hosts)}`
    );
    assert.equal(await evaluate("document.querySelectorAll('#ai-overlay').length"), 0);
  });

  test("listeners are removed when the panel closes", async () => {
    await evaluate("window.__late = null; window.addEventListener('error', (e) => (window.__late = String(e.message)));");
    await select("p3");
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await sleep(400);
    assert.equal(await evaluate("window.__late"), null);
  });
});
