import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundTerminalManager } from "./manager.ts";

function waitFor(
  manager: BackgroundTerminalManager,
  id: string,
  status: string,
) {
  return new Promise<void>((resolve) => {
    const current = manager.get(id);
    if (current?.status === status) return resolve();
    const unsubscribe = manager.subscribe((record) => {
      if (record?.id === id && record.status === status) {
        unsubscribe();
        resolve();
      }
    });
  });
}

test("captures output and exit status", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rhubarb-bg-test-"));
  const manager = new BackgroundTerminalManager();
  const record = manager.start("printf 'hello background'", "test", cwd);
  await waitFor(manager, record.id, "exited");
  assert.match(manager.get(record.id)?.tail ?? "", /hello background/);
  assert.equal(manager.get(record.id)?.exitCode, 0);
  await manager.dispose();
  rmSync(cwd, { recursive: true, force: true });
});

test("kills a process group", async () => {
  const manager = new BackgroundTerminalManager();
  const record = manager.start("sleep 30", "sleeper", process.cwd());
  const killed = await manager.kill(record.id);
  assert.equal(killed.status, "killed");
  await manager.dispose();
});
