// Preloaded with --import so server.js runs untouched against a fake Gemini.
// The reply echoes what the model was sent, so a test can read the prompt back
// out of the answer without any side channel.
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) return realFetch(url, options);

  const keyInUrl = new URL(url).searchParams.has("key");
  const keyInHeader = options?.headers?.["x-goog-api-key"] === process.env.GEMINI_API_KEY;
  if (keyInUrl || !keyInHeader) {
    return new Response(JSON.stringify({ error: { message: "key must be sent as a header" } }), { status: 401 });
  }

  const body = JSON.parse(options.body);
  const prompt = body.system_instruction.parts[0].text;
  const user = body.contents.at(-1).parts[0].text;
  // An unreadable reply, for the logging test: prose shaped like JSON.
  const text = user.includes("UNREADABLE")
    ? `{"summary": broken ${user}`
    : JSON.stringify({ answer: prompt, summary: prompt, sources: [] });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
};
