import type { Usage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { addModelUsage } from "./model-usage.ts";

export const CHILD_USAGE_ENTRY_TYPE = "rhubarb-child-usage";
export const CHILD_USAGE_CHANGED_CHANNEL = "rhubarb:child-usage-changed";

export type ChildUsageKind = "subagent" | "workflow";

export interface ChildUsageRecord {
  version: 1;
  key: string;
  kind: ChildUsageKind;
  sourceId: string;
  run: number;
  status: string;
  model?: string;
  backend?: string;
  usage: Usage;
  /** True when this usage was attached to a blocking parent tool result. */
  reportedToParent: boolean;
  recordedAt: number;
}

export function childUsageKey(kind: ChildUsageKind, sourceId: string, run = 1) {
  return `${kind}:${sourceId}:${run}`;
}

export function appendChildUsage(
  pi: ExtensionAPI,
  record: Omit<ChildUsageRecord, "version" | "recordedAt">,
) {
  const entry: ChildUsageRecord = {
    ...record,
    version: 1,
    recordedAt: Date.now(),
  };
  pi.appendEntry(CHILD_USAGE_ENTRY_TYPE, entry);
  pi.events.emit(CHILD_USAGE_CHANGED_CHANNEL, undefined);
  return entry;
}

function isUsage(value: unknown): value is Usage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Partial<Usage>;
  const cost = usage.cost as Partial<Usage["cost"]> | undefined;
  const finite = (item: unknown) =>
    typeof item === "number" && Number.isFinite(item) && item >= 0;
  return (
    finite(usage.input) &&
    finite(usage.output) &&
    finite(usage.cacheRead) &&
    finite(usage.cacheWrite) &&
    finite(usage.totalTokens) &&
    !!cost &&
    finite(cost.input) &&
    finite(cost.output) &&
    finite(cost.cacheRead) &&
    finite(cost.cacheWrite) &&
    finite(cost.total) &&
    (usage.reasoning === undefined || finite(usage.reasoning)) &&
    (usage.cacheWrite1h === undefined || finite(usage.cacheWrite1h))
  );
}

function isChildUsageRecord(value: unknown): value is ChildUsageRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ChildUsageRecord>;
  return (
    record.version === 1 &&
    typeof record.key === "string" &&
    (record.kind === "subagent" || record.kind === "workflow") &&
    typeof record.sourceId === "string" &&
    typeof record.run === "number" &&
    typeof record.reportedToParent === "boolean" &&
    isUsage(record.usage)
  );
}

/** Latest revision per child run on the active session branch. */
export function latestChildUsageRecords(entries: ReadonlyArray<SessionEntry>) {
  const records = new Map<string, ChildUsageRecord>();
  for (const entry of entries) {
    if (
      entry.type !== "custom" ||
      entry.customType !== CHILD_USAGE_ENTRY_TYPE ||
      !isChildUsageRecord(entry.data)
    ) {
      continue;
    }
    records.set(entry.data.key, entry.data);
  }
  return records;
}

/**
 * Mark settled child runs as represented by the current blocking tool result.
 * Already-reported keys contribute zero, preventing repeated wait/cancel calls
 * from charging the same run twice in pi's session totals.
 */
export function claimChildUsage(
  pi: ExtensionAPI,
  entries: ReadonlyArray<SessionEntry>,
  keys: ReadonlyArray<string>,
) {
  const records = latestChildUsageRecords(entries);
  const claimed: Usage[] = [];
  for (const key of new Set(keys)) {
    const record = records.get(key);
    if (!record || record.reportedToParent) continue;
    claimed.push(record.usage);
    appendChildUsage(pi, { ...record, reportedToParent: true });
  }
  return addModelUsage(...claimed);
}
