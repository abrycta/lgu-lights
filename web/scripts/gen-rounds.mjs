#!/usr/bin/env node
// Writes src/lib/rounds.gen.ts from config/rounds.json (audit M5), the one source of PSA SAE rounds shared with
// the Python pipeline and the Rust core. Run `npm run gen:rounds` after editing config/rounds.json;
// src/lib/rounds.test.ts fails while the generated file is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
export function render(config) {
  const rounds = config.rounds.map((r) => ({ year: r.year, estimator: r.estimator }));
  return `// Written by scripts/gen-rounds.mjs from config/rounds.json; do not edit.
export const ROUNDS = ${JSON.stringify(rounds)} as const;
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(readFileSync(join(web, "../config/rounds.json"), "utf8"));
  writeFileSync(join(web, "src/lib/rounds.gen.ts"), render(config));
}
