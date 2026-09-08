import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { retryDelay, upstreamFailure, CLIENT_BUDGET_MS } from "../upstream.js";

describe("retryDelay", () => {
  test("retries a busy model quickly", () => {
    // 503 is upstream capacity and usually clears fast.
    assert.equal(retryDelay(503, 0), 500);
    assert.equal(retryDelay(503, 1), 1000);
    assert.equal(retryDelay(500, 0), 500);
    assert.equal(retryDelay(502, 1), 1000);
  });

  test("waits longer on our own quota", () => {
    assert.equal(retryDelay(429, 0), 2000);
    assert.equal(retryDelay(429, 1), 4000);
  });

  test("does not retry a request that will fail the same way again", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      assert.equal(retryDelay(status, 0), null, `${status} should not be retried`);
    }
  });

  test("caps both curves so three attempts fit the panel's budget", () => {
    // Three attempts means two waits. They have to leave room for the model
    // calls themselves, or the reader gets a timeout instead of an answer.
    for (const status of [429, 503]) {
      const waited = retryDelay(status, 0) + retryDelay(status, 1);
      assert.ok(
        waited < CLIENT_BUDGET_MS / 2,
        `${status} waits ${waited}ms of a ${CLIENT_BUDGET_MS}ms budget`
      );
    }
  });
});

describe("upstreamFailure", () => {
  test("names a busy model instead of blaming ourselves", () => {
    assert.deepEqual(upstreamFailure(503), {
      status: 503,
      error: "The model is busy right now. Try again in a moment.",
    });
  });

  test("passes rate limiting through with its own status", () => {
    assert.equal(upstreamFailure(429).status, 429);
  });

  test("treats anything else as our fault", () => {
    assert.equal(upstreamFailure(500), null);
    assert.equal(upstreamFailure(400), null);
    assert.equal(upstreamFailure(undefined), null);
  });
});
