import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdtempSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TerminalStatus = "running" | "exited" | "killed" | "error";
export interface TerminalRecord {
  id: string;
  title: string;
  command: string;
  cwd: string;
  pid?: number;
  status: TerminalStatus;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  error?: string;
  outputPath: string;
  tail: string;
}

export class BackgroundTerminalManager {
  readonly #records = new Map<string, TerminalRecord>();
  readonly #children = new Map<string, ChildProcess>();
  readonly #listeners = new Set<(record?: TerminalRecord) => void>();
  readonly #directory: string;
  #counter = 0;
  #disposed = false;

  constructor() {
    this.#directory = mkdtempSync(join(tmpdir(), "rhubarb-terminals-"));
    chmodSync(this.#directory, 0o700);
  }

  list() {
    return [...this.#records.values()].sort(
      (a, b) => b.startedAt - a.startedAt,
    );
  }
  get(id: string) {
    return this.#records.get(id);
  }
  running() {
    return this.list().filter((record) => record.status === "running");
  }
  subscribe(listener: (record?: TerminalRecord) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(command: string, title: string, cwd: string) {
    if (this.#disposed)
      throw new Error("Background terminal manager is shutting down.");
    const id = `bg-${++this.#counter}`;
    const outputPath = join(this.#directory, `${id}.log`);
    const record: TerminalRecord = {
      id,
      title,
      command,
      cwd,
      status: "running",
      startedAt: Date.now(),
      outputPath,
      tail: "",
    };
    const shell =
      process.platform === "win32"
        ? (process.env.ComSpec ?? "cmd.exe")
        : (process.env.SHELL ?? "/bin/sh");
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", command]
        : ["-lc", command];
    const child = spawn(shell, args, {
      cwd,
      env: process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    record.pid = child.pid;
    const log = createWriteStream(outputPath, { flags: "a", mode: 0o600 });
    const append = (chunk: Buffer) => {
      log.write(chunk);
      record.tail = boundedTail(record.tail + chunk.toString("utf8"));
      this.#notify(record);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (error) => {
      record.status = "error";
      record.error = error.message;
      record.finishedAt = Date.now();
      log.end();
      this.#children.delete(id);
      this.#notify(record);
    });
    child.on("close", (code) => {
      if (record.status === "running") record.status = "exited";
      record.exitCode = code ?? undefined;
      record.finishedAt = Date.now();
      log.end();
      this.#children.delete(id);
      this.#notify(record);
    });
    this.#records.set(id, record);
    this.#children.set(id, child);
    this.#notify(record);
    return record;
  }

  async kill(id: string) {
    const record = this.#records.get(id);
    if (!record) throw new Error(`Unknown background terminal: ${id}`);
    if (record.status !== "running") return record;
    const child = this.#children.get(id);
    if (child) await terminate(child);
    record.status = "killed";
    record.finishedAt ??= Date.now();
    this.#notify(record);
    return record;
  }

  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    await Promise.allSettled(
      this.running().map((record) => this.kill(record.id)),
    );
    this.#listeners.clear();
    rmSync(this.#directory, { recursive: true, force: true });
  }

  #notify(record?: TerminalRecord) {
    for (const listener of this.#listeners) listener(record);
  }
}

function boundedTail(value: string) {
  const bytes = Buffer.from(value);
  return bytes.length <= 64 * 1024
    ? value
    : bytes.subarray(bytes.length - 64 * 1024).toString("utf8");
}

async function terminate(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", [
          "/pid",
          String(child.pid),
          "/t",
          "/f",
        ]);
        killer.on("close", () => resolve());
        killer.on("error", () => resolve());
      });
      return;
    }
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once("close", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (child.exitCode === null && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}
