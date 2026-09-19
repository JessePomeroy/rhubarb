import { createServer, type Socket } from "node:net";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaneFrame } from "./pane-protocol.ts";
import { record } from "./pane-protocol.ts";

/** Private per-child socket: it never accepts an arbitrary agent id or shell command. */
export async function createPaneBridge(options: {
  frame: (width: number) => PaneFrame;
  subscribe: (listener: () => void) => () => void;
  send: (text: string, replyTo?: string) => Promise<void>;
  abort: () => void;
}) {
  const directory = await mkdtemp(join(tmpdir(), "pi-child-"));
  const socketPath = join(directory, "view.sock");
  const clients = new Set<Socket>();
  const cleanups = new Map<Socket, () => void>();
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    clients.add(socket);
    let width = 80;
    let buffer = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = (value: unknown) => {
      if (!socket.destroyed) socket.write(JSON.stringify(value) + "\n");
    };
    const render = () => write(options.frame(width));
    // Match the existing takeover UI's coalescing interval for streamed tokens.
    const unsubscribe = options.subscribe(() => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          render();
        }, 50);
    });
    cleanups.set(socket, () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      cleanups.get(socket)?.();
      cleanups.delete(socket);
      clients.delete(socket);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        void (async () => {
          const data = record(JSON.parse(line));
          if (
            data.type === "resize" &&
            typeof data.width === "number" &&
            Number.isInteger(data.width) &&
            data.width > 0
          ) {
            width = data.width;
            render();
          } else if (
            data.type === "send" &&
            typeof data.text === "string" &&
            data.text.trim() &&
            (data.replyTo === undefined || typeof data.replyTo === "string")
          ) {
            await options.send(data.text, data.replyTo);
            write({ type: "sent" });
          } else if (data.type === "cancel") {
            options.abort();
          } else throw new Error("Invalid pane command");
        })().catch((error: unknown) =>
          write({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    });
    render();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    await chmod(socketPath, 0o600);
  } catch (error) {
    server.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    socketPath,
    async close() {
      for (const socket of clients) {
        cleanups.get(socket)?.();
        socket.destroy();
      }
      cleanups.clear();
      clients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
