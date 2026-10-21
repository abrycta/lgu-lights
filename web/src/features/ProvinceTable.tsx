import { T, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, useLang, useT } from "@abrycta/akari/react";
import { use, useMemo, useState } from "react";

import { loadLgu } from "@/data/load";
import type { Index, IndexProvince, LguDetail } from "@/data/types";
import { cvText, interval, num } from "@/lib/format";
import { sourceLabel, TIER_LABEL } from "@/lib/honesty";

const provCache = new Map<string, Promise<LguDetail[]>>();
function loadProvince(index: Index, pcode: string): Promise<LguDetail[]> {
  let p = provCache.get(pcode);
  if (!p) {
    p = Promise.all(index.lgus.filter((l) => l.pv === pcode).map((l) => loadLgu(l.p)));
    p.catch(() => provCache.delete(pcode));
    provCache.set(pcode, p);
  }
  return p;
}

type SortKey = "name" | "value" | "width";

/** Sortable table of a province's LGUs for the selected year: the non-visual (and keyboard) view of the map. */
export function ProvinceTable({ index, province, year, onSelect }: { index: Index; province: IndexProvince; year: number; onSelect: (pcode: string) => void }) {
  const t = useT();
  const { lang } = useLang();
  const lgus = use(loadProvince(index, province.pcode));
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "value", dir: -1 });

  const rows = useMemo(() => {
    const r = lgus.map((l) => {
      const rec = l.years.find((y) => y.year === year);
      const shown = rec?.shown ?? null;
      const src = shown?.source === "official" ? rec?.official : rec?.model;
      return { l, shown, lo: src?.lo90 ?? null, hi: src?.hi90 ?? null, cv: src?.cv ?? null };
    });
    const v = (x: (typeof r)[number]) =>
      sort.key === "name" ? 0 : sort.key === "value" ? (x.shown?.value ?? -Infinity) : x.lo != null && x.hi != null ? x.hi - Math.max(0, x.lo) : -Infinity;
    return r.sort((a, b) => (sort.key === "name" ? a.l.name.localeCompare(b.l.name) * sort.dir : (v(a) - v(b)) * sort.dir));
  }, [lgus, year, sort]);

  const header = (key: SortKey, en: string, ja: string) => {
    const active = sort.key === key;
    return (
      <TableHead aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
          onClick={() => setSort({ key, dir: active ? ((-sort.dir) as 1 | -1) : key === "name" ? 1 : -1 })}
        >
          {t(en, ja)}
          <span aria-hidden="true">{active ? (sort.dir === 1 ? "↑" : "↓") : "↕"}</span>
        </button>
      </TableHead>
    );
  };

  return (
    <Table data-testid="province-table">
      <TableCaption className="text-left">
        <T en={`${province.name}: ${lgus.length} cities and municipalities, ${year}. Select a name for details.`} ja={`${province.name}：${lgus.length}市町村、${year}年。名前を選ぶと詳細を表示します。`} />
      </TableCaption>
      <TableHeader>
        <TableRow>
          {header("name", "City / municipality", "市町村")}
          {header("value", "Poverty %", "貧困率 %")}
          {header("width", "90 % interval", "90%区間")}
          <TableHead>{t("Source · reliability", "出典・信頼性")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ l, shown, lo, hi, cv }) => (
          <TableRow key={l.pcode}>
            <TableCell>
              <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => onSelect(l.pcode)}>
                {l.name}
              </button>
            </TableCell>
            <TableCell className={`font-mono tabular ${shown?.source === "model" ? "italic text-muted-foreground" : ""}`}>{shown ? num(shown.value) : "—"}</TableCell>
            <TableCell className="font-mono text-xs tabular">{lo != null && hi != null ? interval(lo, hi, lang).text : "—"}</TableCell>
            <TableCell className="text-xs">
              {shown ? (
                <>
                  <span className={shown.source === "model" ? "italic" : ""}>{sourceLabel(shown.source, year, lang)}</span>
                  <br />
                  <span className="text-muted-foreground">
                    {TIER_LABEL[shown.tier][lang]}
                    {cv != null ? ` · CV ${cvText(cv)}` : ""}
                  </span>
                </>
              ) : (
                t("No estimate", "推計なし")
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
