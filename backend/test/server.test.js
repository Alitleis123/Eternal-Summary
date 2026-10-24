// Boots server.js against the stub in stub-gemini.js and talks to it over
// HTTP, the way the extension's service worker does.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 3917;
const BASE = `http://127.0.0.1:${PORT}`;
const BACKEND = fileURLToPath(new URL("..", import.meta.url));

let server;
let output = "";

const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

before(async () => {
  server = spawn(process.execPath, ["--import", "./test/stub-gemini.js", "server.js"], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), GEMINI_API_KEY: "test-key", NODE_ENV: "production" },
  });
  server.stdout.on("data", (chunk) => (output += chunk));
  server.stderr.on("data", (chunk) => (output += chunk));
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${output}`);
});

after(() => server?.kill());

describe("ask", () => {
  // The page text used to be cut into chunks and only the three that shared
  // the most words with the question were kept, out of page order. A question
  // in a script \W does not split on matched nothing, and lost the tail.
  test("the model sees the whole page it was sent", async () => {
    const text = `OPENING ${"filler words about lighthouses. ".repeat(180)} CLOSING`;
    const res = await post("/api/ask", { text, messages: [{ role: "user", content: "Когда построили маяк?" }] });
    assert.equal(res.status, 200);
    const { answer } = await res.json();
    assert.match(answer, /OPENING[\s\S]*CLOSING/);
  });
});

describe("cors", () => {
  const preflight = (origin) =>
    fetch(`${BASE}/api/summarize`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
    });

  // The service worker is exempt from CORS through its host permission. A web
  // page is not, and an open policy let any site spend the key from its
  // visitors' browsers, each on a fresh rate limit.
  test("a web page is not allowed to call it", async () => {
    const res = await preflight("https://example.com");
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });

  test("an extension still is", async () => {
    const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const res = await preflight(origin);
    assert.equal(res.headers.get("access-control-allow-origin"), origin);
  });
});

describe("logs", () => {
  // The privacy policy says the backend keeps none of the text it is sent.
  test("an unreadable reply is logged without the page text in it", async () => {
    const res = await post("/api/summarize", { text: "UNREADABLE secret-page-text-7731" });
    assert.equal(res.status, 502);
    await new Promise((r) => setTimeout(r, 100));
    assert.match(output, /unreadable reply/);
    assert.doesNotMatch(output, /secret-page-text-7731/);
  });
});

describe("gemini key", () => {
  // The stub refuses a key in the query string, so any reply at all means it
  // went as a header.
  test("goes in a header, not the URL", async () => {
    const res = await post("/api/summarize", { text: "A short page about the Pharos of Alexandria." });
    assert.equal(res.status, 200);
  });
});
