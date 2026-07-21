import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

export interface WorkflowAgentResult { ok: boolean; output: string; structured?: unknown; error?: string }
export interface SandboxOptions {
  source: string;
  args?: unknown;
  cwd: string;
  signal: AbortSignal;
  onAgent(prompt: string, options: Record<string, unknown>, signal: AbortSignal): Promise<WorkflowAgentResult>;
  onPhase(title: string): void;
  onMeta(meta: unknown): void;
}

export function runWorkflowSandbox(options: SandboxOptions) {
  return new Promise<unknown>((resolve, reject) => {
    const worker = fileURLToPath(new URL("./sandbox-child.cjs", import.meta.url));
    const child = spawn(process.execPath, [
      "--permission",
      `--allow-fs-read=${dirname(worker)}`,
      "--max-old-space-size=128",
      worker,
    ], { cwd: options.cwd, env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const token = randomBytes(24).toString("hex");
    const active = new Map<number, AbortController>();
    let requests = 0;
    let finished = false;
    const finish = (error?: Error, result?: unknown) => {
      if (finished) return;
      finished = true;
      options.signal.removeEventListener("abort", abort);
      for (const controller of active.values()) controller.abort();
      active.clear();
      child.kill("SIGTERM");
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new Error("Workflow aborted"));
    options.signal.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => { if (!finished) finish(new Error(`Workflow sandbox exited (${code ?? "unknown"})`)); });
    child.on("message", (raw) => {
      const message = raw as Record<string, unknown>;
      if (message.token !== token || typeof message.kind !== "string") return finish(new Error("Invalid workflow IPC message"));
      if (message.kind === "phase") return options.onPhase(String(message.title));
      if (message.kind === "meta") return options.onMeta(message.meta);
      if (message.kind === "result") return finish(undefined, message.result);
      if (message.kind === "error") return finish(new Error(String(message.error)));
      if (message.kind !== "agent" || typeof message.id !== "number" || typeof message.prompt !== "string") return finish(new Error("Invalid workflow agent request"));
      if (++requests > 32) return finish(new Error("Workflow exceeded 32 agent calls"));
      const controller = new AbortController();
      active.set(message.id, controller);
      void options.onAgent(message.prompt, objectValue(message.options), controller.signal).then((result) => {
        active.delete(message.id as number);
        child.send({ token, kind: "agentResult", id: message.id, result });
      }, (error) => {
        active.delete(message.id as number);
        child.send({ token, kind: "agentResult", id: message.id, result: { ok: false, output: "", error: error instanceof Error ? error.message : String(error) } });
      });
    });
    child.send({ kind: "start", token, source: options.source, args: options.args });
    if (options.signal.aborted) abort();
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
