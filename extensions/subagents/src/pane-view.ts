import { connect } from "node:net";
import {
  Input,
  ProcessTerminal,
  TUI,
  matchesKey,
  truncateToWidth,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";
import { parseFrame, record, type PaneFrame } from "./pane-protocol.ts";

const path = process.argv[2];
if (!path) throw new Error("A parent-provided child socket is required.");
const socket = connect(path);
socket.setEncoding("utf8");
const terminal = new ProcessTerminal();
const tui = new TUI(terminal);
let frame: PaneFrame = {
  type: "frame",
  title: "Connecting to child…",
  status: "",
  lines: [],
};
let note = "";
let offset = 0;
let closed = false;
let lastWidth = 0;
let submitted: string | undefined;
const input = new Input();
const send = (value: unknown) => {
  if (!socket.destroyed) socket.write(JSON.stringify(value) + "\n");
};
const finish = () => {
  if (closed) return;
  closed = true;
  socket.destroy();
  tui.stop();
  process.stdout.write(
    "\nChild pane detached. The child remains managed by its parent.\n",
  );
};
input.onSubmit = (text) => {
  if (!text.trim() || submitted !== undefined) return;
  submitted = text;
  send({ type: "send", text, replyTo: frame.questionId });
  note = "Sending…";
  // Preserve input until acknowledgement so a rejected reply can be corrected.
  tui.requestRender();
};
const component: Component & Focusable = {
  get focused() {
    return input.focused;
  },
  set focused(value) {
    input.focused = value;
  },
  invalidate() {
    input.invalidate();
  },
  render(width) {
    if (width !== lastWidth) {
      lastWidth = width;
      send({ type: "resize", width });
    }
    const available = Math.max(1, terminal.rows - 5);
    offset = Math.min(offset, Math.max(0, frame.lines.length - available));
    const end = frame.lines.length - offset;
    const lines = frame.lines.slice(Math.max(0, end - available), end);
    while (lines.length < available) lines.push("");
    return [
      truncateToWidth(`${frame.title} · ${frame.status}`, width),
      ...lines.map((line) => truncateToWidth(line, width)),
      truncateToWidth(
        note ||
          "Enter send/reply · PgUp/PgDn scroll · Ctrl+X cancel child · Ctrl+D detach",
        width,
      ),
      ...input.render(width),
    ];
  },
  handleInput(data) {
    if (matchesKey(data, "ctrl+d")) {
      finish();
      return;
    }
    if (matchesKey(data, "ctrl+x")) {
      send({ type: "cancel" });
      return;
    }
    if (matchesKey(data, "pageUp")) offset += Math.max(1, terminal.rows - 5);
    else if (matchesKey(data, "pageDown"))
      offset = Math.max(0, offset - Math.max(1, terminal.rows - 5));
    else input.handleInput(data);
    tui.requestRender();
  },
};
let buffer = "";
socket.on("data", (chunk) => {
  buffer += chunk.toString();
  let newline: number;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    try {
      const data = record(JSON.parse(line));
      if (data.type === "frame") frame = parseFrame(data);
      else if (data.type === "sent") {
        if (input.getValue() === submitted) input.setValue("");
        submitted = undefined;
        note = "Delivered";
        offset = 0;
      } else if (data.type === "error") {
        submitted = undefined;
        note = `Error: ${String(data.message)}`;
      }
    } catch {
      note = "Invalid message from parent";
    }
    tui.requestRender();
  }
});
socket.on("error", (error) => {
  finish();
  process.stderr.write(`${error.message}\n`);
});
socket.on("close", finish);
process.on("SIGTERM", finish);
process.on("SIGINT", finish);
tui.addChild(component);
tui.setFocus(component);
tui.start();
