# 🌀 Eternal Summary

**Eternal Summary** is a minimal, futuristic Chrome extension that uses AI to summarize the content of the tab you’re currently viewing — all with a single click.

---

## ✨ Features

- 🧠 **Instant Summaries:** Quickly generate concise, intelligent summaries of web pages.
- 🎨 **Modern Interface:** Clean, dark-themed design with smooth, responsive animations.
- ⚡ **One-Click Functionality:** Summarize any webpage instantly from the toolbar.
- 🌐 **Secure Backend:** Powered by a Node.js + Express backend hosted on Fly.io.

---

## 🧩 Project Structure

```
AI-extension/
│
├── backend/                # Node.js backend (Express + Fly.io)
│   ├── server.js
│   ├── package.json
│   ├── Dockerfile
│   └── ...
│
├── background.js           # Handles background events
├── content.js              # Injected into the webpage to capture content
├── listener.js             # Manages communication between background and content scripts
├── manifest.json           # Chrome extension configuration
├── eternal summary icon.png# Extension logo
├── LICENSE                 # License file
└── README.md               # Project documentation
```

---

## 🚀 Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Alitleis123/Eternal-Summary.git
   cd Eternal-Summary
   ```

2. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable **Developer Mode**
   - Click **Load unpacked**
   - Select your `Eternal Summary` folder

3. Set up the backend:
   ```bash
   cd backend
   npm install
   ```

4. Configure your Gemini API key:

   **For local development:**
   ```bash
   cp .env.example .env
   # Edit .env and replace the placeholder with your real Gemini API key
   ```

   **For Fly.io deployment:**
   ```bash
   fly launch          # first-time setup (or fly deploy for subsequent deploys)
   fly secrets set GEMINI_API_KEY=your_gemini_api_key_here
   ```
   Fly.io injects secrets as environment variables at runtime. The `.env` file is never deployed (it is excluded via `.dockerignore`).

5. Start the backend server:
   ```bash
   npm start
   ```

> **Note:** The `GEMINI_API_KEY` is required. If it is missing the server will start but all summarization requests will fail. The server logs a clear error message explaining how to set the key.

---

## 🧠 Usage

1. Navigate to any webpage.
2. Click the **Eternal Summary** icon in your Chrome toolbar.
3. Wait a moment while the AI processes the page.
4. View your summary instantly in a sleek popup overlay.

---

## 🖼️ Icon & Design

The logo features an abstract **infinity loop** in a **blue-to-purple gradient** — symbolizing continuous knowledge and clarity.  
Designed to match the extension’s futuristic visual style.

---

## 🛡️ License

This project is licensed under the **Eternal Summary License** (© 2025 Ali Tleis).  
You may not redistribute, modify, or commercially use this project without explicit permission.

---

## 👨‍💻 Author

**Ali Tleis**  
Computer Science @ Northeastern University  
[GitHub](https://github.com/Alitleis123)
