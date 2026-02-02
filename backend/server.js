import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// POST /api/summarize — calls DeepSeek API
app.post("/api/summarize", async (req, res) => {
  try {
    const { text, mode } = req.body;
    const safeMode = typeof mode === "string" && mode.trim() ? mode.trim() : "TL;DR";

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "You are an intelligent summarizer. Return STRICT JSON only with keys: summary (string), entities (array of strings), timeline (array of strings), questions (array of strings), sources (array of short snippets from the text)."
          },
          {
            role: "user",
            content:
              `Mode: ${safeMode}\n` +
              "Summarize the following text. Keep summary concise. " +
              "For entities include people/orgs/places. For timeline include dated events if present. " +
              "For questions include 3-5 thoughtful follow-ups. " +
              "For sources include 3-6 short snippets copied from the text.\n\n" +
              `${text}`
          }
        ],
      }),
    });

    const data = await response.json();
    console.log("DeepSeek response:", data);
    const content =
      data?.choices?.[0]?.message?.content ||
      data?.error?.message ||
      "No summary generated.";

    let payload = { summary: content };
    try {
      payload = JSON.parse(content);
    } catch {
      // Keep fallback
    }

    res.json(payload);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to summarize text." });
  }
});

// POST /api/ask — multi-turn Q&A grounded in provided text
app.post("/api/ask", async (req, res) => {
  try {
    const { text, messages, selection } = req.body;

    const safeMessages = Array.isArray(messages) ? messages : [];
    const safeSelection = typeof selection === "string" ? selection.trim() : "";

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "You answer questions about the provided page text. Return STRICT JSON only with keys: answer (string), sources (array of short snippets from the text). Be concise and say when the answer is not in the text."
          },
          {
            role: "system",
            content: `Page text:\n${text || ""}`
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
        ],
      }),
    });

    const data = await response.json();
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

// ✅ Use Fly.io dynamic port or default to 3000 locally
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ DeepSeek backend running on port ${PORT}`));
