import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSearchBinaries } from "./binaries.ts";
import { runSearchProcess } from "./process.ts";

test("resolves usable fd and rg binaries", async () => {
  const binaries = await resolveSearchBinaries();
  assert.ok(binaries.fd);
  assert.ok(binaries.rg);
});

test("runs ripgrep without shell interpolation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rhubarb-search-test-"));
  try {
    writeFileSync(join(directory, "example.txt"), "needle value\n");
    const { rg } = await resolveSearchBinaries();
    const result = await runSearchProcess(
      rg,
      ["--line-number", "--", "needle", directory],
      directory,
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /needle value/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
