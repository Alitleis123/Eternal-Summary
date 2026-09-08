// How to react to a status from Gemini.
//
// Kept apart from server.js so the policy can be tested without starting a
// listener, and so the two numbers that matter are visible in one place.

// The panel gives up on a request after 25s, so every retry has to fit inside
// that with the model calls themselves. A backoff that outlasts the client is
// the same as no backoff: the reader sees a timeout either way.
export const CLIENT_BUDGET_MS = 25000;

// 429 is our own quota and worth waiting on. A 5xx is upstream capacity, which
// usually clears in well under a second, so it retries sooner and gives up
// sooner rather than spending the whole budget on one blip.
export const retryDelay = (status, attempt) => {
  if (status === 429) return Math.min(2000 * 2 ** attempt, 8000);
  if (status >= 500 && status < 600) return Math.min(500 * 2 ** attempt, 2000);
  return null;
};

// What to tell the reader when the retries are used up. Anything without an
// entry here is a bug on our side rather than a busy model, and stays a 500.
export const upstreamFailure = (status) => {
  if (status === 503) return { status: 503, error: "The model is busy right now. Try again in a moment." };
  if (status === 429) return { status: 429, error: "Too many requests. Wait a moment and try again." };
  return null;
};
