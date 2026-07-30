import assert from "node:assert/strict";
import test from "node:test";
import type { Usage } from "@earendil-works/pi-ai";
import {
  addModelUsage,
  subtractModelUsage,
  usageFromMessages,
} from "./model-usage.ts";

function usage(values: Partial<Usage> & { totalTokens: number }): Usage {
  const { cost, ...counts } = values;
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    ...counts,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      ...cost,
    },
  };
}

test("message aggregation counts assistant and nested tool usage exactly once", () => {
  const assistant = usage({
    input: 100,
    output: 20,
    reasoning: 5,
    totalTokens: 120,
    cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
  });
  const nested = usage({
    input: 30,
    output: 10,
    cacheRead: 50,
    totalTokens: 90,
    cost: {
      input: 0.03,
      output: 0.1,
      cacheRead: 0.01,
      cacheWrite: 0,
      total: 0.14,
    },
  });

  const total = usageFromMessages([
    { role: "user" },
    { role: "assistant", usage: assistant },
    { role: "toolResult", usage: nested },
  ]);

  assert.equal(total.input, 130);
  assert.equal(total.output, 30);
  assert.equal(total.cacheRead, 50);
  assert.equal(total.reasoning, 5);
  assert.equal(total.totalTokens, 210);
  assert.equal(total.cost.total, 0.44);
});

test("run deltas subtract a cumulative baseline without negative counters", () => {
  const first = usage({ input: 100, output: 20, totalTokens: 120 });
  const cumulative = addModelUsage(
    first,
    usage({ input: 40, output: 10, reasoning: 4, totalTokens: 50 }),
  );
  assert.deepEqual(
    subtractModelUsage(cumulative, first),
    usage({ input: 40, output: 10, reasoning: 4, totalTokens: 50 }),
  );
});
