// Times the spike-infer wasm in any JS host. Exports run(bytes, refGru, refTrees) -> results object.
export async function run(wasmBytes, refGru, refTrees) {
  const t0 = performance.now();
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const t1 = performance.now();
  const e = instance.exports;
  const n = e.init();
  const t2 = performance.now();
  e.all();
  const og = new Float32Array(e.memory.buffer, e.out_gru_ptr(), n);
  const ot = new Float32Array(e.memory.buffer, e.out_trees_ptr(), n);
  let dg = 0, dt = 0;
  for (let i = 0; i < n; i++) { dg = Math.max(dg, Math.abs(og[i] - refGru[i])); dt = Math.max(dt, Math.abs(ot[i] - refTrees[i])); }
  const best = (f, reps, rounds = 5) => { let b = Infinity; for (let r = 0; r < rounds; r++) { const s = performance.now(); f(reps); b = Math.min(b, (performance.now() - s) / reps); } return b; };
  const gruUs = best((k) => e.gru_one(7, k), 20000) * 1000;
  const oneUs = best((k) => e.one(7, k), 20000) * 1000;
  const all = []; for (let r = 0; r < 30; r++) { const s = performance.now(); e.all(); all.push(performance.now() - s); }
  all.sort((a, b) => a - b);
  return { n, instantiate_ms: +(t1 - t0).toFixed(2), init_decode_ms: +(t2 - t1).toFixed(2), max_abs_diff_gru: dg, max_abs_diff_trees: dt,
           gru_one_us: +gruUs.toFixed(2), gru_trees_one_us: +oneUs.toFixed(2), all_median_ms: +all[15].toFixed(3), all_min_ms: +all[0].toFixed(3) };
}
