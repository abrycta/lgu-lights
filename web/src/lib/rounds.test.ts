import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// @ts-expect-error: a plain .mjs script without types
import { render } from "../../scripts/gen-rounds.mjs";

import { CENSUS_EB_FROM, LAST_ELL, roundsBefore, yearList, yearSpan } from "./rounds";

describe("rounds from config/rounds.json", () => {
  it("rounds.gen.ts is up to date (npm run gen:rounds)", () => {
    const config = JSON.parse(readFileSync(new URL("../../../config/rounds.json", import.meta.url), "utf8"));
    expect(readFileSync(new URL("./rounds.gen.ts", import.meta.url), "utf8")).toBe(render(config));
  });
  it("derives the method change and the wording", () => {
    expect([LAST_ELL, CENSUS_EB_FROM]).toEqual([2018, 2021]);
    expect(roundsBefore(2012)).toEqual([2006, 2009]);
    expect(yearList([2012, 2015, 2018], "en", true)).toBe("2012, 2015 and 2018");
    expect(yearList([2012, 2015], "ja")).toBe("2012・2015");
    expect(yearSpan(2012, 2025, "ja")).toBe("2012〜2025");
  });
});
