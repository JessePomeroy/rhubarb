import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

const PROCESS_MAX_BYTES = 10 * 1024 * 1024;

export async function runSearchProcess(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
) {
  return new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => child.kill("SIGTERM"),
        30_000,
      );
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > PROCESS_MAX_BYTES) {
          child.kill("SIGTERM");
          reject(new Error("Search output exceeded 10 MB; narrow the query."));
          return;
        }
        target.push(chunk);
      };
      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));
      child.on("error", reject);
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          code: code ?? 1,
        });
      });
      if (signal) {
        const abort = () => child.kill("SIGTERM");
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
    },
  );
}

export async function boundedSearchOutput(
  output: string,
  label: string,
  maxResults: number,
) {
  const lines = output.split(/\r?\n/);
  const resultLimited =
    lines.length > maxResults ? lines.slice(0, maxResults).join("\n") : output;
  const truncation = truncateHead(resultLimited, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  const wasLimited = lines.length > maxResults;
  if (!wasLimited && !truncation.truncated) {
    return {
      content: [
        { type: "text" as const, text: truncation.content || "No matches." },
      ],
      details: { truncated: false },
    };
  }
  const directory = await mkdtemp(join(tmpdir(), "rhubarb-search-output-"));
  const outputPath = join(directory, `${label}.txt`);
  await writeFile(outputPath, output, { encoding: "utf8", mode: 0o600 });
  const note = `[Output bounded for context. Full ${formatSize(Buffer.byteLength(output))} output: ${outputPath}]`;
  return {
    content: [
      { type: "text" as const, text: `${truncation.content}\n\n${note}` },
    ],
    details: { truncated: true, outputPath },
  };
}
