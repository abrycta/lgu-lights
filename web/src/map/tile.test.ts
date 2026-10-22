import { describe, expect, it } from "vitest";

import { isHtml } from "./tile";

const buf = (s: string | number[]) =>
  (typeof s === "string" ? new TextEncoder().encode(s) : new Uint8Array(s))
    .buffer as ArrayBuffer;

describe("isHtml", () => {
  it("spots the SPA fallback page", () => {
    expect(isHtml(buf("<!doctype html><html>"))).toBe(true);
    expect(isHtml(buf("﻿\n  <!DOCTYPE html>"))).toBe(true);
  });
  it("passes MVT bodies and empty tiles", () => {
    expect(isHtml(buf([0x1a, 0x3c, 0x0a]))).toBe(false);
    expect(isHtml(new ArrayBuffer(0))).toBe(false);
  });
});
