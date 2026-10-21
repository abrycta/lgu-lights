import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, useT } from "@abrycta/akari/react";
import { useMemo } from "react";

import type { Index } from "@/data/types";

interface Item {
  p: string;
  label: string;
}

/** Accessible LGU search (combobox): the keyboard route to any of the 1,642 places. */
export function LguSearch({ index, value, onSelect }: { index: Index; value: string | null; onSelect: (pcode: string) => void }) {
  const t = useT();
  const items = useMemo<Item[]>(() => {
    const prov = new Map(index.provinces.map((p) => [p.pcode, p.name]));
    return index.lgus.map((l) => ({ p: l.p, label: `${l.n}, ${prov.get(l.pv) ?? l.pv}` })).sort((a, b) => a.label.localeCompare(b.label));
  }, [index]);
  const selected = useMemo(() => items.find((i) => i.p === value) ?? null, [items, value]);
  return (
    <Combobox<Item>
      items={items}
      value={selected}
      limit={60}
      itemToStringLabel={(i) => i.label}
      isItemEqualToValue={(a, b) => a.p === b.p}
      onValueChange={(v) => {
        if (v) onSelect(v.p);
      }}
    >
      <ComboboxInput
        placeholder={t("Search a city or municipality", "市町村を検索")}
        aria-label={t("Search a city or municipality", "市町村を検索")}
        triggerLabel={t("Show places", "地域の一覧を表示")}
        data-testid="lgu-search"
      />
      <ComboboxContent>
        <ComboboxEmpty>{t("No place found.", "該当する地域がありません。")}</ComboboxEmpty>
        <ComboboxList>
          {(item: Item) => (
            <ComboboxItem key={item.p} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
