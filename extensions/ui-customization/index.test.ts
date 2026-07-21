import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { center, columns, gradient } from "./index.ts";

test("gradient preserves visible text", () => {
  assert.equal(visibleWidth(gradient("rhubarb")), 7);
});

test("footer columns and centered art stay within width", () => {
  const line = columns("~/project", "model · high", 40);
  assert.equal(visibleWidth(line), 40);
  assert.ok(visibleWidth(center(gradient("rhubarb"), 20)) <= 20);
});
