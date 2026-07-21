import { parse } from "acorn";

export function prepareWorkflowSource(source: string) {
  const program = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowReturnOutsideFunction: true,
  });
  let prepared = source;
  let offset = 0;
  let foundMeta = false;

  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      throw new Error("Workflow scripts cannot import modules.");
    }
    if (
      statement.type.startsWith("Export") &&
      statement.type !== "ExportNamedDeclaration"
    ) {
      throw new Error("Only `export const meta = {...}` is allowed.");
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (
      foundMeta ||
      statement.source ||
      statement.specifiers.length ||
      declaration?.type !== "VariableDeclaration" ||
      declaration.kind !== "const" ||
      declaration.declarations.length !== 1 ||
      declaration.declarations[0].id.type !== "Identifier" ||
      declaration.declarations[0].id.name !== "meta"
    ) {
      throw new Error(
        "Only one `export const meta = {...}` declaration is allowed.",
      );
    }
    foundMeta = true;
    const prefixStart = statement.start + offset;
    const declarationStart = declaration.start + offset;
    prepared =
      prepared.slice(0, prefixStart) +
      " ".repeat(declaration.start - statement.start) +
      prepared.slice(declarationStart);
    const insertion = statement.end + offset;
    const hook = ";__setMeta(meta);";
    prepared = prepared.slice(0, insertion) + hook + prepared.slice(insertion);
    offset += hook.length;
  }

  return prepared;
}
