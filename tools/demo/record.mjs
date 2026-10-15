// Run from the repo root: node tools/demo/record.mjs
// CHROME_PATH must name Chrome Headless Shell, with beginFrame support.
// FFMPEG_PATH may name ffmpeg. Raw footage and logs go into generated/.
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import vm from "node:vm";
import { startServer, findChrome, sleep } from "../../test/driver.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = fileURLToPath(new URL("generated/", import.meta.url));
const REVIEW = process.env.DEMO_REVIEW_DIR || join(tmpdir(), "es-demo-review-5");
const FPS = 30;
const DURATION = 24.6;
const WIDTH = 1120, HEIGHT = 630, DSF = 3;
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const CHROME = findChrome();
if (!CHROME) throw new Error("Set CHROME_PATH to Chrome Headless Shell before recording.");
await mkdir(OUT, { recursive: true });
await mkdir(REVIEW, { recursive: true });

// Read only the existing reply literal. Importing shots.mjs would run its
// entire screenshot job. This keeps the demo copy identical to the stills.
const shots = await readFile(resolve(ROOT, "tools/shots.mjs"), "utf8");
const literal = shots.match(/const REPLIES = (\{[\s\S]*?\n\});/);
if (!literal) throw new Error("Could not read the demo replies in tools/shots.mjs");
const replies = vm.runInNewContext(`(${literal[1]})`, Object.create(null));
for (const key of ["tldr", "bullets", "ask", "selection"]) {
  if (!replies[key]) throw new Error(`Missing existing reply: ${key}`);
}

// Node's native WebSocket lets us wait for virtualTimeBudgetExpired and
// collect errors. test/driver.js still supplies the article/harness server.
export async function connectEvents(url) {
  const ws = new WebSocket(url);
  await once(ws, "open");
  let id = 0;
  const pending = new Map(), listeners = new Map();
  const errors = [];
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const p = pending.get(message.id);
      if (p) {
        clearTimeout(p.timeout);
        pending.delete(message.id);
        message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
      }
    } else {
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args);
      for (const fn of listeners.get(message.method) || []) fn(message.params);
      listeners.delete(message.method);
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    const timeout = setTimeout(() => { pending.delete(next); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(next, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  const event = name => new Promise(resolve => listeners.set(name, [...listeners.get(name) || [], resolve]));
  const evaluate = async expression => {
    let r;
    try { r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); }
    catch(error) { throw new Error(`${error.message}: ${expression.slice(0,150)}`); }
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "Evaluation failed");
    return r.result?.value;
  };
  return { call, event, evaluate, errors, close: () => ws.close() };
}

