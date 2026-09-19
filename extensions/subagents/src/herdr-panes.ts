import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SubagentReadModel } from "./manager.ts";
import { buildTranscriptLines } from "./ui/transcript.ts";
import { createPaneBridge } from "./pane-bridge.ts";
import { record, shellQuote } from "./pane-protocol.ts";

const execute = promisify(execFile);
export const inHerdr = (env: NodeJS.ProcessEnv = process.env) =>
  env.HERDR_ENV === "1" && !!env.HERDR_PANE_ID;

export async function splitChildPane(
  cwd: string,
  command: string,
  run: (args: string[]) => Promise<string> = async (args) =>
    (await execute("herdr", args)).stdout,
  env: NodeJS.ProcessEnv = process.env,
) {
  const caller = env.HERDR_PANE_ID;
  if (!inHerdr(env) || !caller)
    throw new Error("Child panes require Pi running inside Herdr.");
  const layout = record(
    record(JSON.parse(await run(["pane", "layout", "--pane", caller]))).result,
  ).layout;
  const panes = record(layout).panes;
  if (!Array.isArray(panes))
    throw new Error("Herdr did not return pane geometry.");
  const current = panes.map(record).find((pane) => pane.pane_id === caller);
  if (!current)
    throw new Error("Herdr caller pane was not found in the layout.");
  const rect = record(current.rect);
  if (typeof rect.width !== "number" || typeof rect.height !== "number")
    throw new Error("Invalid Herdr pane geometry.");
  // Terminal cells are roughly twice as tall as they are wide. Re-evaluate
  // the caller's geometry each time instead of making repeated narrow columns.
  const direction = rect.width > rect.height * 2 ? "right" : "down";
  const split = record(
    record(
      JSON.parse(
        await run([
          "pane",
          "split",
          "--pane",
          caller,
          "--direction",
          direction,
          "--cwd",
          cwd,
          "--no-focus",
        ]),
      ),
    ).result,
  );
  const paneId = record(split.pane).pane_id;
  if (typeof paneId !== "string")
    throw new Error("Herdr did not return a new pane id.");
  // Herdr 0.7.5 acknowledges pane run with exit code 0 and empty stdout.
  await run(["pane", "run", paneId, command]);
  return paneId;
}

export function createHerdrPanes(options: {
  view: SubagentReadModel;
  theme: Theme;
  send: (id: string, text: string, replyTo?: string) => Promise<void>;
}) {
  const bridges = new Map<
    string,
    Awaited<ReturnType<typeof createPaneBridge>>
  >();
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    open(id: string) {
      const operation = queue
        .catch(() => undefined)
        .then(async () => {
          if (closed) throw new Error("Parent session is closing.");
          if (!inHerdr())
            throw new Error("Child panes require Pi running inside Herdr.");
          const snap = options.view.get(id);
          if (!snap) throw new Error(`Unknown child ${id}`);
          const bridge = await createPaneBridge({
            frame: (width) => {
              const current = options.view.get(id);
              return {
                type: "frame",
                title: `${id} · ${snap.title}`.replace(/[\x00-\x1f\x7f]/g, ""),
                status: current?.pendingQuestion
                  ? "waiting for parent"
                  : (current?.status ?? "no longer tracked"),
                questionId: current?.pendingQuestion?.id,
                lines: current
                  ? buildTranscriptLines(current, width, options.theme)
                  : [],
              };
            },
            subscribe: (listener) => options.view.subscribeTo(id, listener),
            send: (text, replyTo) => options.send(id, text, replyTo),
            abort: () => options.view.requestAbort(id),
          });
          try {
            const entry = fileURLToPath(
              new URL("./pane-view.ts", import.meta.url),
            );
            const paneId = await splitChildPane(
              snap.cwd,
              [process.execPath, entry, bridge.socketPath]
                .map(shellQuote)
                .join(" "),
            );
            await bridges.get(id)?.close();
            bridges.set(id, bridge);
            return paneId;
          } catch (error) {
            await bridge.close();
            throw error;
          }
        });
      queue = operation;
      return operation;
    },
    async close() {
      closed = true;
      await queue.catch(() => undefined);
      await Promise.all([...bridges.values()].map((bridge) => bridge.close()));
      bridges.clear();
    },
  };
}
