import assert from "node:assert/strict";
import test from "node:test";
import {
  SubagentManager,
  type BackendCallbacks,
  type BackendFactory,
} from "./manager.ts";

function controlledBackend() {
  const callbacks: BackendCallbacks[] = [];
  const factory: BackendFactory = async (_request, callback) => {
    callbacks.push(callback);
    return {
      async send(text) {
        callback.text(text);
      },
      async cancel() {
        callback.settled({ status: "cancelled" });
      },
      async dispose() {},
    };
  };
  return { callbacks, factory };
}

const request = (title: string) => ({
  title,
  prompt: title,
  cwd: process.cwd(),
  harness: "pi" as const,
});

test("enforces the concurrency limit", async () => {
  const backend = controlledBackend();
  const manager = new SubagentManager({
    factories: { pi: backend.factory, codex: backend.factory },
    maxRunning: 2,
  });
  await manager.spawn(request("one"));
  await manager.spawn(request("two"));
  await assert.rejects(manager.spawn(request("three")), /At most 2/);
  await manager.dispose();
});

test("allows four simultaneous spawn requests without reservation double-counting", async () => {
  const backend = controlledBackend();
  const manager = new SubagentManager({
    factories: { pi: backend.factory, codex: backend.factory },
    maxRunning: 4,
  });
  const records = await Promise.all(
    ["one", "two", "three", "four"].map((title) =>
      manager.spawn(request(title)),
    ),
  );
  assert.equal(records.length, 4);
  assert.equal(manager.runningCount(), 4);
  await manager.dispose();
});

test("wait returns settled records and suppresses automatic delivery", async () => {
  const backend = controlledBackend();
  const deliveries: Array<{ id: string; consumed: boolean }> = [];
  const manager = new SubagentManager({
    factories: { pi: backend.factory, codex: backend.factory },
    onSettled: (record, consumed) =>
      deliveries.push({ id: record.id, consumed }),
  });
  const record = await manager.spawn(request("one"));
  const waiting = manager.wait([record.id]);
  backend.callbacks[0].settled({ status: "done", output: "finished" });
  const [result] = await waiting;
  assert.equal(result.output, "finished");
  assert.deepEqual(deliveries, [{ id: record.id, consumed: true }]);
  await manager.dispose();
});

test("cancel settles a running backend", async () => {
  const backend = controlledBackend();
  const manager = new SubagentManager({
    factories: { pi: backend.factory, codex: backend.factory },
  });
  const record = await manager.spawn(request("one"));
  const [cancelled] = await manager.cancel([record.id]);
  assert.equal(cancelled.status, "cancelled");
  await manager.dispose();
});
