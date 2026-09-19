import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "node:net";
import { once } from "node:events";
import { stat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { splitChildPane } from "./src/herdr-panes.ts";
import { createPaneBridge } from "./src/pane-bridge.ts";
import { parseFrame, shellQuote } from "./src/pane-protocol.ts";

test("pane creation requires caller context, targets returned IDs, and preserves focus/cwd", async () => {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[1] === "layout")
      return JSON.stringify({
        result: {
          layout: {
            panes: [{ pane_id: "w7:p9", rect: { width: 160, height: 35 } }],
          },
        },
      });
    if (args[1] === "split")
      return JSON.stringify({ result: { pane: { pane_id: "w7:p23" } } });
    return "";
  };
  await assert.rejects(
    splitChildPane("/tmp", "node viewer", run, {}),
    /inside Herdr/,
  );
  assert.equal(calls.length, 0);
  const id = await splitChildPane("/tmp/a folder", "node viewer", run, {
    HERDR_ENV: "1",
    HERDR_PANE_ID: "w7:p9",
  });
  assert.equal(id, "w7:p23");
  assert.deepEqual(calls, [
    ["pane", "layout", "--pane", "w7:p9"],
    [
      "pane",
      "split",
      "--pane",
      "w7:p9",
      "--direction",
      "right",
      "--cwd",
      "/tmp/a folder",
      "--no-focus",
    ],
    ["pane", "run", "w7:p23", "node viewer"],
  ]);
});

test("Herdr 0.7.5 empty successful pane run output is accepted by the command runner", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-cli-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "herdr"),
    `#!${process.execPath}
const command = process.argv[3];
if (command === "layout") console.log(JSON.stringify({result: {layout: {panes: [{pane_id: "w7:p9", rect: {width: 160, height: 35}}]}}}));
else if (command === "split") console.log(JSON.stringify({result: {pane: {pane_id: "w7:p23"}}}));
else if (command === "run") process.exit(0);
else process.exit(2);
`,
    { mode: 0o700 },
  );
  const originalPath = process.env.PATH;
  process.env.PATH = directory;
  t.after(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });
  assert.equal(
    await splitChildPane("/tmp", "node viewer", undefined, {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w7:p9",
    }),
    "w7:p23",
  );
});

test("private pane IPC delivers replies, shows failures, resizes, and cleans up", async () => {
  let listener: (() => void) | undefined;
  let subscribed = false;
  let width = 0;
  let text = "初期 state";
  const sent: Array<[string, string | undefined]> = [];
  let cancelled = false;
  const bridge = await createPaneBridge({
    frame: (columns) => {
      width = columns;
      return {
        type: "frame",
        title: "child",
        status: "running",
        questionId: "q-1",
        lines: [text],
      };
    },
    subscribe: (fn) => {
      listener = fn;
      subscribed = true;
      return () => {
        subscribed = false;
      };
    },
    send: async (message, replyTo) => {
      if (replyTo !== "q-1") throw new Error("stale reply");
      sent.push([message, replyTo]);
    },
    abort: () => {
      cancelled = true;
    },
  });
  assert.equal((await stat(bridge.socketPath)).mode & 0o777, 0o600);
  const socket = connect(bridge.socketPath);
  socket.setEncoding("utf8");
  const lines = createInterface({ input: socket });
  const reader = lines[Symbol.asyncIterator]();
  const read = async () => {
    const item = await reader.next();
    assert.equal(typeof item.value, "string");
    if (item.value === undefined)
      throw new Error("Pane socket ended unexpectedly");
    return JSON.parse(item.value);
  };
  try {
    assert.equal(parseFrame(await read()).lines[0], text);
    socket.write(JSON.stringify({ type: "resize", width: 100 }) + "\n");
    await reader.next();
    assert.equal(width, 100);
    socket.write(
      JSON.stringify({
        type: "send",
        text: "Use the current contract",
        replyTo: "q-1",
      }) + "\n",
    );
    assert.equal((await read()).type, "sent");
    assert.deepEqual(sent, [["Use the current contract", "q-1"]]);
    socket.write(
      JSON.stringify({ type: "send", text: "late", replyTo: "q-0" }) + "\n",
    );
    assert.equal((await read()).message, "stale reply");
    text = "新しい state";
    listener?.();
    assert.equal(parseFrame(await read()).lines[0], text);
    socket.write(JSON.stringify({ type: "cancel" }) + "\n");
    // A resize response follows the cancellation command in this same stream.
    socket.write(JSON.stringify({ type: "resize", width: 90 }) + "\n");
    await reader.next();
    assert.equal(cancelled, true);
  } finally {
    const disconnected = once(socket, "close");
    await bridge.close();
    await disconnected;
    lines.close();
  }
  assert.equal(subscribed, false);
  await assert.rejects(stat(bridge.socketPath), { code: "ENOENT" });
});

test("viewer command quoting keeps shell substitutions inside a literal argument", () => {
  assert.equal(
    shellQuote("/tmp/has spaces/$value`command`'quote"),
    "'/tmp/has spaces/$value`command`'\\''quote'",
  );
});

test(
  "standalone child viewer renders in a PTY and sends an interactive reply",
  { timeout: 10000 },
  async () => {
    let received!: (value: [string, string | undefined]) => void;
    const answer = new Promise<[string, string | undefined]>((resolve) => {
      received = resolve;
    });
    let cancelled!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    const bridge = await createPaneBridge({
      frame: () => ({
        type: "frame",
        title: "PTY child",
        status: "waiting for parent",
        questionId: "q-test",
        lines: ["Which file should I use?"],
      }),
      subscribe: () => () => {},
      send: async (text, id) => {
        received([text, id]);
      },
      abort: () => cancelled(),
    });
    const command = [
      process.execPath,
      fileURLToPath(new URL("./src/pane-view.ts", import.meta.url)),
      bridge.socketPath,
    ]
      .map(shellQuote)
      .join(" ");
    const child = spawn(
      "script",
      ["-q", "-e", "-c", `stty cols 100 rows 30; exec ${command}`, "/dev/null"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, TERM: "xterm-256color", SHELL: "/bin/sh" },
      },
    );
    const exited = once(child, "exit");
    let output = "";
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("Which file should I use?")) resolve();
        });
        child.once("exit", () =>
          reject(new Error(`Viewer exited before rendering: ${output}`)),
        );
      });
      child.stdin.write("app.ts\r");
      assert.deepEqual(await answer, ["app.ts", "q-test"]);
      child.stdin.write("\x18");
      await cancellation;
      child.stdin.write("\x04");
      const [code] = await exited;
      assert.equal(code, 0);
      assert.match(output, /PTY child/);
    } finally {
      await bridge.close();
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  },
);
