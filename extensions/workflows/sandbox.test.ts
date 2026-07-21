import assert from "node:assert/strict";
import test from "node:test";
import { prepareWorkflowSource } from "./source.ts";
import { runWorkflowSandbox } from "./sandbox.ts";

function run(source: string) {
  const controller = new AbortController();
  return runWorkflowSandbox({
    source: prepareWorkflowSource(source),
    args: { value: 2 },
    cwd: process.cwd(),
    signal: controller.signal,
    onMeta() {},
    onPhase() {},
    async onAgent(prompt) {
      return { ok: true, output: prompt.toUpperCase() };
    },
  });
}

test("workflow DSL runs phases, agents, parallel work, and args", async () => {
  const result = await run(`
    export const meta = { name: "test", phases: [{ title: "scan" }] };
    phase("scan");
    const values = await parallel([() => agent("one"), () => agent("two")]);
    return { count: args.value, outputs: values.map((value) => value.output) };
  `);
  assert.deepEqual(result, { count: 2, outputs: ["ONE", "TWO"] });
});

test("workflow source rejects imports", () => {
  assert.throws(
    () => prepareWorkflowSource('import fs from "node:fs";'),
    /cannot import/,
  );
});

test("workflow sandbox has no process global", async () => {
  await assert.rejects(run("return process.env"), /process is not defined/);
});
