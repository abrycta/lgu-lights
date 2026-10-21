/// <reference lib="webworker" />
// What-if Web Worker (DECISIONS S5): loads the WASM module, the panel snapshot and the model once,
// then answers scenario requests off the main thread.

import { type WasmEstimate, WhatIfModule } from "./wasm";

export type Request =
  | { id: number; type: "init"; wasmUrl: string; snapshotUrl: string; modelUrl: string }
  | { id: number; type: "whatif"; pcode: string; year: number; growthPct: number; ndviDelta: number }
  | { id: number; type: "estimate"; pcode: string; year: number };

export type Response =
  | { id: number; ok: true; result: WasmEstimate | null | { n: number } }
  | { id: number; ok: false; error: string };

let mod: Promise<WhatIfModule> | null = null;

async function bytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function init(wasmUrl: string, snapshotUrl: string, modelUrl: string): Promise<WhatIfModule> {
  const [wasm, snap, model] = await Promise.all([bytes(wasmUrl), bytes(snapshotUrl), bytes(modelUrl)]);
  const m = await WhatIfModule.instantiate(wasm as Uint8Array<ArrayBuffer>);
  m.loadSnapshot(snap);
  m.loadModel(model);
  return m;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  const reply = (r: Response) => scope.postMessage(r);
  try {
    if (req.type === "init") {
      mod ??= init(req.wasmUrl, req.snapshotUrl, req.modelUrl);
      mod.catch(() => (mod = null));
      reply({ id: req.id, ok: true, result: { n: (await mod).size } });
      return;
    }
    if (!mod) throw new Error("what-if module not initialised");
    const m = await mod;
    const result = req.type === "whatif" ? m.whatif(req.pcode, req.year, req.growthPct, req.ndviDelta) : m.estimate(req.pcode, req.year);
    reply({ id: req.id, ok: true, result });
  } catch (e) {
    reply({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
