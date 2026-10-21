// Runs the real module against the linked data version (scripts/build-wasm.sh, scripts/link-data.sh);
// skipped when either is missing so a fresh checkout still passes.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { LguDetail } from "@/data/types";

import { pcodeId, WhatIfModule } from "./wasm";

const pub = fileURLToPath(new URL("../../public/", import.meta.url));
const wasmPath = `${pub}wasm/lgu_wasm.wasm`;
const latestPath = `${pub}data/latest.json`;
const have = existsSync(wasmPath) && existsSync(latestPath);

describe("pcodeId", () => {
  it("drops the PH prefix and leading zeros", () => {
    expect(pcodeId("PH0102801")).toBe(102801);
    expect(pcodeId("PH1907501")).toBe(1907501);
  });
});

describe.skipIf(!have)("what-if module (real WASM + linked data)", () => {
  const base = () => realpathSync(`${pub}data/${(JSON.parse(readFileSync(latestPath, "utf8")) as { base: string }).base}`);

  async function load() {
    const m = await WhatIfModule.instantiate(readFileSync(wasmPath));
    m.loadSnapshot(readFileSync(`${base()}/whatif/snapshot.bin`));
    m.loadModel(readFileSync(`${base()}/whatif/model.json`));
    return m;
  }

  it("zero scenario equals the model estimate, which matches the materialised JSON", async () => {
    const m = await load();
    expect(m.size).toBeGreaterThan(1000);
    const lgu = JSON.parse(readFileSync(`${base()}/lgu/PH0102801.json`, "utf8")) as LguDetail;
    const rec = lgu.years.find((y) => y.year === 2025 && y.model)!;
    const est = m.estimate("PH0102801", 2025)!;
    const zero = m.whatif("PH0102801", 2025, 0, 0)!;
    expect(zero.value).toBe(est.value);
    expect(est.value).toBeCloseTo(rec.model!.estimate, 1);
    // The scenario interval is wider than the model's (stated widening factor).
    expect(zero.hi90 - zero.lo90).toBeGreaterThanOrEqual(est.hi90 - est.lo90);
    // Brighter nights should not raise the estimate's interval centre to NaN; the value stays in 0..100.
    const bright = m.whatif("PH0102801", 2025, 30, 0)!;
    expect(bright.value).toBeGreaterThanOrEqual(0);
    expect(bright.value).toBeLessThanOrEqual(100);
  });

  it("returns null for an unknown LGU", async () => {
    const m = await load();
    expect(m.whatif("PH9999999", 2025, 0, 0)).toBeNull();
  });
});
