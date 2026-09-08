import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readPayload, salvageString, stripCodeFences } from "../payload.js";

describe("stripCodeFences", () => {
  test("unwraps a fenced block", () => {
    assert.equal(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(stripCodeFences('```\n{"a":1}\n```'), '{"a":1}');
  });

  test("leaves unfenced text alone", () => {
    assert.equal(stripCodeFences('  {"a":1} '), '{"a":1}');
  });
});

describe("readPayload", () => {
  test("reads a well formed reply", () => {
    const { text, sources } = readPayload(
      JSON.stringify({ summary: "A short summary.", sources: ["one", "two"] }),
      "summary"
    );
    assert.equal(text, "A short summary.");
    assert.deepEqual(sources, ["one", "two"]);
  });

  test("reads a reply the model wrapped in a code fence", () => {
    const { text } = readPayload('```json\n{"summary":"Fenced."}\n```', "summary");
    assert.equal(text, "Fenced.");
  });

  // The bug this module exists for: a reply cut off by the output limit used to
  // be handed to the panel verbatim, so the summary began `{ "summary": "`.
  test("salvages the prose from a reply truncated mid-string", () => {
    const truncated = '{ "summary": "The Lindsay Clancy murder trial has reached a critical impasse, with the jury dead';
    const { text, sources } = readPayload(truncated, "summary");
    assert.equal(
      text,
      "The Lindsay Clancy murder trial has reached a critical impasse, with the jury dead"
    );
    assert.deepEqual(sources, [], "a truncated reply never reached its sources array");
    assert.doesNotMatch(text, /[{"]|summary"\s*:/, "no JSON scaffolding may survive");
  });

  test("salvages a reply truncated inside the sources array", () => {
    const truncated = '{"summary":"Done.","sources":["a verbatim snip';
    const { text } = readPayload(truncated, "summary");
    assert.equal(text, "Done.");
  });

  test("unescapes a salvaged value", () => {
    const { text } = readPayload('{"summary":"She said \\"go\\" and left.\\nThen', "summary");
    assert.equal(text, 'She said "go" and left.\nThen');
  });

  test("does not choke on a value cut mid-escape", () => {
    const { text } = readPayload('{"summary":"ends in a backslash \\', "summary");
    assert.equal(text, "ends in a backslash");
  });

  test("accepts a plain prose reply", () => {
    const { text } = readPayload("Just a sentence, no JSON in sight.", "summary");
    assert.equal(text, "Just a sentence, no JSON in sight.");
  });

  test("refuses to pass through unsalvageable scaffolding", () => {
    assert.equal(readPayload('{"wrongkey":"x"}', "summary").text, "");
    assert.equal(readPayload("{", "summary").text, "");
    assert.equal(readPayload("", "summary").text, "");
  });

  test("ignores a non string summary", () => {
    assert.equal(readPayload('{"summary":42}', "summary").text, "");
  });

  test("drops non string entries from sources", () => {
    const { sources } = readPayload('{"summary":"ok","sources":["a",7,null,"b"]}', "summary");
    assert.deepEqual(sources, ["a", "b"]);
  });

  test("works for the ask endpoint's key too", () => {
    assert.equal(readPayload('{"answer":"Because of the tide."}', "answer").text, "Because of the tide.");
  });
});

describe("salvageString", () => {
  test("returns empty when the key is absent", () => {
    assert.equal(salvageString('{"other":"x"}', "summary"), "");
  });
});
