import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { emptyModelUsage } from "./model-usage.ts";
import {
  CHILD_USAGE_ENTRY_TYPE,
  claimChildUsage,
  latestChildUsageRecords,
  type ChildUsageRecord,
} from "./usage-ledger.ts";

function ledgerEntry(id: string, data: ChildUsageRecord): SessionEntry {
  return {
    type: "custom",
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    customType: CHILD_USAGE_ENTRY_TYPE,
    data,
  };
}

function record(reportedToParent: boolean): ChildUsageRecord {
  return {
    version: 1,
    key: "subagent:sa-1:1",
    kind: "subagent",
    sourceId: "sa-1",
    run: 1,
    status: "done",
    usage: { ...emptyModelUsage(), input: 12, totalTokens: 12 },
    reportedToParent,
    recordedAt: reportedToParent ? 2 : 1,
  };
}

test("the ledger keeps the latest revision for each child run", () => {
  const records = latestChildUsageRecords([
    ledgerEntry("a", record(false)),
    ledgerEntry("b", record(true)),
  ]);
  assert.equal(records.size, 1);
  assert.equal(records.get("subagent:sa-1:1")?.reportedToParent, true);
  assert.equal(records.get("subagent:sa-1:1")?.usage.totalTokens, 12);
});

test("claiming a blocking result returns each child run only once", () => {
  const entries: SessionEntry[] = [ledgerEntry("a", record(false))];
  const fakePi = {
    appendEntry(customType: string, data: unknown) {
      entries.push(
        ledgerEntry(`revision-${entries.length}`, data as ChildUsageRecord),
      );
      assert.equal(customType, CHILD_USAGE_ENTRY_TYPE);
    },
    events: { emit() {} },
  } as unknown as ExtensionAPI;

  const first = claimChildUsage(fakePi, entries, ["subagent:sa-1:1"]);
  const second = claimChildUsage(fakePi, entries, ["subagent:sa-1:1"]);

  assert.equal(first.totalTokens, 12);
  assert.equal(second.totalTokens, 0);
  assert.equal(entries.length, 2);
});
