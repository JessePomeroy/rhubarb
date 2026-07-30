import assert from "node:assert/strict";
import test from "node:test";
import type { Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { addModelUsage } from "../shared/model-usage.ts";
import {
  CHILD_USAGE_ENTRY_TYPE,
  type ChildUsageRecord,
} from "../shared/usage-ledger.ts";
import { usageTrackingInternals } from "./index.ts";

function usage(tokens: number): Usage {
  return {
    input: tokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: tokens,
    cost: {
      input: tokens / 1_000,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: tokens / 1_000,
    },
  };
}

function base(id: string) {
  return { id, parentId: null, timestamp: new Date(0).toISOString() };
}

test("reported workflow usage is separated from parent totals without double-counting", () => {
  const childUsage = usage(50);
  const ledger: ChildUsageRecord = {
    version: 1,
    key: "workflow:wf_test:1",
    kind: "workflow",
    sourceId: "wf_test",
    run: 1,
    status: "done",
    model: "child-model",
    backend: "pi",
    usage: childUsage,
    reportedToParent: true,
    recordedAt: 1,
  };
  const entries: SessionEntry[] = [
    {
      type: "message",
      ...base("assistant"),
      message: {
        role: "assistant",
        content: [],
        api: "openai-responses",
        provider: "fixture",
        model: "parent-model",
        usage: usage(100),
        stopReason: "toolUse",
        timestamp: 1,
      },
    },
    {
      type: "message",
      ...base("tool"),
      message: {
        role: "toolResult",
        toolCallId: "call",
        toolName: "workflow",
        content: [{ type: "text", text: "done" }],
        usage: childUsage,
        isError: false,
        timestamp: 2,
      },
    },
    {
      type: "custom",
      ...base("ledger"),
      customType: CHILD_USAGE_ENTRY_TYPE,
      data: ledger,
    },
  ];

  const parent = usageTrackingInternals.parentUsage(entries);
  const workflows = usageTrackingInternals.usageByKind(entries, "workflow");
  const combined = addModelUsage(parent, workflows);

  assert.equal(parent.totalTokens, 100);
  assert.equal(workflows.totalTokens, 50);
  assert.equal(combined.totalTokens, 150);
});
