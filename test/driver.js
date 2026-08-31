// Minimal Chrome DevTools Protocol driver. Launches headless Chrome, serves the
// extension plus fixtures over http, and evaluates expressions in the page.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = join(ROOT, "test", "fixtures");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

const fromPath = () => {
  // setup-chrome on CI puts the binary on PATH rather than a fixed location.
  const dirs = (process.env.PATH || "").split(":").filter(Boolean);
  for (const name of ["chrome", "google-chrome", "google-chrome-stable", "chromium"]) {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
};

export const findChrome = () => CHROME_CANDIDATES.find((p) => existsSync(p)) || fromPath();

export const startServer = (port) =>
  new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const name = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "article.html";
      for (const dir of [FIXTURES, ROOT]) {
        const file = join(dir, name);
        if (!file.startsWith(dir) || !existsSync(file)) continue;
        res.writeHead(200, {
          "Content-Type": MIME[extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(await readFile(file));
        return;
      }
      res.writeHead(404).end("not found");
    });
    server.listen(port, () => resolve(server));
  });

const httpJson = async (url) => (await fetch(url)).json();

export const launch = async ({ port, cdpPort, url }) => {
  const chrome = findChrome();
  if (!chrome) throw new Error("No Chrome binary found. Set CHROME_PATH.");

  const profile = join(ROOT, "test", ".profile");
  const proc = spawn(
    chrome,
    [
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${cdpPort}`,
      "--remote-allow-origins=*",
      url,
    ],
    { stdio: "ignore" }
  );

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const list = await httpJson(`http://127.0.0.1:${cdpPort}/json/list`);
      target = list.find((t) => t.type === "page" && t.url.includes(`:${port}`));
    } catch {
      /* not up yet */
    }
  }
  if (!target) throw new Error("Chrome did not expose a page target");
  return { proc, target };
};

// Tiny WebSocket client. Enough for CDP text frames, no dependency needed.
export const connect = async (wsUrl) => {
  const { createConnection } = await import("node:net");
  const { createHash, randomBytes } = await import("node:crypto");
  const parsed = new URL(wsUrl);
  const key = randomBytes(16).toString("base64");

  const socket = createConnection({ host: parsed.hostname, port: Number(parsed.port) });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  socket.write(
    `GET ${parsed.pathname} HTTP/1.1\r\nHost: ${parsed.host}\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
  );

  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  let buffer = Buffer.alloc(0);
  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      const head = buffer.slice(0, end).toString();
      socket.off("data", onData);
      buffer = buffer.slice(end + 4);
      if (!head.includes(accept)) reject(new Error("WebSocket handshake failed"));
      else resolve();
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });

  const waiters = new Map();
  let nextId = 0;

  const readFrames = () => {
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (buffer.length < offset + length) return;
      const payload = buffer.slice(offset, offset + length);
      buffer = buffer.slice(offset + length);
      if (opcode !== 1) continue;
      let msg;
      try {
        msg = JSON.parse(payload.toString());
      } catch {
        continue;
      }
      const waiter = waiters.get(msg.id);
      if (waiter) {
        waiters.delete(msg.id);
        waiter(msg);
      }
    }
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    readFrames();
  });

  const send = (payload) => {
    const body = Buffer.from(JSON.stringify(payload));
    const mask = randomBytes(4);
    const header = [];
    header.push(0x81);
    if (body.length < 126) header.push(0x80 | body.length);
    else if (body.length < 65536) header.push(0x80 | 126, body.length >> 8, body.length & 0xff);
    else {
      header.push(0x80 | 127);
      for (let i = 7; i >= 0; i--) header.push(Number((BigInt(body.length) >> BigInt(8 * i)) & 0xffn));
    }
    const masked = Buffer.alloc(body.length);
    for (let i = 0; i < body.length; i++) masked[i] = body[i] ^ mask[i % 4];
    socket.write(Buffer.concat([Buffer.from(header), mask, masked]));
  };

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      waiters.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result || {})));
      send({ id, method, params });
    });

  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "evaluation failed");
    }
    return result.result?.value;
  };

  return { call, evaluate, close: () => socket.destroy() };
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
