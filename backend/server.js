import express from "express";
import dotenv from "dotenv";
import cors from "cors";

// Only load .env file in non-production environments.
// On Fly.io, secrets are injected directly into the environment —
// running dotenv in production could mask or override them.
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

if (!process.env.GEMINI_API_KEY) {
  console.error(
    "\n" +
    "ERROR: GEMINI_API_KEY is not set. All Gemini API calls will fail.\n" +
    "\n" +
    "  For Fly.io deployment:\n" +
    "    fly secrets set GEMINI_API_KEY=your_key_here\n" +
    "\n" +
    "  For local development:\n" +
    "    Copy backend/.env.example to backend/.env and fill in your key.\n" +
    "\n"
  );
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "200kb" }));

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

const chunkText = (text, maxChars = 1200, overlap = 120) => {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlap;
    if (start < 0) start = 0;
  }
  return chunks;
};

const clampText = (value, maxChars) => {
  const str = typeof value === "string" ? value : "";
  return str.length > maxChars ? str.slice(0, maxChars) : str;
};

const GEMINI_MODEL = "gemini-2.5-flash";
const getGeminiUrl = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

const fetchWithRetry = async (url, options, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      if (response.status === 429 && i < retries - 1) {
        const delay = Math.min(2000 * 2 ** i, 30000);
        console.log(`Rate limited, retrying in ${delay}ms (attempt ${i + 2}/${retries})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (!response.ok) {
        throw new Error(`Gemini error ${response.status}: ${text.slice(0, 300)}`);
      }
      const data = JSON.parse(text);
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return content;
    } finally {
      clearTimeout(timeoutId);
    }
  }
};

const callGemini = async (systemPrompt, userPrompt) => {
  return fetchWithRetry(getGeminiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 800,
        responseMimeType: "application/json",
      },
    }),
  });
};

const callGeminiMultiTurn = async (systemPrompt, messages) => {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  return fetchWithRetry(getGeminiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 800,
        responseMimeType: "application/json",
      },
    }),
  });
};

const stripCodeFences = (text) => {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1].trim() : trimmed;
};

const safeJsonParse = (content, fallback) => {
  try {
    return JSON.parse(stripCodeFences(content));
  } catch {
    return fallback;
  }
};

const logMem = (label) => {
  const mem = process.memoryUsage();
  console.log(
    "%s heapUsed=%dMB heapTotal=%dMB rss=%dMB",
    label,
    Math.round(mem.heapUsed / 1024 / 1024),
    Math.round(mem.heapTotal / 1024 / 1024),
    Math.round(mem.rss / 1024 / 1024)
  );
};

// POST /api/summarize
app.post("/api/summarize", async (req, res) => {
  try {
    logMem("summarize:start");
    const { text, mode } = req.body;
    const safeMode = typeof mode === "string" && mode.trim() ? mode.trim() : "TL;DR";
    const MAX_INPUT_CHARS = 4000;
    const safeText = clampText(text, MAX_INPUT_CHARS);

    const chunks = chunkText(safeText, 3800, 200);
    console.log("summarize: chars=%d chunks=%d", safeText.length, chunks.length);

    if (chunks.length <= 1) {
      const content = await callGemini(
        "You are an intelligent summarizer. Return JSON only with keys: summary (string), sources (array of short snippets from the text). Do not include markdown formatting.",
        `Mode: ${safeMode}\nSummarize the following text. Keep summary concise. For sources include 3-6 short snippets copied from the text.\n\n${safeText}`
      );

      if (!content) {
        res.status(502).json({ error: "No summary generated." });
        return;
      }

      const payload = safeJsonParse(content, { summary: content, sources: [] });
      res.json(payload);
      logMem("summarize:end");
      return;
    }

    // Chunked summarization
    const chunkSummaries = [];
    let sources = [];

    for (let i = 0; i < Math.min(chunks.length, 3); i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500)); // rate limit delay
      const content = await callGemini(
        "Summarize this chunk. Return JSON only with keys: summary (string), sources (array of short snippets from the text).",
        chunks[i]
      );

      const payload = safeJsonParse(content, { summary: content, sources: [] });
      if (payload.summary) chunkSummaries.push(payload.summary);
      if (Array.isArray(payload.sources)) sources = sources.concat(payload.sources);
    }

    const merged = chunkSummaries.join("\n\n");
    const finalContent = await callGemini(
      "You are an intelligent summarizer. Return JSON only with keys: summary (string).",
      `Mode: ${safeMode}\nSummarize the following combined summaries concisely:\n\n${merged}`
    );

    if (!finalContent) {
      res.status(502).json({ error: "No summary generated." });
      return;
    }
    const finalPayload = safeJsonParse(finalContent, { summary: finalContent });

    res.json({
      summary: finalPayload.summary || finalContent,
      sources: sources.slice(0, 6),
    });
    logMem("summarize:end");
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to summarize text." });
  }
});

// POST /api/ask - multi-turn Q&A grounded in provided text
app.post("/api/ask", async (req, res) => {
  try {
    logMem("ask:start");
    const { text, messages, selection } = req.body;

    const rawMessages = Array.isArray(messages) ? messages : [];
    const safeMessages = rawMessages
      .slice(-6)
      .map((m) => ({
        role: m?.role === "assistant" ? "assistant" : "user",
        content: clampText(m?.content || "", 800),
      }));
    const safeSelection = clampText(selection, 1200).trim();
    const MAX_INPUT_CHARS = 4000;
    const safeText = clampText(text, MAX_INPUT_CHARS);
    console.log(
      "ask: chars=%d messages=%d selection=%d",
      safeText.length,
      safeMessages.length,
      safeSelection.length
    );

    const lastUser = [...safeMessages].reverse().find((m) => m?.role === "user");
    const question = lastUser?.content || "";

    const pickRelevantChunks = (fullText, q) => {
      const chunks = chunkText(fullText, 1800, 150);
      if (chunks.length <= 1 || !q) return fullText;
      const terms = q
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 3);
      const scored = chunks.map((c) => {
        const lc = c.toLowerCase();
        const score = terms.reduce((acc, t) => acc + (lc.includes(t) ? 1 : 0), 0);
        return { c, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, 3).map((s) => s.c);
      return top.join("\n\n");
    };

    const scopedText = pickRelevantChunks(safeText, question);

    const systemPrompt =
      "You answer questions about the provided page text. Return JSON only with keys: answer (string), sources (array of short snippets from the text). Be concise and say when the answer is not in the text." +
      `\n\nPage text:\n${scopedText || ""}` +
      (safeSelection ? `\n\nUser selected text:\n${safeSelection}` : "");

    // Build conversation for multi-turn
    const geminiMessages = safeMessages.length > 0
      ? safeMessages
      : [{ role: "user", content: question || "Summarize the page." }];

    const content = await callGeminiMultiTurn(systemPrompt, geminiMessages);

    if (!content) {
      res.json({ answer: "No answer generated.", sources: [] });
      return;
    }

    const payload = safeJsonParse(content, { answer: content, sources: [] });
    res.json(payload);
    logMem("ask:end");
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to answer question." });
  }
});

// Use Fly.io dynamic port or default to 3000 locally
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`Gemini backend running on ${HOST}:${PORT}`));
