// Regenerates the screenshots on the docs site: `npm run shots`.
//
// They are captured from the real extension driving a real Chrome, through the
// same harness the tests use, so they cannot drift from the product the way a
// hand-taken screenshot does. The one thing faked is the model's reply, which
// is stubbed below with text written for the demo article, so a rebuild does
// not cost an API call and does not produce a different summary every time.
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { launch, startServer, connect, sleep, findChrome } from "../test/driver.js";

const PORT = 4192;
const CDP_PORT = 9292;
const PAGE = `http://localhost:${PORT}/tools/demo-article.html`;
const OUT = new URL("../docs/shots/", import.meta.url);
// The Chrome Web Store accepts 1280x800 or 640x400 and nothing else, so the
// listing images are captured at that size rather than resized afterwards:
// scaling a screenshot of an interface softens every hairline in it.
const STORE_OUT = new URL("../docs/store/", import.meta.url);

// What the panel will show. Written to read like the demo article, because a
// screenshot full of lorem ipsum advertises nothing.
const REPLIES = {
  tldr: {
    summary:
      "The Pharos of Alexandria was completed around 280 BC and worked continuously for roughly sixteen centuries, guiding ships into the harbour with a night fire and a bronze mirror. Its three stages, square, octagonal and cylindrical, each solved a different problem: hauling fuel, shedding wind, and presenting the same profile to ships approaching from any direction. Earthquakes in 956, 1303 and 1323 took it apart, and in 1994 divers found several hundred tonnes of its masonry on the harbour floor, where it had lain undisturbed for six hundred years.",
    sources: [
      "commissioned by Ptolemy I Soter shortly after he took Egypt",
      "a square base, an octagonal middle, and a cylindrical top",
      "found several hundred tonnes of masonry, including column drums",
    ],
    verdict: { call: "read", why: "Gives the dates, the engineering, and the dive survey." },
  },
  bullets: {
    summary:
      "- Finished around **280 BC** under Ptolemy II, and lit continuously for about sixteen centuries.\n- Between **100 and 140 metres** tall, among the tallest structures anywhere for the next 1,500 years.\n- Three stages, each shaped for a job: a square base for the fuel ramp, an octagon to shed wind, a cylinder for an even profile.\n- Fuel arrived by ship, so the lighthouse depended on the harbour it made usable.\n- Earthquakes in **956, 1303 and 1323** brought it down; the base was quarried in 1480.\n- A 1994 survey found column drums and colossal statuary on the seabed, some blocks over **70 tonnes**.",
    sources: [
      "finished under his son around 280 BC",
      "a square base, an octagonal middle, and a cylindrical top",
      "Earthquakes in AD 956, 1303 and 1323 took the Pharos apart",
    ],
    verdict: { call: "read", why: "Dense with dates, dimensions and mechanism." },
  },
  selection: {
    summary:
      "The tower's three stages were structural arguments rather than ornament: the square base carried the fuel ramp, the octagon cut wind loading where it was worst, and the cylinder kept the lantern's profile the same from every approach.",
    sources: ["The square section housed the ramp that hauled fuel to the summit"],
  },
  ask: {
    answer:
      "Fuel, mostly. A fire bright enough to be seen from open water had to burn every night in a country with almost no timber, so the wood arrived by ship. The lighthouse that made the harbour usable was itself dependent on that harbour staying open.",
    sources: ["The wood came in by ship, which means the lighthouse that made the harbour usable"],
  },
};

const reply = (body) => `window.__reply = (url, payload) => {
  const pick = () => {
    if (String(url).includes('ask')) return ${JSON.stringify(JSON.stringify(REPLIES.ask))};
    if (payload.scope === 'selection') return ${JSON.stringify(JSON.stringify(REPLIES.selection))};
    if (payload.mode === 'bullets') return ${JSON.stringify(JSON.stringify(REPLIES.bullets))};
    return ${JSON.stringify(JSON.stringify(REPLIES.tldr))};
  };
  return { ok: true, status: 200, text: () => Promise.resolve(pick()) };
};
${body || ""}`;

if (!findChrome()) throw new Error("No Chrome binary found. Set CHROME_PATH.");
await mkdir(OUT, { recursive: true });
await mkdir(STORE_OUT, { recursive: true });

const server = await startServer(PORT);
const chrome = await launch({ port: PORT, cdpPort: CDP_PORT, url: PAGE });
const cdp = await connect(chrome.target.webSocketDebuggerUrl);
await cdp.call("Page.enable");
await cdp.call("Emulation.setDeviceMetricsOverride", {
  width: 1360, height: 860, deviceScaleFactor: 2, mobile: false,
});

