import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

const chunkText = (text, maxChars = 1200, overlap = 120) => {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    const chunk = text.slice(start, end);
    chunks.push(chunk);
    start = end - overlap;
    if (start < 0) start = 0;
    if (start >= text.length) break;
  }
  return chunks;
};

const callDeepSeek = async (messages) => {
  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
    }),
  });
  return response.json();
};

const safeJsonParse = (content, fallback) => {
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
};

// POST /api/summarize - calls DeepSeek API
app.post("/api/summarize", async (req, res) => {
  try {
    const { text, mode } = req.body;
    const safeMode = typeof mode === "string" && mode.trim() ? mode.trim() : "TL;DR";
    const rawText = typeof text === "string" ? text : "";
    const MAX_INPUT_CHARS = 6000;
    const safeText = rawText.slice(0, MAX_INPUT_CHARS);

    const chunks = chunkText(safeText, 2200, 200);

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

      console.log("DeepSeek response:", data);
      const content =
        data?.choices?.[0]?.message?.content ||
        data?.error?.message ||
        "No summary generated.";

      const payload = safeJsonParse(content, { summary: content, sources: [] });
      res.json(payload);
      return;
    }

    // Chunked summarization
    const chunkSummaries = [];
    let sources = [];

    for (const chunk of chunks) {
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

      const content =
        data?.choices?.[0]?.message?.content ||
        data?.error?.message ||
        "";
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

    const finalContent =
      finalData?.choices?.[0]?.message?.content ||
      finalData?.error?.message ||
      "No summary generated.";
    const finalPayload = safeJsonParse(finalContent, { summary: finalContent });

    res.json({
      summary: finalPayload.summary || finalContent,
      sources: sources.slice(0, 6),
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to summarize text." });
  }
});

// POST /api/ask - multi-turn Q&A grounded in provided text
app.post("/api/ask", async (req, res) => {
  try {
    const { text, messages, selection } = req.body;

    const safeMessages = Array.isArray(messages) ? messages : [];
    const safeSelection = typeof selection === "string" ? selection.trim() : "";
    const rawText = typeof text === "string" ? text : "";
    const MAX_INPUT_CHARS = 6000;
    const safeText = rawText.slice(0, MAX_INPUT_CHARS);

    const lastUser = [...safeMessages].reverse().find((m) => m?.role === "user");
    const question = lastUser?.content || "";

    const pickRelevantChunks = (fullText, q) => {
      const chunks = chunkText(fullText, 1800, 150);
      if (chunks.length <= 1 || !q) return fullText;
      const terms = q
        .toLowerCase()
        .split(/\\W+/)
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

    const response = await callDeepSeek([
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

    const data = response;
    console.log("DeepSeek response (ask):", data);
    const content =
      data?.choices?.[0]?.message?.content ||
      data?.error?.message ||
      "No answer generated.";

    let payload = { answer: content };
    try {
      payload = JSON.parse(content);
    } catch {
      // Keep fallback
    }

    res.json(payload);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to answer question." });
  }
});

// Use Fly.io dynamic port or default to 3000 locally
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`DeepSeek backend running on ${HOST}:${PORT}`));
