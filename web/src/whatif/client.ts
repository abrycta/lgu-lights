// Main-thread side of the what-if worker: one lazily created worker, promise per request.

import { dataBase } from "@/data/load";

import type { WasmEstimate } from "./wasm";
import type { Request, Response } from "./worker";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let ready: Promise<unknown> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Payload = DistributiveOmit<Request, "id">;

function send<T>(msg: Payload): Promise<T> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...msg, id });
  });
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "whatif" });
    worker.onmessage = (ev: MessageEvent<Response>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
    worker.onerror = (ev) => {
      for (const p of pending.values()) p.reject(new Error(ev.message || "what-if worker failed"));
      pending.clear();
    };
  }
  return worker;
}

function ensureReady(): Promise<unknown> {
  if (!ready) {
    ready = dataBase().then((base) =>
      send({
        type: "init",
        wasmUrl: new URL(`${import.meta.env.BASE_URL}wasm/lgu_wasm.wasm`, location.href).href,
        snapshotUrl: `${base}whatif/snapshot.bin`,
        modelUrl: `${base}whatif/model.json`,
      }),
    );
    ready.catch(() => (ready = null));
  }
  return ready;
}

export async function runWhatIf(pcode: string, year: number, growthPct: number, ndviDelta: number): Promise<WasmEstimate | null> {
  await ensureReady();
  return send<WasmEstimate | null>({ type: "whatif", pcode, year, growthPct, ndviDelta });
}

export async function runEstimate(pcode: string, year: number): Promise<WasmEstimate | null> {
  await ensureReady();
  return send<WasmEstimate | null>({ type: "estimate", pcode, year });
}