const shot = async (name, clip, dir = OUT) => {
  const { data } = await cdp.call("Page.captureScreenshot", {
    format: "png",
    ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
  });
  await writeFile(join(dir.pathname, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`  wrote ${dir === OUT ? "shots" : "store"}/${name}.png`);
};

// The listing images, at the one viewport the store takes. Captured in a second
// pass at the end so the docs images keep the wider frame they are cropped for.
const storePass = async () => {
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
  });
  await boot();
  await cdp.evaluate(stillText);
  await openPanel();
  await shot("1-panel", null, STORE_OUT);

  await cdp.evaluate(`(() => {
    const s = document.getElementById('ai-overlay').shadowRoot;
    [...s.querySelectorAll('.seg')].find((b) => b.textContent.trim() === 'Bullets').click();
  })()`);
  await sleep(2200);
  await shot("2-bullets", null, STORE_OUT);

  await cdp.evaluate(`(() => {
    const s = document.getElementById('ai-overlay').shadowRoot;
    const input = s.querySelector('.field input');
    input.value = 'What was the hardest part of keeping it running?';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await sleep(2400);
  await shot("3-questions", null, STORE_OUT);

  await boot();
  await cdp.evaluate(stillText);
  await cdp.evaluate("document.getElementById('p3').scrollIntoView({ block: 'center' })");
  await sleep(500);
  await cdp.evaluate(`(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p3'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  })()`);
  await sleep(700);
  await cdp.evaluate(`document.getElementById('es-selection-popup').shadowRoot.querySelector('.trigger').click()`);
  await sleep(2400);
  await shot("4-selection", null, STORE_OUT);
};

const boot = async () => {
  await cdp.call("Page.navigate", { url: PAGE });
  await sleep(900);
  await cdp.evaluate("window.__boot()");
  await sleep(400);
  await cdp.evaluate(reply());
};

const openPanel = async () => {
  await cdp.evaluate("window.__onAction({ id: 1, url: location.href })");
  await sleep(2200);
};

// Text animates in by default, which a screenshot catches mid-reveal.
const stillText = "window.postMessage({ type: 'ES_SETTINGS_SET', patch: { animateText: false } }, '*')";

console.log("capturing:");

// 1. The panel, summarized, with its verdict and sources.
await boot();
await cdp.evaluate(stillText);
await openPanel();
await shot("panel");

// The same panel, cropped to itself for the top of the docs site. Shown whole
// at hero size the interface is 400px wide and illegible, which advertises
// nothing; the rail is 430 wide here, so this keeps a sliver of article for
// context and drops the rest.
await shot("hero", { x: 880, y: 0, width: 480, height: 860 });

// 2. Bullets mode.
await cdp.evaluate(`(() => {
  const s = document.getElementById('ai-overlay').shadowRoot;
  [...s.querySelectorAll('.seg')].find((b) => b.textContent.trim() === 'Bullets').click();
})()`);
await sleep(2200);
await shot("bullets");

// 3. A follow-up conversation.
await cdp.evaluate(`(() => {
  const s = document.getElementById('ai-overlay').shadowRoot;
  const input = s.querySelector('.field input');
  input.value = 'What was the hardest part of keeping it running?';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(2400);
await shot("chat");

// 4. The selection card, anchored to the passage it is about.
await boot();
await cdp.evaluate(stillText);
// Put the passage where a reader would have it before opening the card, so
// the shot shows the card beside its text rather than jammed against an edge.
await cdp.evaluate("document.getElementById('p3').scrollIntoView({ block: 'center' })");
await sleep(500);
await cdp.evaluate(`(() => {
  const range = document.createRange();
  range.selectNodeContents(document.getElementById('p3'));
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
})()`);
await sleep(700);

// 5. The floating button, before it is pressed.
await shot("trigger");

await cdp.evaluate(`document.getElementById('es-selection-popup').shadowRoot.querySelector('.trigger').click()`);
await sleep(2400);
await shot("selection");

await storePass();

cdp.close();
chrome.proc.kill();
server.close();

// Chrome shares its profile directory with the test suite and is still
// flushing it on the way out. Leaving a half-written one behind makes the next
// launch hang waiting for a page target that never appears, which looks like a
// broken test rather than a dirty profile.
for (let i = 0; i < 5; i++) {
  try {
    await rm(new URL("../test/.profile", import.meta.url), { recursive: true, force: true });
    break;
  } catch {
    await sleep(400);
  }
}

console.log("done");
