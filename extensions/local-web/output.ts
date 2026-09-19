import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";

export async function output(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const truncated = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  if (!truncated.truncated) return text;
  const dir = await mkdtemp(join(tmpdir(), "pi-local-web-"));
  const path = join(dir, "result.txt");
  await writeFile(path, text, { mode: 0o600 });
  return `${truncated.content}\n\n[Truncated; complete output: ${path}]`;
}
