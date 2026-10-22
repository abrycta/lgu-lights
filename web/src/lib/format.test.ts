import { describe, expect, it } from "vitest";

import { numShown, pctInline, pctShown } from "./format";

describe("model estimates of 0.0", () => {
  it("read below 1 % in EN and JA", () => {
    expect(pctShown(0, "en", true)).toBe("below 1 % (model estimate)");
    expect(pctShown(0.04, "ja", true)).toBe("1%未満（モデル推計）");
    expect(pctInline(0, "en", true)).toBe("below 1 %");
    expect(pctInline(0, "ja", true)).toBe("1%未満");
    expect(numShown(0, true)).toBe("<1");
  });
  it("leave other figures as they are", () => {
    expect(pctShown(0.05, "en", true)).toBe("0.1 %");
    expect(pctShown(0, "en", false)).toBe("0.0 %");
    expect(numShown(4.92, true)).toBe("4.9");
  });
});
