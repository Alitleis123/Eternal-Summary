import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

if (!process.env.DEEPSEEK_API_KEY) {
  console.error("DEEPSEEK_API_KEY is not set. Backend will not be able to call the AI API.");
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

const readResponseWithLimit = async (response, charLimit = 100_000) => {
  const text = await response.text();
  if (text.length > charLimit) {
    throw new Error(`Upstream response too large: ${text.length} chars`);
  }
  return text;
};

const callDeepSeek = async (messages) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        max_tokens: 200,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    const text = await readResponseWithLimit(response, 512_000);
    if (!response.ok) {
      throw new Error(`Upstream error ${response.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeoutId);
  }
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
    "%s heapUsed=%dMB heapTotal=%dMB rss=%dMB node_options=%s",
    label,
    Math.round(mem.heapUsed / 1024 / 1024),
    Math.round(mem.heapTotal / 1024 / 1024),
    Math.round(mem.rss / 1024 / 1024),
    process.env.NODE_OPTIONS || ""
  );
};

// POST /api/summarize - calls DeepSeek API
app.post("/api/summarize", async (req, res) => {
    try {
      logMem("summarize:start");
      const { text, mode } = req.body;
      const safeMode = typeof mode === "string" && mode.trim() ? mode.trim() : "TL;DR";
      const MAX_INPUT_CHARS = 4000;
      const safeText = clampText(text, MAX_INPUT_CHARS);

      const chunks = chunkText(safeText, 1600, 150);
      console.log("summarize: chars=%d chunks=%d", safeText.length, chunks.length);

      if (chunks.length <= 1) {
        const data = await callDeepSeek([
          {
            role: "system",
            content:
              "You are an intelligent summarizer. Return STRICT JSON only with keys: summary (string), sources (array of short snippets from the text)."
          },
          {
            role: "user",
            content:
              `Mode: ${safeMode}\n` +
              "Summarize the following text. Keep summary concise. " +
              "For sources include 3-6 short snippets copied from the text.\n\n" +
              `${safeText}`
          }
        ]);

        const content = data?.choices?.[0]?.message?.content || "";
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

      for (const chunk of chunks.slice(0, 4)) {
        const data = await callDeepSeek([
          {
            role: "system",
            content:
              "Summarize this chunk. Return STRICT JSON only with keys: summary (string), sources (array of short snippets from the text)."
          },
          {
            role: "user",
            content: chunk
          }
        ]);

        const content = data?.choices?.[0]?.message?.content || "";
        const payload = safeJsonParse(content, { summary: content, sources: [] });
        if (payload.summary) chunkSummaries.push(payload.summary);
        if (Array.isArray(payload.sources)) sources = sources.concat(payload.sources);
      }

      const merged = chunkSummaries.join("\n\n");
      const finalData = await callDeepSeek([
        {
          role: "system",
          content:
            "You are an intelligent summarizer. Return STRICT JSON only with keys: summary (string)."
        },
        {
          role: "user",
          content:
            `Mode: ${safeMode}\nSummarize the following combined summaries concisely:\n\n${merged}`
        }
      ]);

      const finalContent = finalData?.choices?.[0]?.message?.content || "";
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

      const data = await callDeepSeek([
        {
          role: "system",
          content:
            "You answer questions about the provided page text. Return STRICT JSON only with keys: answer (string), sources (array of short snippets from the text). Be concise and say when the answer is not in the text."
        },
        {
          role: "system",
          content: `Page text:\n${scopedText || ""}`
        },
        ...(safeSelection
          ? [
              {
                role: "system",
                content: `User selected text:\n${safeSelection}`
              }
            ]
          : []),
        ...safeMessages
      ]);

      const content = data?.choices?.[0]?.message?.content || "";
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
app.listen(PORT, HOST, () => console.log(`DeepSeek backend running on ${HOST}:${PORT}`));