const server = await startServer(0);
const port = server.address().port;
const profile = await mkdtemp(join(tmpdir(), "es-demo-record-"));
const chrome = spawn(CHROME, [
  "--headless", "--disable-sync", "--no-first-run", "--no-default-browser-check",
  "--no-sandbox", "--disable-gpu", "--deterministic-mode", "--enable-begin-frame-control",
  `--window-size=${WIDTH},${HEIGHT}`, `--force-device-scale-factor=${DSF}`,
  "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  `http://localhost:${port}/tools/demo-article.html`,
], { stdio: "ignore", windowsHide: true });
let cdp, encoder;
const actions = [], frames = [];
let frame = 0, lastImage, captureSize;
const jpegSize = bytes => {
  for (let offset = 2; offset < bytes.length;) {
    if (bytes[offset++] !== 0xff) throw new Error("Invalid JPEG marker");
    const marker = bytes[offset++];
    const length = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    offset += length;
  }
  throw new Error("No JPEG dimensions found");
};
const at = () => frame / FPS;
const log = (type, data) => actions.push({ time: +at().toFixed(6), type, ...data });
try {
  let debugPort;
  for (let i = 0; i < 100; i++) {
    try { debugPort = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
    catch { await sleep(100); }
  }
  if (!debugPort) throw new Error("Chrome did not expose its isolated debugger");
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  cdp = await connectEvents(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await cdp.call("Runtime.enable");
  await cdp.call("Page.enable");
  // The launch flag produces real device pixels in beginFrame. A CDP
  // emulated scale changes devicePixelRatio without changing this bitmap.
  const viewport = await cdp.evaluate("({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})");
  if (viewport.width !== WIDTH || viewport.height !== HEIGHT || viewport.deviceScaleFactor !== DSF) throw new Error(`Unexpected viewport: ${JSON.stringify(viewport)}`);
  for (let i=0;i<100;i++) {
    if (await cdp.evaluate("typeof window.__boot === 'function'")) break;
    await sleep(50);
  }
  await cdp.evaluate("window.__boot()");
  await cdp.evaluate(`window.__reply = (url, payload) => {
    const r = ${JSON.stringify(replies)};
    const picked = String(url).includes('ask') ? r.ask : payload.scope === 'selection' ? r.selection : payload.mode === 'bullets' ? r.bullets : r.tldr;
    return { ok:true, status:200, text:() => Promise.resolve(JSON.stringify(picked)) };
  };window.__rafTicks=0;function countTick(){window.__rafTicks++;requestAnimationFrame(countTick)};requestAnimationFrame(countTick)`);
  const { virtualTimeTicksBase: base } = await cdp.call("Emulation.setVirtualTimePolicy", { policy: "pause" });
  // Retain chroma detail in the high-resolution source. Delivery is yuv420p.
  encoder = spawn(FFMPEG, ["-hide_banner", "-loglevel", "warning", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-vcodec", "mjpeg", "-i", "pipe:0", "-an", "-c:v", "libx264", "-crf", "15", "-preset", "fast", "-threads", "2", "-g", "30", "-keyint_min", "30", "-pix_fmt", "yuv444p", "-movflags", "+faststart", join(OUT, "usage.mp4")], { stdio: ["pipe", "ignore", "inherit"], windowsHide: true });
  let encoderError;
  encoder.on("error", error => { encoderError = error; });
  encoder.stdin.on("error", error => { encoderError = error; });
  const encoderExit = once(encoder, "exit");

  // Two 60 Hz browser frames per 30 fps output frame preserve the product's
  // original rAF text reveal speed. CSS transitions and timers advance on the
  // same virtual clock. beginFrame paints the exact stepped state.
  let tick = 0;
  const capture = async () => {
    if (encoderError) throw encoderError;
    let result;
    for (let sub = 0; sub < 2; sub++) {
      const expired = cdp.event("Emulation.virtualTimeBudgetExpired");
      await cdp.call("Emulation.setVirtualTimePolicy", { policy: "advance", budget: 1000 / 60 });
      await expired;
      tick++;
      result = await cdp.call("HeadlessExperimental.beginFrame", {
        frameTimeTicks: base + tick * 1000 / 60, interval: 1000 / 60,
        ...(sub === 1 ? { screenshot: { format: "jpeg", quality: 94 } } : {}),
      });
    }
    if (result.screenshotData) lastImage = Buffer.from(result.screenshotData, "base64");
    if (!lastImage) {
      const { data } = await cdp.call("Page.captureScreenshot", { format: "jpeg", quality: 94 });
      lastImage = Buffer.from(data, "base64");
    }
    const size = jpegSize(lastImage);
    captureSize ||= size;
    if (size.width !== WIDTH * DSF || size.height !== HEIGHT * DSF) throw new Error(`Unexpected capture dimensions: ${JSON.stringify(size)}`);
    if (!encoder.stdin.write(lastImage)) await once(encoder.stdin, "drain");
    const state = await cdp.evaluate(`(() => {
      const s=document.getElementById('ai-overlay')?.shadowRoot;
      const c=document.getElementById('es-selection-popup')?.shadowRoot;
      return { rafTicks:window.__rafTicks, scrollY, panelChars:[...s?.querySelectorAll('.entry-body')||[]].map(e=>e.textContent.length), cardChars:c?.querySelector('.entry-body')?.textContent.length||0, selectedChars:getSelection().toString().length, input:s?.querySelector('.field input')?.value||'' };
    })()`);
    frames.push({ frame, time: +at().toFixed(6), ...state });
    if (frame < 5 || frame % 30 === 0) console.log(`captured frame ${frame} / ${DURATION*FPS}`);
    // Dense strip around a reveal, plus the wider story contact sheet later.
    if ([0,6,12,24,36,45,60,90,120,150,180,210,240,300,360,420,435,450,480,510,540,570,600,630,660,690,720,737].includes(frame)) {
      await writeFile(join(OUT, `capture-${String(frame).padStart(4,"0")}.jpg`), lastImage);
    }
    frame++;
  };
  const until = async seconds => { while (frame < Math.round(seconds * FPS)) await capture(); };
  const point = async expression => cdp.evaluate(`(() => {const e=${expression};if(!e)throw new Error('Missing demo target');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const click = async (expression, name) => {
    const p = await point(expression);
    log("click", { ...p, target: name, coordinateSpace: "page" });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...p });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...p });
    return p;
  };
  const scroll = async (target, seconds, name) => {
    const start = await cdp.evaluate("scrollY");
    const steps = Math.round(seconds * FPS);
    log("scroll", { x: 350, y: 330, from: start, to: target, duration: seconds, target: name });
    for (let i=1;i<=steps;i++) {
      const p=i/steps, eased=p*p*(3-2*p);
      // New Chrome versions return a scroll-completion promise. Awaiting it
      // while virtual time is paused would deadlock the recording.
      await cdp.evaluate(`void scrollTo(0,${start+(target-start)*eased})`);
      await capture();
    }
  };
  const panel = "document.getElementById('ai-overlay').shadowRoot";
  const popup = "document.getElementById('es-selection-popup').shadowRoot";
  log("move", {x:500,y:375,coordinateSpace:"page"});
  await until(.2);
  log("click", { x: 1088, y: -18, target: "Extension toolbar icon", coordinateSpace: "toolbar" });
  log("accent", { target: "Panel opens" });
  await cdp.evaluate("void window.__onAction({id:1,url:location.href})");
  await until(5);
  const inputPoint = await click(`${panel}.querySelector('.field input')`, "Follow-up input");
  await until(5.2);
  const question = "What kept it running?";
  for (let i=0;i<question.length;i++) {
    await until(5.2+i*.05);
    log("key", {...inputPoint, key: question[i], coordinateSpace: "page"});
    await cdp.call("Input.insertText", { text:question[i] });
  }
  await until(6.6);
  log("key", {...inputPoint, key:"Enter", coordinateSpace:"page"});
  await cdp.call("Input.dispatchKeyEvent", {type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
  await cdp.call("Input.dispatchKeyEvent", {type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
  await until(14.5);
  await click(`${panel}.querySelector('.entry:last-child .ref')`, "Answer source 1");
  await until(17.6);
  await click(`${panel}.querySelector('button[aria-label="Close"]')`, "Close panel");
  await until(17.8);
  const target = await cdp.evaluate("document.getElementById('p3').getBoundingClientRect().top+scrollY-110");
  await scroll(target,.4,"Find a paragraph");
  await until(18.3);
  const selection = await cdp.evaluate(`(() => {const node=document.getElementById('p3').firstChild;const r=document.createRange();r.setStart(node,0);r.setEnd(node,1);const b=r.getBoundingClientRect();return {length:node.length,x:b.x,y:b.y+b.height/2}})()`);
  log("mousedown", {x:selection.x,y:selection.y,coordinateSpace:"page",target:"Paragraph selection"});
  await cdp.call("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,x:selection.x,y:selection.y});
  for(let i=1;i<=18;i++) {
    const end=Math.round(selection.length*i/18);
    const p=await cdp.evaluate(`(() => {const n=document.getElementById('p3').firstChild;const s=getSelection();s.setBaseAndExtent(n,0,n,${end});const r=document.createRange();r.setStart(n,Math.max(0,${end}-1));r.setEnd(n,${end});const b=r.getBoundingClientRect();return {x:b.right,y:b.y+b.height/2}})()`);
    log("selection",{...p,coordinateSpace:"page",characters:end,target:"Paragraph selection"});
    await capture();
  }
  const end=actions.at(-1);
  await cdp.call("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,x:end.x,y:end.y});
  // Retain the progressively extended selection, and let the real listener
  // process mouseup. No product markup or text animation is replaced.
  log("mouseup",{x:end.x,y:end.y,coordinateSpace:"page",target:"Paragraph selection"});
  await until(19.2);
  await click(`${popup}.querySelector('.trigger')`,"Summarize selection");
  log("accent",{target:"Selection card opens"});
  await until(DURATION);
  encoder.stdin.end();
  const [code]=await encoderExit;
  if(code!==0) throw new Error(`Footage encoder exited ${code}`);
  const report={fps:FPS,duration:DURATION,viewport,capture:{...captureSize,method:"HeadlessExperimental.beginFrame",scaleSource:`--force-device-scale-factor=${DSF}`},composition:{width:1920,height:1080},offset:0,actions,consoleErrors:cdp.errors};
  await writeFile(join(OUT,"action-log.json"),JSON.stringify(report,null,2)+"\n");
  await writeFile(join(OUT,"frame-audit.json"),JSON.stringify(frames,null,2)+"\n");
  await copyFile(join(OUT,"action-log.json"),join(REVIEW,"action-log.json"));
  await copyFile(join(OUT,"frame-audit.json"),join(REVIEW,"frame-audit.json"));
  if(cdp.errors.length) throw new Error(`Browser errors: ${JSON.stringify(cdp.errors)}`);
  console.log(`Recorded ${frames.length} frames; browser console errors: 0`);
} finally {
  cdp?.close();
  if(encoder && encoder.exitCode===null) encoder.kill();
  chrome.kill();
  await new Promise(resolve=>server.close(resolve));
  await sleep(300);
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}
