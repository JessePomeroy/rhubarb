export type Harness = "pi" | "codex";
export type RunStatus = "running" | "done" | "error" | "cancelled";

export interface SpawnRequest {
  title: string;
  prompt: string;
  cwd: string;
  harness: Harness;
  model?: string;
  reasoningEffort?: string;
}

export interface RunRecord extends SpawnRequest {
  id: string;
  status: RunStatus;
  createdAt: number;
  settledAt?: number;
  output: string;
  liveText: string;
  error?: string;
  turns: number;
}

export interface BackendCallbacks {
  text(delta: string): void;
  turn(): void;
  settled(outcome: {
    status: Exclude<RunStatus, "running">;
    output?: string;
    error?: string;
  }): void;
}

export interface BackendHandle {
  send(text: string): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export type BackendFactory = (
  request: SpawnRequest,
  callbacks: BackendCallbacks,
) => Promise<BackendHandle>;

interface Entry {
  record: RunRecord;
  handle?: BackendHandle;
  waiters: number;
  settled: Promise<void>;
  resolveSettled: () => void;
}

export interface ManagerOptions {
  factories: Record<Harness, BackendFactory>;
  maxRunning?: number;
  maxTracked?: number;
  onSettled?: (record: RunRecord, consumed: boolean) => void;
}

export class SubagentManager {
  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<() => void>();
  readonly #factories: Record<Harness, BackendFactory>;
  readonly #maxRunning: number;
  readonly #maxTracked: number;
  readonly #onSettled?: ManagerOptions["onSettled"];
  #counter = 0;
  #reserved = 0;
  #disposed = false;

  constructor(options: ManagerOptions) {
    this.#factories = options.factories;
    this.#maxRunning = options.maxRunning ?? 4;
    this.#maxTracked = options.maxTracked ?? 64;
    this.#onSettled = options.onSettled;
  }

  list() {
    return [...this.#entries.values()]
      .map((entry) => entry.record)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string) {
    return this.#entries.get(id)?.record;
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  runningCount() {
    return this.list().filter((record) => record.status === "running").length;
  }

  async spawn(request: SpawnRequest) {
    if (this.#disposed) throw new Error("Subagent manager is shutting down.");
    if (this.runningCount() + this.#reserved >= this.#maxRunning) {
      throw new Error(
        `At most ${this.#maxRunning} subagents may run concurrently.`,
      );
    }
    this.#reserved++;

    const id = `sa-${++this.#counter}`;
    let resolveSettled = () => {};
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const record: RunRecord = {
      ...request,
      id,
      status: "running",
      createdAt: Date.now(),
      output: "",
      liveText: "",
      turns: 0,
    };
    const entry: Entry = { record, waiters: 0, settled, resolveSettled };
    this.#entries.set(id, entry);
    // The run is now visible to runningCount(); the reservation is no longer needed.
    this.#reserved--;
    this.#notify();

    const settle = (outcome: {
      status: Exclude<RunStatus, "running">;
      output?: string;
      error?: string;
    }) => {
      if (record.status !== "running") return;
      record.status = outcome.status;
      record.output = outcome.output ?? record.liveText;
      record.error = outcome.error;
      record.settledAt = Date.now();
      entry.resolveSettled();
      this.#notify();
      this.#onSettled?.(record, entry.waiters > 0);
      this.#prune();
    };

    try {
      entry.handle = await this.#factories[request.harness](request, {
        text: (delta) => {
          record.liveText += delta;
          this.#notify();
        },
        turn: () => {
          record.turns++;
          this.#notify();
        },
        settled: settle,
      });
      return record;
    } catch (error) {
      settle({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async send(id: string, text: string) {
    const entry = this.#required(id);
    if (!entry.handle)
      throw new Error(`Subagent ${id} has not finished starting.`);
    await entry.handle.send(text);
  }

  async cancel(ids: string[]) {
    const entries = [...new Set(ids)].map((id) => this.#required(id));
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.record.status !== "running") return;
        await entry.handle?.cancel();
      }),
    );
    await Promise.all(entries.map((entry) => entry.settled));
    return entries.map((entry) => entry.record);
  }

  async wait(
    ids: string[],
    signal?: AbortSignal,
    update?: (pending: string[]) => void,
  ) {
    const entries = [...new Set(ids)].map((id) => this.#required(id));
    for (const entry of entries) entry.waiters++;
    try {
      while (true) {
        const pending = entries.filter(
          (entry) => entry.record.status === "running",
        );
        if (pending.length === 0) return entries.map((entry) => entry.record);
        update?.(pending.map((entry) => entry.record.id));
        await Promise.race([
          ...pending.map((entry) => entry.settled),
          abortPromise(signal),
        ]);
      }
    } finally {
      for (const entry of entries) entry.waiters--;
    }
  }

  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    const entries = [...this.#entries.values()];
    await Promise.allSettled(
      entries
        .filter((entry) => entry.record.status === "running")
        .map((entry) => entry.handle?.cancel()),
    );
    await Promise.allSettled(entries.map((entry) => entry.handle?.dispose()));
    this.#listeners.clear();
  }

  #required(id: string) {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error(`Unknown subagent id: ${id}`);
    return entry;
  }

  #notify() {
    for (const listener of this.#listeners) listener();
  }

  #prune() {
    if (this.#entries.size <= this.#maxTracked) return;
    for (const entry of [...this.#entries.values()]
      .filter(
        (candidate) =>
          candidate.record.status !== "running" && candidate.waiters === 0,
      )
      .sort((a, b) => a.record.createdAt - b.record.createdAt)) {
      if (this.#entries.size <= this.#maxTracked) break;
      this.#entries.delete(entry.record.id);
      void entry.handle?.dispose();
    }
  }
}

function abortPromise(signal?: AbortSignal) {
  if (!signal) return new Promise<never>(() => {});
  if (signal.aborted)
    return Promise.reject(signal.reason ?? new Error("Wait aborted"));
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(signal.reason ?? new Error("Wait aborted")),
      { once: true },
    );
  });
}
