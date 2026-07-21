"use strict";
const vm = require("node:vm");

process.on("message", async (message) => {
  if (!message || message.kind !== "start") return;
  const { token, source, args } = message;
  let nextId = 0;
  const pending = new Map();
  const send = (payload) => process.send?.({ token, ...payload });
  const agent = (prompt, options = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    send({ kind: "agent", id, prompt: String(prompt), options });
  });
  const parallel = async (tasks, options = {}) => {
    if (!Array.isArray(tasks)) throw new Error("parallel() requires an array of functions");
    const concurrency = Math.max(1, Math.min(4, Number(options.concurrency) || 4));
    const results = new Array(tasks.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const index = cursor++;
        if (typeof tasks[index] !== "function") throw new Error("parallel entries must be functions");
        results[index] = await tasks[index]();
      }
    }));
    return results;
  };
  const onResult = (reply) => {
    if (reply?.token !== token || reply.kind !== "agentResult") return;
    const resolve = pending.get(reply.id);
    if (!resolve) return;
    pending.delete(reply.id);
    resolve(reply.result);
  };
  process.on("message", onResult);
  const context = vm.createContext({
    args,
    agent,
    parallel,
    phase: (title) => send({ kind: "phase", title: String(title).slice(0, 160) }),
    __setMeta: (meta) => send({ kind: "meta", meta }),
  }, { codeGeneration: { strings: false, wasm: false } });
  try {
    const script = new vm.Script(`(async () => { ${source}\n })()`, { timeout: 1000 });
    const result = await script.runInContext(context, { timeout: 1000 });
    if (pending.size) throw new Error("Workflow returned with unawaited agent calls");
    send({ kind: "result", result });
  } catch (error) {
    send({ kind: "error", error: error instanceof Error ? error.message : String(error) });
  } finally {
    process.off("message", onResult);
  }
});
