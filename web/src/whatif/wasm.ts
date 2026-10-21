// Typed wrapper around crates/lgu-wasm (raw C ABI, no wasm-bindgen; see its lib.rs). Pure: no DOM,
// no worker APIs, so the same code runs in the Web Worker and in a Node test.

export interface WasmExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  load_snapshot(ptr: number, len: number): number;
  load_model(ptr: number, len: number): number;
  n_lgus(): number;
  lgu_index(id: number): number;
  estimate(i: number, year: number): number;
  whatif(i: number, year: number, growthPct: number, ndviDelta: number): number;
  whatif_all(year: number, growthPct: number, ndviDelta: number): number;
  out_ptr(): number;
  all_ptr(): number;
  tiers_ptr(): number;
}

export interface WasmEstimate {
  value: number;
  lo50: number;
  hi50: number;
  lo90: number;
  hi90: number;
  cv: number;
  tier: 0 | 1 | 2;
  /** The official round the estimate builds on. */
  prevYear: number;
}

export const STATUS = { OK: 0, BAD_INPUT: 1, NOT_LOADED: 2, NO_ESTIMATE: 3 } as const;

export class WasmError extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`${what} failed with status ${status}`);
  }
}

/** PH0102801 -> 102801 (the module's LGU id). */
export function pcodeId(pcode: string): number {
  return Number.parseInt(pcode.replace(/^PH/, ""), 10);
}

export class WhatIfModule {
  private constructor(private readonly x: WasmExports) {}

  static async instantiate(bytes: BufferSource): Promise<WhatIfModule> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new WhatIfModule(instance.exports as unknown as WasmExports);
  }

  private copyIn(data: Uint8Array, load: (ptr: number, len: number) => number, what: string) {
    const ptr = this.x.alloc(data.length);
    // Views are taken after alloc: alloc may grow memory and detach older buffers.
    new Uint8Array(this.x.memory.buffer, ptr, data.length).set(data);
    const status = load(ptr, data.length);
    this.x.dealloc(ptr, data.length);
    if (status !== STATUS.OK) throw new WasmError(status, what);
  }

  loadSnapshot(bytes: Uint8Array) {
    this.copyIn(bytes, (p, n) => this.x.load_snapshot(p, n), "load_snapshot");
  }

  loadModel(json: string | Uint8Array) {
    const bytes = typeof json === "string" ? new TextEncoder().encode(json) : json;
    this.copyIn(bytes, (p, n) => this.x.load_model(p, n), "load_model");
  }

  get size(): number {
    return this.x.n_lgus();
  }

  index(pcode: string): number {
    return this.x.lgu_index(pcodeId(pcode));
  }

  private readOut(): WasmEstimate {
    const o = new Float64Array(this.x.memory.buffer, this.x.out_ptr(), 8);
    return { value: o[0]!, lo50: o[1]!, hi50: o[2]!, lo90: o[3]!, hi90: o[4]!, cv: o[5]!, tier: o[6]! as 0 | 1 | 2, prevYear: o[7]! };
  }

  private run(status: number, what: string): WasmEstimate | null {
    if (status === STATUS.NO_ESTIMATE) return null;
    if (status !== STATUS.OK) throw new WasmError(status, what);
    return this.readOut();
  }

  /** The model estimate (no scenario); null when the LGU has no earlier official round. */
  estimate(pcode: string, year: number): WasmEstimate | null {
    const i = this.index(pcode);
    if (i < 0) return null;
    return this.run(this.x.estimate(i, year), "estimate");
  }

  /** A hypothetical scenario; the interval comes back widened by the model's what-if factor. */
  whatif(pcode: string, year: number, growthPct: number, ndviDelta: number): WasmEstimate | null {
    const i = this.index(pcode);
    if (i < 0) return null;
    return this.run(this.x.whatif(i, year, growthPct, ndviDelta), "whatif");
  }

  /** Whole-map scenario: values (NaN = none) and tiers (255 = none), in snapshot order. Copies out. */
  whatifAll(year: number, growthPct: number, ndviDelta: number): { values: Float32Array; tiers: Uint8Array } {
    const status = this.x.whatif_all(year, growthPct, ndviDelta);
    if (status !== STATUS.OK) throw new WasmError(status, "whatif_all");
    const n = this.size;
    return {
      values: new Float32Array(this.x.memory.buffer, this.x.all_ptr(), n).slice(),
      tiers: new Uint8Array(this.x.memory.buffer, this.x.tiers_ptr(), n).slice(),
    };
  }
}
