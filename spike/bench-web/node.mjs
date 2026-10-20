import { readFileSync } from "node:fs";
import { run } from "./bench.mjs";
const fx = new URL("../rust/fixtures/", import.meta.url);
const f32 = (n) => { const b = readFileSync(new URL(n, fx)); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
for (const prof of ["wasm", "release"]) {
  const w = readFileSync(new URL(`../rust/target/wasm32-unknown-unknown/${prof}/spike_infer.wasm`, import.meta.url));
  console.log(JSON.stringify({ host: `node ${process.version}`, profile: prof, ...(await run(w, f32("ref_gru.bin"), f32("ref_trees.bin"))) }));
}
