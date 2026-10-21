import { NativeSelect, NativeSelectOptGroup, NativeSelectOption, useT } from "@abrycta/akari/react";
import { useId, useMemo } from "react";

import type { Index } from "@/data/types";

/** Province list grouped by region: a keyboard alternative to clicking the map. */
export function ProvincePicker({ index, value, onChange }: { index: Index; value: string | null; onChange: (pcode: string | null) => void }) {
  const t = useT();
  const id = useId();
  const groups = useMemo(
    () =>
      index.regions.map((r) => ({
        ...r,
        provinces: index.provinces.filter((p) => p.region === r.p).sort((a, b) => a.name.localeCompare(b.name)),
      })),
    [index],
  );
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="sr-only">
        {t("Province", "州")}
      </label>
      <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} data-testid="province-select" className="w-full">
        <NativeSelectOption value="">{t("Whole country (choose a province)", "全国（州を選択）")}</NativeSelectOption>
        {groups.map((g) => (
          <NativeSelectOptGroup key={g.p} label={g.n}>
            {g.provinces.map((p) => (
              <NativeSelectOption key={p.pcode} value={p.pcode}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        ))}
      </NativeSelect>
    </div>
  );
}
