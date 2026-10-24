// End-to-end tests. Real Chrome, real message protocol: the panel asks
// background.js over chrome.runtime, and background.js calls a stubbed backend.
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

// Poll rather than guess a sleep. A fixed wait either flakes under load or
// pads every run to the worst case.
const waitFor = async (read, want, label, timeout = 4000) => {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await read();
    if (want(last)) return last;
    await sleep(50);
  }
  throw new Error(`${label}: gave up after ${timeout}ms, last saw ${JSON.stringify(last)}`);
};

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

  test("escape from the composer closes it too", async () => {
    await openPanel();
    await inPanel("s.querySelector('.field input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await sleep(500);
    assert.equal(await evaluate("!!document.getElementById('ai-overlay')"), false);
  });

  // A page that sees our keystrokes runs its own single-key shortcuts on them,
  // which is how typing in the composer ends up in the site's search box.
  test("keys typed in the rail never reach the page", async () => {
    await openPanel();
    await evaluate(`(() => {
      window.__pageKeys = [];
      window.__spy = (e) => window.__pageKeys.push(e.key);
      document.addEventListener('keydown', window.__spy);
    })()`);
    await inPanel("s.querySelector('.field input').dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, composed: true }))");
    const leaked = await evaluate("(document.removeEventListener('keydown', window.__spy), window.__pageKeys)");
    assert.deepEqual(leaked, [], "the page saw a key typed in the rail");
    await closePanel();
    await sleep(500);
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

  // The mark is drawn by the stylesheet, and the trigger is built in
  // listener.js while the panel is built in content.js. Nothing but this
  // catches the shape being renamed on one side and left behind on the other,
  // which is how the trigger once shipped as an empty 16px gap.
  test("both the panel and the trigger draw the mark", async () => {
    const painted = async (read, label) => {
      const box = JSON.parse(await read("JSON.stringify((() => { const m = s.querySelector('.mark'); if (!m) return null; const r = m.getBoundingClientRect(); return { w: r.width, h: r.height, bg: getComputedStyle(m).backgroundImage }; })())"));
      assert.ok(box, `${label}: no .mark element`);
      assert.ok(box.w > 8 && box.h > 6, `${label}: mark is ${box.w}x${box.h}`);
      assert.match(box.bg, /^url\("data:image\/svg/, `${label}: mark has no artwork`);
    };
    await painted(inCard, "trigger");
    await openPanel();
    await painted(inPanel, "panel");
    await closePanel();
    await sleep(500);
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

  // Matching once dropped everything outside ASCII, so on a Russian, Hindi or
  // Chinese page a snippet normalised to nothing and every footnote was dead.
  test("a snippet in another script still finds its passage", async () => {
    await reload();
    await evaluate("window.__storage = {}");
    await evaluate(`(() => {
      const passages = {
        ru: 'Александрийский маяк простоял почти шестнадцать веков, пока его не разрушили землетрясения.',
        hi: 'प्रकाशस्तंभ ने हजारों वर्षों तक जहाजों को सुरक्षित किनारे तक पहुँचाया और रात भर लकड़ी जलाई।',
        zh: '亚历山大灯塔高一百多米，在许多世纪里都是世界上最高的建筑之一。',
      };
      for (const [id, text] of Object.entries(passages)) {
        const p = document.createElement('p');
        p.id = id;
        p.textContent = text;
        document.querySelector('article').appendChild(p);
      }
      window.__reply = () => ({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
        summary: 'A summary.',
        sources: ['Александрийский маяк простоял почти шестнадцать веков', 'हजारों वर्षों तक जहाजों को सुरक्षित किनारे', '在许多世纪里都是世界上最高的建筑'],
      })) });
    })()`);
    await openPanel();
    assert.equal(await inPanel("s.querySelectorAll('.ref').length"), 3);
    assert.equal(await inPanel("s.querySelectorAll('.ref.dead').length"), 0, "every snippet is on the page");
    await inPanel("s.querySelectorAll('.ref')[2].click()");
    await sleep(500);
    assert.match(await evaluate("document.getElementById('zh').style.backgroundColor"), /123, 140, 255/);
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

  // The privacy policy says thirty minutes, so an old summary is deleted, not
  // only passed over. Otherwise every URL ever summarized stays in storage.
  test("deletes summaries older than the cache window", async () => {
    await closePanel();
    await evaluate("window.__storage['summary:https://example.com/old'] = { summary: 'Old.', mode: 'tldr', ts: Date.now() - 31 * 60 * 1000 };");
    await openPanel();
    assert.equal(await evaluate("'summary:https://example.com/old' in window.__storage"), false);
    assert.equal(await evaluate("('summary:' + location.href) in window.__storage"), true);
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

  // The trigger that opened the card is gone by now, so without an explicit
  // focus the page keeps it and the first thing typed lands in the article.
  test("takes focus, so a follow-up types into the card", async () => {
    const focused = await inCard("s.activeElement === s.querySelector('.field input')");
    assert.equal(focused, true);
  });

  test("keys typed in the card never reach the page", async () => {
    await evaluate(`(() => {
      window.__pageKeys = [];
      window.__spy = (e) => window.__pageKeys.push(e.key);
      document.addEventListener('keydown', window.__spy);
    })()`);
    await inCard("s.querySelector('.field input').dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, composed: true }))");
    const leaked = await evaluate("(document.removeEventListener('keydown', window.__spy), window.__pageKeys)");
    assert.deepEqual(leaked, [], "the page saw a key typed in the card");
  });

  test("never covers the text it is summarizing", async () => {
    const clear = await evaluate(`(() => {
      const card = document.getElementById('es-selection-popup').shadowRoot.querySelector('.card').getBoundingClientRect();
      const anchor = document.querySelector('[data-es-anchor]').getBoundingClientRect();
      return (anchor.top - card.bottom >= 2) || (card.top - anchor.bottom >= 2);
    })()`);
    assert.equal(clear, true);
  });

  // The card used to be re-derived in viewport coordinates once a frame, so it
  // trailed the text, resized as it went, and flipped to the other side of the
  // passage as that crossed the middle of the screen. Anchored in page
  // coordinates it simply travels with the passage.
  test("rides with the passage when the page scrolls", async () => {
    const offsets = () =>
      evaluate(`(() => {
        const card = document.getElementById('es-selection-popup').shadowRoot.querySelector('.card').getBoundingClientRect();
        const anchor = document.querySelector('[data-es-anchor]').getBoundingClientRect();
        return JSON.stringify({ dx: card.left - anchor.left, dy: card.top - anchor.top, h: card.height });
      })()`);

    const before = JSON.parse(await offsets());
    await evaluate("window.scrollBy(0, 220)");
    await sleep(400);
    assert.ok(await evaluate("scrollY > 100"), "the page did not scroll, so this proves nothing");
    const after = JSON.parse(await offsets());

    assert.ok(Math.abs(after.dy - before.dy) <= 1, `card slipped ${after.dy - before.dy}px against the passage`);
    assert.ok(Math.abs(after.dx - before.dx) <= 1, `card drifted sideways by ${after.dx - before.dx}px`);
    assert.ok(Math.abs(after.h - before.h) <= 1, `card resized by ${after.h - before.h}px mid-scroll`);
    await evaluate("window.scrollTo(0, 0)");
    await sleep(300);
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

  // Whether a passage is worth summarizing is the model's call, not a word
  // count's: six words can carry a claim, and a column of filenames cannot.
  test("a short but meaningful selection still gets its summary", async () => {
    await reload();
    await select("short");
    await sleep(500);
    await inCard("s.querySelector('.trigger').click()");
    await sleep(1600);

    assert.equal(await evaluate("window.__requests.slice(-1)[0].body.scope"), "selection");
    const said = await inCard("s.querySelector('.entry:not(.ask) .entry-body').textContent");
    assert.match(said, /Pharos of Alexandria/);
    assert.doesNotMatch(said, /not much to work with/);
  });

  test("an empty summary reads as nothing to condense, not a failure", async () => {
    await reload();
    await evaluate(`window.__reply = (url) => ({ ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify(String(url).includes('summarize')
        ? { summary: '', sources: [] }
        : { answer: 'x', sources: [] })) });`);
    await select("short");
    await sleep(500);
    await inCard("s.querySelector('.trigger').click()");
    await sleep(1600);

    const said = await inCard("s.textContent");
    assert.match(said, /not much to work with/);
    assert.equal(await inCard("!!s.querySelector('.entry.warn')"), false, "an empty summary is not an error");
    await evaluate("window.__reply = null");
  });

  // The card is capped to the room beside the passage, so a size preference is
  // a ceiling rather than a measurement. Compare the sizes against each other.
  test("honours the card size preference", async () => {
    const openAt = async (size) => {
      // Settings are read from storage each time the overlay opens, and
      // navigating resets the stub, so seed it after the reload.
      await reload();
      await evaluate(`window.__storage['es:settings'] = { cardSize: ${JSON.stringify(size)} }`);
      await select("p1");
      await sleep(500);
      await inCard("s.querySelector('.trigger').click()");
      await sleep(1600);
      return JSON.parse(await inCard("JSON.stringify(s.querySelector('.card').getBoundingClientRect())"));
    };

    const small = await openAt("small");
    const large = await openAt("large");
    assert.ok(large.width > small.width, `large card (${large.width}px) is no wider than small (${small.width}px)`);
    assert.ok(small.width <= 320, `small card ran to ${small.width}px`);
  });

  test("escape from the follow-up closes the card", async () => {
    await reload();
    await select("p1");
    await sleep(500);
    await inCard("s.querySelector('.trigger').click()");
    await sleep(1600);
    await inCard("s.querySelector('.field input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitFor(
      () => evaluate("document.getElementById('es-selection-popup').dataset.expanded"),
      (value) => value === "false",
      "card closes on Escape"
    );
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

  const failAsks = () =>
    evaluate(`window.__reply = () => ({ ok: false, status: 500,
      text: () => Promise.resolve(JSON.stringify({ error: 'Failed to answer question.' })) });`);

  // Retry used to post the question a second time, so it showed twice and
  // went to the model twice in the history.
  test("retrying a failed question asks it once", async () => {
    await reload();
    await evaluate("window.__storage = {}");
    await openPanel();
    await failAsks();
    await ask("What is the tallest lighthouse?");
    assert.equal(await inPanel("!!s.querySelector('.entry.warn')"), true);

    await evaluate("window.__reply = null; window.__requests.length = 0");
    await inPanel("s.querySelector('.entry.warn .act').click()");
    await sleep(1400);
    assert.equal(await inPanel("s.querySelectorAll('.entry.ask').length"), 1);
    const asked = await evaluate("window.__requests[0].body.messages.filter((m) => m.role === 'user').length");
    assert.equal(asked, 1);
    assert.match(await inPanel("s.textContent"), /Answer: What is the tallest lighthouse\?/);
  });

  // Once a later question has been answered, retrying the earlier one is a new
  // turn. Resent in place, it went out with the later answer as the last thing
  // in the conversation.
  test("retrying an earlier question after a later one asks it last", async () => {
    await reload();
    await evaluate("window.__storage = {}");
    await openPanel();
    await failAsks();
    await ask("First question?");
    await evaluate("window.__reply = null");
    await ask("Second question?");

    await evaluate("window.__requests.length = 0");
    await inPanel("s.querySelector('.entry.warn .act').click()");
    await sleep(1400);
    const last = await evaluate("window.__requests[0].body.messages.slice(-1)[0]");
    assert.deepEqual(last, { role: "user", content: "First question?" });
    assert.match(await inPanel("[...s.querySelectorAll('.entry')].pop().textContent"), /Answer: First question\?/);
  });

  // The card cleared its input before sending, and its retry read the input,
  // so Retry removed the error and did nothing else.
  test("retrying a failed follow-up in the card sends it again", async () => {
    await closePanel();
    await select("p1");
    await sleep(500);
    await inCard("s.querySelector('.trigger').click()");
    await sleep(1600);
    await failAsks();
    await inCard(`(() => {
      const input = s.querySelector('.card .field input');
      input.value = 'When was it built?';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await sleep(1400);
    assert.equal(await inCard("!!s.querySelector('.entry.warn')"), true);

    await evaluate("window.__reply = null");
    await inCard("s.querySelector('.entry.warn .act').click()");
    await sleep(1400);
    assert.equal(await inCard("!!s.querySelector('.entry.warn')"), false);
    assert.equal(await inCard("s.querySelectorAll('.entry.ask').length"), 1);
    assert.match(await inCard("s.querySelector('.card').textContent"), /Answer: When was it built\?/);
    await inCard("s.querySelector('.card .icon-btn').click()");
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

  // The focus trap only knew buttons and inputs, so Shift+Tab from the
  // language picker counted as leaving the dialog and jumped to the end.
  test("shift+tab from the language picker stays where the browser puts it", async () => {
    await gear();
    await sleep(300);
    const jumped = await inPanel(`(() => {
      const picker = s.querySelector('.picker select');
      picker.focus();
      picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, composed: true }));
      return s.activeElement !== picker;
    })()`);
    assert.equal(jumped, false);
    await gear();
    await sleep(300);
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
    await waitFor(
      () => inPanel("s.querySelector('.root').dataset.side"),
      (v) => v === "left",
      "the root should record the chosen side"
    );
    await waitFor(
      () => inPanel("Math.round(s.querySelector('.rail').getBoundingClientRect().left)"),
      (v) => v === 0,
      "the rail should move to the left edge"
    );
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
    const after = await waitFor(
      () => inPanel("Math.round(s.querySelector('.rail').getBoundingClientRect().width)"),
      (v) => v < before,
      "the rail should shrink"
    );
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

describe("feedback", () => {
  test("copy says it copied, then goes back", async () => {
    await reload();
    await openPanel();
    await inPanel("s.querySelector('.entry .act').click()");
    await sleep(200);
    assert.equal(await inPanel("s.querySelector('.entry .act').textContent"), "Copied");
    assert.equal(await inPanel("s.querySelector('.entry .act').classList.contains('ok')"), true);

    // The label reverts on a 1400ms timer, so poll past it rather than racing.
    await waitFor(
      () => inPanel("s.querySelector('.entry .act').textContent"),
      (v) => v === "Copy",
      "copy should go back to its resting label"
    );
    assert.equal(await inPanel("s.querySelector('.entry .act').classList.contains('ok')"), false);
  });

  test("settings rows carry the index their stagger is built on", async () => {
    await inPanel("s.querySelector('.gear').click()");
    await sleep(400);
    const indexes = JSON.parse(
      await inPanel("JSON.stringify([...s.querySelectorAll('.sheet > *')].map(n => n.style.getPropertyValue('--i')))")
    );
    assert.ok(indexes.length >= 9, `expected the full sheet, got ${indexes.length} children`);
    assert.deepEqual(
      indexes,
      indexes.map((_, i) => String(i)),
      "every child needs its position or the stagger collapses to one step"
    );
    // The delay is what the index feeds, so check it actually reaches the CSS.
    assert.notEqual(
      await inPanel("getComputedStyle(s.querySelectorAll('.sheet > *')[4]).animationDelay"),
      "0s"
    );
  });
});

describe("worth reading", () => {
  test("a verdict shows with its reason", async () => {
    await reload();
    await evaluate("window.__storage = {}");
    await openPanel();
    assert.equal(await inPanel("s.querySelector('.verdict').classList.contains('show')"), true);
    assert.equal(await inPanel("s.querySelector('.verdict').dataset.call"), "read");
    assert.equal(await inPanel("s.querySelector('.verdict-call').textContent"), "Worth reading");
    assert.match(await inPanel("s.querySelector('.verdict-why').textContent"), /dates and the height/);
  });

  test("it survives being served from the cache", async () => {
    await closePanel();
    await evaluate("window.__requests.length = 0");
    await openPanel();
    assert.equal(await evaluate("window.__requests.length"), 0, "this should be the cached summary");
    assert.equal(await inPanel("s.querySelector('.verdict-call').textContent"), "Worth reading");
  });

  test("a reply without one shows nothing rather than an empty badge", async () => {
    await evaluate(`window.__reply = () => ({ ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({ summary: 'No verdict here.', sources: [] })) });`);
    await evaluate("window.__storage = {}");
    await closePanel();
    await sleep(400);
    await openPanel();
    assert.equal(await inPanel("s.querySelector('.verdict').classList.contains('show')"), false);
    await evaluate("window.__reply = null");
  });

  test("a call the interface has no label for is refused", async () => {
    await evaluate(`window.__reply = () => ({ ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({ summary: 'x.', sources: [],
        verdict: { call: 'maybe', why: 'unsure' } })) });`);
    await evaluate("window.__storage = {}");
    await closePanel();
    await sleep(400);
    await openPanel();
    assert.equal(await inPanel("s.querySelector('.verdict').classList.contains('show')"), false);
    await evaluate("window.__reply = null");
  });
});

describe("translation", () => {
  test("no language is sent while the default is in force", async () => {
    await reload();
    await evaluate("window.__storage = {}");
    await evaluate("window.__requests.length = 0");
    await openPanel();
    assert.equal(await evaluate("window.__requests.slice(-1)[0].body.lang"), undefined);
  });

  test("choosing one sends it with every request", async () => {
    await inPanel("s.querySelector('.gear').click()");
    await sleep(300);
    await inPanel(`(() => { const f = s.querySelector('.picker select');
      f.value = 'es'; f.dispatchEvent(new Event('change')); })()`);
    await sleep(250);
    assert.equal(await evaluate("window.__storage['es:settings'].language"), "es");

    // Summaries and follow-up questions both have to carry it.
    await inPanel("s.querySelector('.gear').click()");
    await sleep(300);
    await inPanel("[...s.querySelectorAll('.seg')].find(c => c.textContent === 'Bullets').click()");
    await sleep(1600);
    assert.equal(await evaluate("window.__requests.slice(-1)[0].body.lang"), "es");
    assert.match(await evaluate("window.__requests.slice(-1)[0].url"), /summarize$/);

    await ask("And what about the height?");
    assert.equal(await evaluate("window.__requests.slice(-1)[0].body.lang"), "es");
    assert.match(await evaluate("window.__requests.slice(-1)[0].url"), /ask$/);
  });

  test("entries let the browser pick their own direction", async () => {
    // Without this a right-to-left summary is laid out left-to-right.
    assert.equal(await inPanel("s.querySelector('.entry-body').getAttribute('dir')"), "auto");
  });

  test("the choice survives a reload", async () => {
    const saved = await evaluate("JSON.stringify(window.__storage['es:settings'])");
    await reload();
    await evaluate(`window.__storage['es:settings'] = ${saved}`);
    await openPanel();
    await inPanel("s.querySelector('.gear').click()");
    await sleep(300);
    assert.equal(await inPanel("s.querySelector('.picker select').value"), "es");
  });
});

describe("long pages", () => {
  const LONG = `http://localhost:${PORT}/long.html`;

  const openLong = async () => {
    await cdp.call("Page.navigate", { url: LONG });
    await sleep(700);
    await evaluate("window.__boot()");
    await sleep(400);
    await evaluate("window.__storage = {}");
    await evaluate("window.__requests.length = 0");
    await openPanel();
  };

  test("the end of a long page still reaches the model", async () => {
    await openLong();
    const sent = await evaluate("window.__requests.slice(-1)[0].body.text");

    // The whole point: a page this long used to be judged on its opening only.
    assert.match(sent, /OPENINGMARKER/, "the opening should be there");
    assert.match(sent, /CLOSINGMARKER/, "the ending is what used to be lost");
    assert.match(sent, /\[\.\.\.\]/, "omissions have to be marked, not silent");
  });

  test("it still respects the request budget", async () => {
    const sent = await evaluate("window.__requests.slice(-1)[0].body.text");
    assert.ok(sent.length <= 6000, `sent ${sent.length} characters`);
    // Three windows, so two gaps.
    assert.equal(sent.split("[...]").length - 1, 2);
  });

  test("every window is a clean slice of the real page", async () => {
    const sent = await evaluate("window.__requests.slice(-1)[0].body.text");
    const full = await evaluate(
      "document.querySelector('article').innerText.replace(/\\n{3,}/g, '\\n\\n').trim()"
    );

    for (const part of sent.split("[...]")) {
      const window = part.trim();
      assert.ok(window.length > 0, "a window should not be empty");

      // Verbatim, and cut at word boundaries: a window that starts mid word
      // hands the model a fragment it will read as a typo.
      const at = full.indexOf(window);
      assert.notEqual(at, -1, "each window should appear verbatim in the page");
      if (at > 0) assert.match(full[at - 1], /\s/, "a window must begin at a word boundary");
      const end = at + window.length;
      if (end < full.length) assert.match(full[end], /\s/, "a window must end at a word boundary");
    }
  });

  test("reading time measures the page, not the excerpt", async () => {
    // This used to be computed after truncation, so every long page reported
    // the same four minutes no matter how long it really was.
    const label = await inPanel("s.querySelector('.wordmark .meta').textContent");
    const minutes = Number(label.match(/(\d+) min read/)[1]);
    assert.ok(minutes > 10, `a 45,000 character page should not read as ${minutes} minutes`);
  });

  test("a short page is sent whole, with nothing elided", async () => {
    await reload();
    await evaluate("window.__storage = {}");
    await evaluate("window.__requests.length = 0");
    await openPanel();
    const sent = await evaluate("window.__requests.slice(-1)[0].body.text");
    assert.doesNotMatch(sent, /\[\.\.\.\]/, "a page under budget needs no sampling");
    assert.match(sent, /mollis pretium/, "the tail of a short page is simply included");
  });
});

// YouTube, Gmail and Google Docs refuse any string written to innerHTML. The
// panel runs in the page's own world, so one icon built that way threw before
// the rail had a close button, and left the page inset beside nothing.
describe("trusted types", () => {
  const TT = `http://localhost:${PORT}/trusted-types.html`;

  test("the panel builds on a page that enforces them", async () => {
    await cdp.call("Page.navigate", { url: TT });
    await sleep(700);
    await evaluate("window.__boot()");
    await sleep(400);
    await evaluate("window.__late = null; window.addEventListener('error', (e) => (window.__late = String(e.message)));");
    await openPanel();
    assert.equal(await evaluate("window.__late"), null);
    assert.equal(await inPanel("s.querySelectorAll('.head .icon-btn svg').length"), 2);
    assert.match(await inPanel("s.querySelector('.wordmark .meta').textContent"), /^localhost · \d+ min read$/);
    assert.match(await inPanel("s.textContent"), /tldr mode/);
  });

  test("so does the selection card", async () => {
    await closePanel();
    await select("tt1");
    await sleep(500);
    await inCard("s.querySelector('.trigger').click()");
    await sleep(1600);
    assert.equal(await evaluate("window.__late"), null);
    assert.equal(await inCard("!!s.querySelector('.card .icon-btn svg')"), true);
    assert.match(await inCard("s.querySelector('.card').textContent"), /tldr mode/);
  });
});

describe("recovery", () => {
  const ours = "document.querySelectorAll('[data-es-host=\"ai-overlay\"]')";

  test("a page element using the panel's id does not block it", async () => {
    await reload();
    await evaluate("document.body.prepend(Object.assign(document.createElement('div'), { id: 'ai-overlay' }))");
    await openPanel();
    assert.equal(await evaluate(`${ours}.length`), 1);
    assert.match(await evaluate(`${ours}[0].shadowRoot.textContent`), /tldr mode/);
    await evaluate(`${ours}[0].__esClose(true); document.body.querySelector('#ai-overlay').remove()`);
  });

  // An update or reload of the extension strands an open panel: its world is
  // gone, so it cannot close itself, and it used to swallow every later click.
  test("a panel left by an earlier copy of the extension is cleared away", async () => {
    await reload();
    await evaluate(`(() => {
      const stale = document.createElement('div');
      stale.id = 'ai-overlay';
      stale.dataset.esHost = 'ai-overlay';
      stale.dataset.esInset = JSON.stringify([['margin-right', '', ''], ['margin-left', '', '']]);
      document.documentElement.appendChild(stale);
      document.documentElement.style.setProperty('margin-right', '430px', 'important');
    })()`);
    await openPanel();
    assert.equal(await evaluate(`${ours}.length`), 1);
    assert.match(await inPanel("s.textContent"), /tldr mode/);
    await closePanel();
    assert.equal(await evaluate("document.documentElement.style.marginRight"), "", "the stale inset should not outlive it");
  });

  test("so is a selection button left the same way", async () => {
    await reload();
    await evaluate(`(() => {
      const stale = document.createElement('div');
      stale.id = 'es-selection-popup';
      stale.dataset.esHost = 'popup';
      document.documentElement.appendChild(stale);
    })()`);
    await select("p1");
    await sleep(500);
    assert.equal(await evaluate("document.querySelectorAll('[data-es-host=\"popup\"]').length"), 1);
    await inCard("s.querySelector('.trigger').click()");
    await sleep(1600);
    assert.match(await inCard("s.querySelector('.card').textContent"), /tldr mode/);
    await inCard("s.querySelector('.card .icon-btn').click()");
  });

  // A single-page site can move to another article before the reply lands.
  // The summary is of the page that was read, so that is where it is saved.
  test("a summary is saved under the page it was read from", async () => {
    await reload();
    await evaluate(`(() => {
      window.__storage = {};
      window.__reply = () => new Promise((resolve) => {
        window.__release = () => resolve({ ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({ summary: 'About the first page.', sources: [] })) });
      });
    })()`);
    await openPanel();
    await evaluate("history.pushState({}, '', '/article.html?next'); window.__release()");
    await sleep(600);
    const keys = await evaluate("Object.keys(window.__storage).filter((k) => k.startsWith('summary:'))");
    assert.deepEqual(keys, [`summary:${PAGE}`]);
    await evaluate("window.__reply = null");
  });
});

// These messages were the bridge between the panel and the extension, and any
// script on the page could post them: spend the API without a click, switch
// settings off, or plant a summary. Nothing listens for them now.
describe("isolation", () => {
  test("a page cannot drive the extension with window messages", async () => {
    await reload();
    await evaluate("window.__storage = {}; window.__requests.length = 0");
    await evaluate(`(() => {
      window.postMessage({ type: 'ES_API_REQUEST', requestId: 'x', endpoint: 'summarize', payload: { text: 'spend the quota' } }, '*');
      window.postMessage({ type: 'ES_SETTINGS_SET', patch: { selectionButton: false } }, '*');
      window.postMessage({ type: 'ES_CACHE_SET', value: { summary: 'planted' } }, '*');
    })()`);
    await sleep(400);
    assert.equal(await evaluate("window.__requests.length"), 0);
    assert.deepEqual(await evaluate("Object.keys(window.__storage)"), []);
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
