import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { BackendFactory } from "./manager.ts";

type JsonObject = Record<string, unknown>;

interface PendingRequest {
  resolve(value: JsonObject): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export const createCodexBackend: BackendFactory = async (
  request,
  callbacks,
) => {
  const child = spawn("codex", ["app-server", "--stdio"], {
    cwd: request.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const pending = new Map<number, PendingRequest>();
  let requestId = 0;
  let threadId = "";
  let turnId = "";
  let finalText = "";
  let stderr = "";
  let settled = false;
  let disposed = false;

  const write = (message: JsonObject) => {
    if (!child.stdin.writable)
      throw new Error("Codex app-server stdin is closed.");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const rpc = (method: string, params: JsonObject, timeoutMs = 30_000) =>
    new Promise<JsonObject>((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex request ${method} timed out.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      write({ id, method, params });
    });

  const settle = (status: "done" | "error" | "cancelled", error?: string) => {
    if (settled) return;
    settled = true;
    callbacks.settled({ status, output: finalText, error });
  };

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message: JsonObject;
    try {
      message = JSON.parse(line) as JsonObject;
    } catch {
      return;
    }

    if (
      typeof message.id === "number" &&
      ("result" in message || "error" in message)
    ) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(errorMessage(message.error)));
      else waiter.resolve(asObject(message.result));
      return;
    }

    if ("id" in message && typeof message.method === "string") {
      // Headless subagents cannot answer approvals or user-input requests.
      write({
        id: message.id,
        error: {
          code: -32000,
          message: "Interactive requests are disabled for subagents.",
        },
      });
      return;
    }

    const method = stringValue(message.method);
    const params = asObject(message.params);
    if (method === "item/agentMessage/delta") {
      const delta = stringValue(params.delta);
      if (delta) callbacks.text(delta);
    } else if (method === "item/completed") {
      const item = asObject(params.item);
      if (item.type === "agentMessage") {
        const text = stringValue(item.text);
        if (text) finalText = text;
      }
    } else if (method === "turn/started") {
      const turn = asObject(params.turn);
      turnId = stringValue(turn.id) ?? turnId;
    } else if (method === "turn/completed") {
      callbacks.turn();
      const turn = asObject(params.turn);
      const status = stringValue(turn.status);
      if (status === "failed") {
        settle("error", errorMessage(turn.error) || "Codex turn failed.");
      } else if (status === "interrupted" || status === "cancelled") {
        settle("cancelled");
      } else {
        settle("done");
      }
    } else if (method === "error") {
      const error = asObject(params.error);
      if (!settled)
        settle("error", errorMessage(error) || "Codex app-server error.");
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });
  child.on("error", (error) => settle("error", error.message));
  child.on("close", (code) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new Error(`Codex app-server exited (${code ?? "unknown"}).`),
      );
    }
    pending.clear();
    if (!disposed && !settled) {
      settle(
        "error",
        stderr.trim() || `Codex app-server exited (${code ?? "unknown"}).`,
      );
    }
  });

  try {
    await rpc("initialize", {
      clientInfo: { name: "rhubarb", title: "Rhubarb", version: "1.0.0" },
      capabilities: null,
    });
    write({ method: "initialized" });
    const started = await rpc("thread/start", {
      cwd: request.cwd,
      model: request.model ?? null,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ephemeral: false,
    });
    threadId = stringValue(asObject(started.thread).id) ?? "";
    if (!threadId) throw new Error("Codex did not return a thread id.");
    const turn = await rpc("turn/start", {
      threadId,
      input: [{ type: "text", text: request.prompt, text_elements: [] }],
      effort: normalizeEffort(request.reasoningEffort),
    });
    turnId = stringValue(asObject(turn.turn).id) ?? "";
    if (!turnId) throw new Error("Codex did not return a turn id.");
  } catch (error) {
    terminate(child);
    throw error;
  }

  return {
    async send(text) {
      if (settled || disposed) {
        throw new Error(
          "This Codex subagent has already settled; spawn a new run to continue.",
        );
      }
      await rpc("turn/steer", {
        threadId,
        expectedTurnId: turnId,
        input: [{ type: "text", text, text_elements: [] }],
      });
    },
    async cancel() {
      if (settled || disposed) return;
      await rpc("turn/interrupt", { threadId, turnId }, 10_000).catch(
        () => undefined,
      );
      settle("cancelled");
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      lines.close();
      terminate(child);
    },
  };
};

function normalizeEffort(effort?: string) {
  if (!effort) return null;
  if (effort === "off") return "none";
  if (effort === "minimal") return "low";
  if (effort === "max") return "xhigh";
  return effort;
}

function terminate(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.killed) return;
  try {
    if (process.platform !== "win32" && child.pid)
      process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    if (child.exitCode === null) {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    }
  }, 3000).unref();
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  const object = asObject(value);
  return stringValue(object.message) ?? stringValue(object.code) ?? "";
}
