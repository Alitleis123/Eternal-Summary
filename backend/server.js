import express from "express";
import dotenv from "dotenv";
import cors from "cors";

// Fly.io injects secrets straight into the environment, so loading a .env file
// in production could shadow them with stale values.
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

if (!process.env.GEMINI_API_KEY) {
  console.error(
    [
      "",
      "ERROR: GEMINI_API_KEY is not set. Every summarize and ask request will fail.",
      "",
      "  Fly.io:  fly secrets set GEMINI_API_KEY=your_key_here",
      "  Local:   copy backend/.env.example to backend/.env and fill in your key",
      "",
    ].join("\n")
  );
}

const GEMINI_MODEL = "gemini-2.5-flash";
// The model takes a million tokens. This cap is about latency and quota, not
// context: it is roughly three thousand tokens of page text.
const MAX_INPUT_CHARS = 12000;
const MAX_SELECTION_CHARS = 1500;
const MAX_MESSAGE_CHARS = 800;
const MAX_HISTORY = 6;
const CHUNK_OVERLAP = 200;
const REQUEST_TIMEOUT_MS = 20000;

const MODE_INSTRUCTIONS = {
  tldr: "Write two or three flowing sentences that capture the single most important idea.",
  bullets: "Write four to six short bullet lines, each starting with '- '. One idea per line.",
  "key-points":
    "List the concrete takeaways a reader must remember, numbered '1.', '2.' and so on, at most five.",
  simple:
    "Explain it in plain English for someone new to the topic. Short sentences, no jargon, define any term you must use.",
};
const DEFAULT_MODE = "tldr";

const app = express();
// Fly terminates TLS in front of the app, so req.ip must come from the
// forwarded header or every client would share one rate limit bucket.
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "200kb" }));

// Light per-IP throttle. The backend fronts a metered API key, so an open
// endpoint without one is an easy way to burn quota.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const hits = new Map();

const rateLimit = (req, res, next) => {
  const now = Date.now();
  const key = req.ip || "unknown";

  for (const [ip, entry] of hits) {
    if (now - entry.start > RATE_LIMIT_WINDOW_MS) hits.delete(ip);
  }

  const entry = hits.get(key);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    hits.set(key, { start: now, count: 1 });
    next();
    return;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: "Too many requests. Wait a minute and try again." });
    return;
  }
  next();
};

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

const clampText = (value, maxChars) => {
  const str = typeof value === "string" ? value : "";
  return str.length > maxChars ? str.slice(0, maxChars) : str;
};

const chunkText = (text, maxChars, overlap = CHUNK_OVERLAP) => {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
};

const resolveMode = (value) => {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MODE_INSTRUCTIONS[id] ? id : DEFAULT_MODE;
};

const stripCodeFences = (text) => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
};

const safeJsonParse = (content, fallback) => {
  try {
    return JSON.parse(stripCodeFences(content));
  } catch {
    return fallback;
  }
};

const geminiUrl = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

const callGemini = async (systemPrompt, messages, retries = 3) => {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 800,
      responseMimeType: "application/json",
    },
  });

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(geminiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      const text = await response.text();

      if (response.status === 429 && attempt < retries - 1) {
        const delay = Math.min(2000 * 2 ** attempt, 30000);
        console.warn(`Rate limited by Gemini, retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (!response.ok) {
        throw new Error(`Gemini responded ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = JSON.parse(text);
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } finally {
      clearTimeout(timer);
    }
  }
  return "";
};

const summarizePrompt = (mode) =>
  [
    "You summarize web page text.",
    MODE_INSTRUCTIONS[mode],
    "Return JSON only, with keys: summary (string) and sources (array of 3 to 6 short snippets copied verbatim from the text).",
    "Copy source snippets exactly as they appear so they can be located on the page. Never invent content.",
  ].join(" ");

app.post("/api/summarize", rateLimit, async (req, res) => {
  try {
    const mode = resolveMode(req.body?.mode);
    const text = clampText(req.body?.text, MAX_INPUT_CHARS).trim();

    if (!text) {
      res.status(400).json({ error: "No text provided." });
      return;
    }

    console.log("summarize mode=%s chars=%d", mode, text.length);

    const content = await callGemini(summarizePrompt(mode), [{ role: "user", content: text }]);
    if (!content) {
      res.status(502).json({ error: "No summary generated." });
      return;
    }

    const payload = safeJsonParse(content, { summary: content, sources: [] });
    res.json({
      summary: payload.summary || content,
      sources: Array.isArray(payload.sources) ? payload.sources.slice(0, 6) : [],
    });
  } catch (error) {
    console.error("summarize failed:", error);
    res.status(500).json({ error: "Failed to summarize text." });
  }
});

// Picks the parts of the page most likely to hold the answer, so long pages
// do not push the useful text out of the prompt.
const relevantExcerpt = (fullText, question) => {
  const chunks = chunkText(fullText, 1800, 150);
  if (chunks.length <= 1 || !question) return fullText;

  const terms = question
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 3);
  if (!terms.length) return chunks.slice(0, 3).join("\n\n");

  return chunks
    .map((chunk) => {
      const haystack = chunk.toLowerCase();
      return { chunk, score: terms.reduce((n, t) => n + (haystack.includes(t) ? 1 : 0), 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.chunk)
    .join("\n\n");
};

app.post("/api/ask", rateLimit, async (req, res) => {
  try {
    const text = clampText(req.body?.text, MAX_INPUT_CHARS);
    const selection = clampText(req.body?.selection, MAX_SELECTION_CHARS).trim();
    const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
      .slice(-MAX_HISTORY)
      .map((m) => ({
        role: m?.role === "assistant" ? "assistant" : "user",
        content: clampText(m?.content, MAX_MESSAGE_CHARS),
      }))
      .filter((m) => m.content);

    const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    if (!lastQuestion) {
      res.status(400).json({ error: "No question provided." });
      return;
    }

    console.log("ask chars=%d messages=%d selection=%d", text.length, messages.length, selection.length);

    const systemPrompt = [
      "You answer questions about the page text below.",
      "Return JSON only, with keys: answer (string) and sources (array of short snippets copied verbatim from the text).",
      "Be concise. If the answer is not in the text, say so plainly instead of guessing.",
      `\n\nPage text:\n${relevantExcerpt(text, lastQuestion)}`,
      selection ? `\n\nThe user highlighted:\n${selection}` : "",
    ].join(" ");

    const content = await callGemini(systemPrompt, messages);
    if (!content) {
      res.status(502).json({ error: "No answer generated." });
      return;
    }

    const payload = safeJsonParse(content, { answer: content, sources: [] });
    res.json({
      answer: payload.answer || content,
      sources: Array.isArray(payload.sources) ? payload.sources.slice(0, 6) : [],
    });
  } catch (error) {
    console.error("ask failed:", error);
    res.status(500).json({ error: "Failed to answer question." });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`Eternal Summary backend listening on ${HOST}:${PORT}`));
