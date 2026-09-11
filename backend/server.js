import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { readPayload, readVerdict } from "./payload.js";
import { retryDelay, upstreamFailure } from "./upstream.js";

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
  // These two used to read the same. tldr keeps the author's own wording and
  // is bounded by sentence count; simple is bounded by word count and is the
  // only mode allowed to reword the vocabulary.
  tldr:
    "Write two or three flowing sentences that capture the single most important idea. Keep the author's own terminology.",
  bullets: "Write four to six short bullet lines, each starting with '- '. One idea per line.",
  "key-points":
    "List the concrete takeaways a reader must remember, numbered '1.', '2.' and so on, at most five.",
  simple:
    "Explain it in plain English for someone new to the topic, in at most 90 words. Short sentences, no jargon, define any term you must use.",
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

// An allowlist, because this string lands in a prompt. An unknown code falls
// back to the page's own language rather than being passed through.
const LANGUAGE_NAMES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  ar: "Arabic",
  hi: "Hindi",
  zh: "Simplified Chinese",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
  tr: "Turkish",
};

export const resolveLanguage = (value) => {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  return LANGUAGE_NAMES[code] || null;
};

// Source snippets are found on the page by exact text match, so translating
// them would break every footnote. Only the prose may change language.
const languageRule = (name, noun) =>
  name
    ? `Write the ${noun} in ${name}, whatever language the page is in. Leave every source snippet exactly as it appears on the page, in the page's original language, untranslated.`
    : "";

const resolveMode = (value) => {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MODE_INSTRUCTIONS[id] ? id : DEFAULT_MODE;
};

const geminiUrl = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

const callGemini = async (systemPrompt, messages, { schema = null, retries = 3 } = {}) => {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: 0.2,
      // 800 truncated real pages mid-sentence, which left invalid JSON behind.
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      ...(schema ? { responseSchema: schema } : {}),
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

      const delay = response.ok ? null : retryDelay(response.status, attempt);
      if (delay !== null && attempt < retries - 1) {
        console.warn(`Gemini responded ${response.status}, retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (!response.ok) {
        // Carry the status so the route can tell a busy model apart from a
        // fault of our own.
        const error = new Error(`Gemini responded ${response.status}: ${text.slice(0, 300)}`);
        error.status = response.status;
        throw error;
      }

      const data = JSON.parse(text);
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } finally {
      clearTimeout(timer);
    }
  }
  return "";
};

const replySchema = (key, { verdict = false } = {}) => ({
  type: "OBJECT",
  properties: {
    ...(verdict ? { verdict: { type: "STRING" }, why: { type: "STRING" } } : {}),
    [key]: { type: "STRING" },
    sources: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: [key],
  // Ordered so a reply cut off by the token limit still carries the verdict.
  ...(verdict ? { propertyOrdering: ["verdict", "why", key, "sources"] } : {}),
});

const summarizePrompt = (mode, language) =>
  [
    "You summarize web page text.",
    MODE_INSTRUCTIONS[mode],
    "Also judge whether the page is worth a reader's time.",
    "Return JSON only, with keys in this order: verdict, why, summary, sources.",
    "verdict is exactly one of 'read', 'skim' or 'skip'.",
    "why is one short clause, at most 12 words, saying what decides it. Do not repeat the summary.",
    "Judge on substance: 'read' for something with real information, 'skim' when most of it is recap or padding, 'skip' for a stub, a paywall, a link list or navigation.",
    "summary is a string. sources is an array of 3 to 6 short snippets copied verbatim from the text.",
    "Copy source snippets exactly as they appear so they can be located on the page, at most 20 words each.",
    languageRule(language, "summary"),
    "Never invent content.",
  ].filter(Boolean).join(" ");

app.post("/api/summarize", rateLimit, async (req, res) => {
  try {
    const mode = resolveMode(req.body?.mode);
    const text = clampText(req.body?.text, MAX_INPUT_CHARS).trim();

    if (!text) {
      res.status(400).json({ error: "No text provided." });
      return;
    }

    const language = resolveLanguage(req.body?.lang);
    console.log("summarize mode=%s chars=%d lang=%s", mode, text.length, language || "page");

    const content = await callGemini(summarizePrompt(mode, language), [{ role: "user", content: text }], {
      schema: replySchema("summary", { verdict: true }),
    });
    const { text: summary, sources } = readPayload(content, "summary");
    if (!summary) {
      console.warn("summarize: unreadable reply: %s", String(content).slice(0, 200));
      res.status(502).json({ error: "No summary generated." });
      return;
    }

    // A missing or unrecognised verdict is simply absent, not an error: the
    // panel renders nothing rather than an empty badge.
    const verdict = readVerdict(content);
    res.json({ summary, sources: sources.slice(0, 6), ...(verdict ? { verdict } : {}) });
  } catch (error) {
    console.error("summarize failed:", error);
    const upstream = upstreamFailure(error?.status);
    res.status(upstream?.status || 500).json({ error: upstream?.error || "Failed to summarize text." });
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
      languageRule(resolveLanguage(req.body?.lang), "answer"),
      `\n\nPage text:\n${relevantExcerpt(text, lastQuestion)}`,
      selection ? `\n\nThe user highlighted:\n${selection}` : "",
    ].join(" ");

    const content = await callGemini(systemPrompt, messages, { schema: replySchema("answer") });
    const { text: answer, sources } = readPayload(content, "answer");
    if (!answer) {
      console.warn("ask: unreadable reply: %s", String(content).slice(0, 200));
      res.status(502).json({ error: "No answer generated." });
      return;
    }

    res.json({ answer, sources: sources.slice(0, 6) });
  } catch (error) {
    console.error("ask failed:", error);
    const upstream = upstreamFailure(error?.status);
    res.status(upstream?.status || 500).json({ error: upstream?.error || "Failed to answer question." });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`Eternal Summary backend listening on ${HOST}:${PORT}`));
