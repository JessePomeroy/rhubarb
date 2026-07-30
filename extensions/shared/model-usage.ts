import type { Usage } from "@earendil-works/pi-ai";

export function emptyModelUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function finite(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeModelUsage(usage: Usage): Usage {
  return {
    input: finite(usage.input),
    output: finite(usage.output),
    cacheRead: finite(usage.cacheRead),
    cacheWrite: finite(usage.cacheWrite),
    ...(usage.cacheWrite1h === undefined
      ? {}
      : { cacheWrite1h: finite(usage.cacheWrite1h) }),
    ...(usage.reasoning === undefined
      ? {}
      : { reasoning: finite(usage.reasoning) }),
    totalTokens: finite(usage.totalTokens),
    cost: {
      input: finite(usage.cost?.input),
      output: finite(usage.cost?.output),
      cacheRead: finite(usage.cost?.cacheRead),
      cacheWrite: finite(usage.cost?.cacheWrite),
      total: finite(usage.cost?.total),
    },
  };
}

export function addModelUsage(
  ...items: ReadonlyArray<Usage | undefined>
): Usage {
  const total = emptyModelUsage();
  let sawReasoning = false;
  let sawCacheWrite1h = false;
  for (const item of items) {
    if (!item) continue;
    const usage = normalizeModelUsage(item);
    total.input += usage.input;
    total.output += usage.output;
    total.cacheRead += usage.cacheRead;
    total.cacheWrite += usage.cacheWrite;
    total.totalTokens += usage.totalTokens;
    total.cost.input += usage.cost.input;
    total.cost.output += usage.cost.output;
    total.cost.cacheRead += usage.cost.cacheRead;
    total.cost.cacheWrite += usage.cost.cacheWrite;
    total.cost.total += usage.cost.total;
    if (usage.reasoning !== undefined) {
      total.reasoning = (total.reasoning ?? 0) + usage.reasoning;
      sawReasoning = true;
    }
    if (usage.cacheWrite1h !== undefined) {
      total.cacheWrite1h = (total.cacheWrite1h ?? 0) + usage.cacheWrite1h;
      sawCacheWrite1h = true;
    }
  }
  if (!sawReasoning) delete total.reasoning;
  if (!sawCacheWrite1h) delete total.cacheWrite1h;
  return total;
}

export function subtractModelUsage(current: Usage, baseline?: Usage): Usage {
  if (!baseline) return normalizeModelUsage(current);
  const a = normalizeModelUsage(current);
  const b = normalizeModelUsage(baseline);
  const nonNegative = (value: number) => Math.max(0, value);
  return {
    input: nonNegative(a.input - b.input),
    output: nonNegative(a.output - b.output),
    cacheRead: nonNegative(a.cacheRead - b.cacheRead),
    cacheWrite: nonNegative(a.cacheWrite - b.cacheWrite),
    ...(a.cacheWrite1h === undefined && b.cacheWrite1h === undefined
      ? {}
      : {
          cacheWrite1h: nonNegative(
            (a.cacheWrite1h ?? 0) - (b.cacheWrite1h ?? 0),
          ),
        }),
    ...(a.reasoning === undefined && b.reasoning === undefined
      ? {}
      : { reasoning: nonNegative((a.reasoning ?? 0) - (b.reasoning ?? 0)) }),
    totalTokens: nonNegative(a.totalTokens - b.totalTokens),
    cost: {
      input: nonNegative(a.cost.input - b.cost.input),
      output: nonNegative(a.cost.output - b.cost.output),
      cacheRead: nonNegative(a.cost.cacheRead - b.cost.cacheRead),
      cacheWrite: nonNegative(a.cost.cacheWrite - b.cost.cacheWrite),
      total: nonNegative(a.cost.total - b.cost.total),
    },
  };
}

export function hasModelUsage(usage: Usage | undefined) {
  if (!usage) return false;
  return (
    usage.totalTokens > 0 ||
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    usage.cost.total > 0
  );
}

export function usageFromMessages(
  messages: ReadonlyArray<{
    role: string;
    usage?: Usage;
  }>,
) {
  return addModelUsage(
    ...messages
      .filter(
        (message) =>
          message.role === "assistant" || message.role === "toolResult",
      )
      .map((message) => message.usage),
  );
}
