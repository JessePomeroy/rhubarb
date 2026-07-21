import assert from "node:assert/strict";
import test from "node:test";
import { parseChangedFiles } from "./index.ts";

test("parses modified, untracked, and renamed Git status entries", () => {
  assert.deepEqual(
    parseChangedFiles(" M src/a.ts\n?? new.txt\nR  old.ts -> new.ts\n"),
    [
      { status: " M", path: "src/a.ts" },
      { status: "??", path: "new.txt" },
      { status: "R ", path: "new.ts" },
    ],
  );
});
