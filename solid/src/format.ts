// A JSON value as the goldens store it — the one formatter of a frame on the JS side, used by `solid/dump.ts` to store
// a golden and by `dump-check.mjs` to compare a C host's frame with one (a third host's dump is the same bytes, or a
// named field).
const primitive = (v: unknown) => v === null || typeof v !== "object";
const flat = (v: unknown[]) => v.every(primitive);

/**
 * Object keys sorted (their order carries no meaning here), a flat array on one line, and one element of an array of
 * objects a line — so a command is a line and a miss is readable in a diff. Numbers are written as they came (JSON's own
 * round trip), never rounded.
 */
export function format(value: unknown, indent = ""): string {
  if (primitive(value)) return JSON.stringify(value);
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (flat(value)) return `[${value.map((v) => format(v)).join(", ")}]`;
    return `[\n${value.map((v) => inner + format(v, inner)).join(",\n")}\n${indent}]`;
  }
  const object = value as Record<string, unknown>;
  // a command is an object of scalars and short arrays: one line, so the goldens are a line a command
  const keys = Object.keys(object).sort();
  if (keys.length === 0) return "{}";
  const body = keys.map((key) => `${JSON.stringify(key)}: ${format(object[key], inner)}`);
  if (keys.every((key) => primitive(object[key]) || (Array.isArray(object[key]) && flat(object[key] as unknown[]))))
    return `{ ${body.join(", ")} }`;
  return `{\n${body.map((line) => inner + line).join(",\n")}\n${indent}}`;
}
