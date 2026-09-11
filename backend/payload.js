// Reading the model's reply.
//
// The model is asked for JSON, and usually obliges. When it does not — a reply
// cut short by the output limit, a stray code fence, a plain-prose answer — the
// panel must still get readable text. It must never get the JSON itself: a
// summary that opens with `{ "summary": "` is worse than no summary at all.

export const stripCodeFences = (text) => {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
};

export const safeJsonParse = (content, fallback) => {
  try {
    return JSON.parse(stripCodeFences(content));
  } catch {
    return fallback;
  }
};

// Pull one string field out of JSON too broken to parse. A reply truncated
// mid-value has no closing quote, so match up to wherever it stopped.
export const salvageString = (content, key) => {
  const match = String(content ?? "").match(
    new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`)
  );
  if (!match) return "";
  // A value cut mid-escape would leave a dangling backslash and fail to parse.
  const raw = match[1].replace(/\\+$/, "");
  try {
    return JSON.parse(`"${raw}"`).trim();
  } catch {
    return raw.trim();
  }
};

const looksLikeJson = (content) => /^\s*[{[]/.test(content) || /"\s*:\s*"/.test(content);

/**
 * Read `key` and `sources` out of a model reply.
 * Returns an empty string for text when nothing readable can be recovered, so
 * the caller can fail loudly rather than render scaffolding.
 */
export const readPayload = (content, key) => {
  const text = String(content ?? "");
  const parsed = safeJsonParse(text, null);

  if (parsed && typeof parsed[key] === "string" && parsed[key].trim()) {
    return {
      text: parsed[key].trim(),
      sources: Array.isArray(parsed.sources) ? parsed.sources.filter((s) => typeof s === "string") : [],
    };
  }

  // Truncated JSON: keep the prose the model did manage to write. Its sources
  // array comes after the summary, so by definition it never arrived.
  const salvaged = salvageString(text, key);
  if (salvaged) return { text: salvaged, sources: [] };

  // Not JSON at all — the model answered in plain prose, which is fine to use.
  // Anything that still smells like an object is scaffolding, so drop it.
  return { text: looksLikeJson(text) ? "" : text.trim(), sources: [] };
};

// ---- the worth-reading verdict --------------------------------------------
//
// Asked for first in the reply so a truncated response still carries it, and
// validated against a fixed set: an unrecognised call renders nothing rather
// than showing the reader a word the interface has no treatment for.
export const VERDICTS = ["read", "skim", "skip"];

export const readVerdict = (content) => {
  const parsed = safeJsonParse(content, null);
  const pick = (key) => {
    const value = parsed && typeof parsed[key] === "string" ? parsed[key] : salvageString(content, key);
    return String(value ?? "").trim();
  };
  const call = pick("verdict").toLowerCase();
  if (!VERDICTS.includes(call)) return null;
  const why = pick("why");
  return { call, why: why.length > 120 ? `${why.slice(0, 119).trimEnd()}\u2026` : why };
};
