import assert from "node:assert/strict";
import test from "node:test";
import { outcomeText } from "./index.ts";

test("reports selected and custom answers without ambiguity", () => {
  assert.equal(
    outcomeText({ kind: "selected", answer: "Use PostgreSQL", index: 2 }),
    "The user selected option 2: Use PostgreSQL",
  );
  assert.equal(
    outcomeText({ kind: "custom", answer: "Use SQLite for now" }),
    "The user wrote their own answer: Use SQLite for now",
  );
});

test("dismissal explicitly forbids assuming an answer", () => {
  assert.match(outcomeText({ kind: "dismissed" }), /Do not assume an answer/);
});
