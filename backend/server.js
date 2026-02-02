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
    const { text } = req.body;

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
            content: "You are an intelligent summarizer that writes concise, clear summaries."
          },
          {
            role: "user",
            content: `Summarize this text: ${text}`
          }
        ],
      }),
    });

    const data = await response.json();
    console.log("DeepSeek response:", data);
    const summary =
      data?.choices?.[0]?.message?.content ||
      data?.error?.message ||
      "No summary generated.";

    res.json({ summary });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to summarize text." });
  }
});

// POST /api/ask — multi-turn Q&A grounded in provided text
app.post("/api/ask", async (req, res) => {
  try {
    const { text, messages } = req.body;

    const safeMessages = Array.isArray(messages) ? messages : [];

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
              "You answer questions about the provided page text. Be concise, cite details from the page when possible, and say when the answer is not in the text."
          },
          {
            role: "system",
            content: `Page text:\n${text || ""}`
          },
          ...safeMessages
        ],
      }),
    });

    const data = await response.json();
    console.log("DeepSeek response (ask):", data);
    const answer =
      data?.choices?.[0]?.message?.content ||
      data?.error?.message ||
      "No answer generated.";

    res.json({ answer });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to answer question." });
  }
});

// ✅ Use Fly.io dynamic port or default to 3000 locally
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ DeepSeek backend running on port ${PORT}`));
