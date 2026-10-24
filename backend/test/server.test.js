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

describe("gemini key", () => {
  // The stub refuses a key in the query string, so any reply at all means it
  // went as a header.
  test("goes in a header, not the URL", async () => {
    const res = await post("/api/summarize", { text: "A short page about the Pharos of Alexandria." });
    assert.equal(res.status, 200);
  });
});
