import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolve } from "node:path";
import { resolveSearchBinaries, type SearchBinaries } from "./binaries.ts";
import { boundedSearchOutput, runSearchProcess } from "./process.ts";

export default function fileSearchExtension(pi: ExtensionAPI) {
  let binaries: Promise<SearchBinaries> | undefined;
  const ensureBinaries = () => (binaries ??= resolveSearchBinaries());

  pi.on("session_start", async (_event, ctx) => {
    try {
      const resolved = await ensureBinaries();
      if (resolved.downloaded.length)
        ctx.ui.notify(
          `Installed verified search binaries: ${resolved.downloaded.join(", ")}`,
          "info",
        );
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        "warning",
      );
    }
  });

  pi.registerTool({
    name: "fd",
    label: "Find Files",
    description:
      "Discover files and directories quickly with fd. Output is limited to 2,000 results and 50 KB; larger requested output spills to a private file.",
    promptSnippet: "Find files and directories using fd",
    promptGuidelines: [
      "Use fd for filename and path discovery instead of shell find commands.",
    ],
    parameters: Type.Object({
      pattern: Type.Optional(
        Type.String({
          description:
            "Regular expression matched against paths; defaults to all entries",
        }),
      ),
      path: Type.Optional(
        Type.String({
          description: "Search root relative to the current working directory",
        }),
      ),
      type: Type.Optional(
        StringEnum(["file", "directory", "symlink", "executable"] as const),
      ),
      hidden: Type.Optional(Type.Boolean({ default: false })),
      max_depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 2000, default: 200 }),
      ),
    }),
    async execute(_id, params, signal, _update, ctx) {
      const { fd } = await ensureBinaries();
      const args = [
        "--color",
        "never",
        "--max-results",
        String(params.limit ?? 200),
      ];
      if (params.hidden) args.push("--hidden");
      if (params.max_depth) args.push("--max-depth", String(params.max_depth));
      if (params.type)
        args.push(
          "--type",
          (
            {
              file: "f",
              directory: "d",
              symlink: "l",
              executable: "x",
            } as const
          )[params.type],
        );
      args.push(
        "--",
        params.pattern ?? "",
        resolve(ctx.cwd, params.path ?? "."),
      );
      const result = await runSearchProcess(fd, args, ctx.cwd, signal);
      if (result.code !== 0)
        throw new Error(
          result.stderr.trim() || `fd exited with code ${result.code}`,
        );
      return boundedSearchOutput(result.stdout, "fd", params.limit ?? 200);
    },
  });

  pi.registerTool({
    name: "rg",
    label: "Search Content",
    description:
      "Search file contents with ripgrep. Output is limited to 2,000 lines and 50 KB; larger requested output spills to a private file.",
    promptSnippet: "Search file contents using ripgrep",
    promptGuidelines: [
      "Use rg for content search instead of grep or shell pipelines.",
    ],
    parameters: Type.Object({
      pattern: Type.String({
        minLength: 1,
        description: "Regex or fixed string to search",
      }),
      path: Type.Optional(
        Type.String({
          description:
            "File or directory relative to the current working directory",
        }),
      ),
      glob: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
      fixed_strings: Type.Optional(Type.Boolean({ default: false })),
      case_sensitive: Type.Optional(Type.Boolean({ default: true })),
      hidden: Type.Optional(Type.Boolean({ default: false })),
      context: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 2000, default: 200 }),
      ),
    }),
    async execute(_id, params, signal, _update, ctx) {
      const { rg } = await ensureBinaries();
      const args = ["--color", "never", "--line-number", "--with-filename"];
      if (params.fixed_strings) args.push("--fixed-strings");
      if (params.case_sensitive === false) args.push("--ignore-case");
      if (params.hidden) args.push("--hidden");
      if (params.context !== undefined)
        args.push("--context", String(params.context));
      for (const glob of params.glob ?? []) args.push("--glob", glob);
      args.push("--", params.pattern, resolve(ctx.cwd, params.path ?? "."));
      const result = await runSearchProcess(rg, args, ctx.cwd, signal);
      if (result.code !== 0 && result.code !== 1)
        throw new Error(
          result.stderr.trim() || `rg exited with code ${result.code}`,
        );
      return boundedSearchOutput(result.stdout, "rg", params.limit ?? 200);
    },
  });
}
