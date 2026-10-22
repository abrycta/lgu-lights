// The choropleth (lazy chunk: MapLibre is ~290 kB gzipped). No external basemap in M1: the 1,642 LGU
// polygons cover the country, so the map is a plain ground plus our own static vector tiles.

import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre 6 derives its worker URL at runtime from import.meta.url, which bundlers cannot see, so the
// self-contained worker file is emitted as an asset and handed to MapLibre explicitly.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { setWorkerUrl } from "maplibre-gl";

setWorkerUrl(workerUrl);

// Tiles are a sparse z/x/y directory: empty (ocean) tiles do not exist. The deploy puts a 404.html in
// data/ so Pages answers 404 there, but the dev server (and Pages without it) answers with the SPA's
// index.html and status 200, which _headers labels application/x-protobuf. This protocol turns a 404 or
// an HTML body (sniffed: an MVT never starts with "<") into an empty tile instead of a parse error.
maplibregl.addProtocol("lgutile", async (params, abort) => {
  const url = params.url.slice("lgutile://".length);
  // Not on the deploy's list of existing tiles: an empty (ocean) tile, so no request (and no 404 in the console).
  const list = await loadTileList();
  const key = tileKey(url);
  if (list && key && !list.has(key)) return { data: new ArrayBuffer(0) };
  const r = await fetch(url, { signal: abort.signal });
  if (!r.ok || (r.headers.get("content-type") ?? "").includes("text/html")) return { data: new ArrayBuffer(0) };
  const data = await r.arrayBuffer();
  return { data: isHtml(data) ? new ArrayBuffer(0) : data };
});

import { addHatchImages, choroplethLayers } from "@abrycta/akari/maps";
import { useT } from "@abrycta/akari/react";
import * as maplibregl from "maplibre-gl";
import type { MapGeoJSONFeature, Map as MlMap } from "maplibre-gl";
import { use, useEffect, useLayoutEffect, useRef, useState } from "react";

import { loadNational, loadTileList, tileKey, tilesUrl } from "@/data/load";
import type { IndexProvince } from "@/data/types";
import { sourceLabel, TIER_LABEL, type Lang } from "@/lib/honesty";
import { pctShown } from "@/lib/format";

import { MapGlyph } from "./MapGlyph";
import { isHtml } from "./tile";
import { featurePcode, fillColor, fillOpacity, hatchFilter, hatchPattern, PH_BOUNDS, pcodeId, placeYear, type ThemeKey, tokenColor } from "./style";

export interface MapViewProps {
  base: string;
  year: number;
  breaks: readonly number[];
  theme: ThemeKey;
  lang: Lang;
  province: IndexProvince | null;
  lgu: string | null;
  names: Map<string, string>;
  onPick: (pcode: string) => void;
}

const yy = (year: number) => String(year % 100).padStart(2, "0");

function idOf(pcode: string | null): number {
  return pcode ? pcodeId(pcode) : -1;
}

export default function MapView({ base, year, breaks, theme, lang, province, lgu, names, onPick }: MapViewProps) {
  const t = useT();
  const el = useRef<HTMLDivElement>(null);
  // The glyph still covers the map until its first full frame with data (MapGlyph).
  const [drawn, setDrawn] = useState(false);
  const mapRef = useRef<MlMap | null>(null);
  const loaded = useRef(false);
  // Every place's value, tier and source per year (tiles-attrs.csv): from data v4 on the tiles carry
  // geometry and pcode only, so the paint expressions look the values up by feature id. Fetched with the
  // page, so this rarely waits; null (no CSV) falls back to the tiles' own properties.
  const national = use(loadNational());
  // Latest props for event handlers registered once.
  const props = useRef({ year, lang, names, onPick, province, national });
  const themeRef = useRef(theme);
  useLayoutEffect(() => {
    props.current = { year, lang, names, onPick, province, national };
    themeRef.current = theme;
  });

  // Create the map once.
  useEffect(() => {
    if (!el.current) return;
    const [fill, outline] = choroplethLayers({ id: "lgu-fill", source: "lgu", sourceLayer: "lgu", property: `v${yy(year)}`, breaks, theme: theme.startsWith("dark") ? "dark" : "light" });
    const map = new maplibregl.Map({
      container: el.current,
      bounds: PH_BOUNDS,
      fitBoundsOptions: { padding: 16 },
      maxBounds: [110, 0, 132, 25],
      minZoom: 3.5,
      maxZoom: 13,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          lgu: {
            type: "vector",
            tiles: [`lgutile://${tilesUrl(base)}`],
            minzoom: 0,
            maxzoom: 10,
            attribution: "Boundaries: OCHA/NAMRIA/PSA COD-AB (CC BY-IGO), indicative · Estimates: PSA SAE; model: Lights",
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": tokenColor("color.bg", theme) } },
          { ...(fill as object), paint: { "fill-color": fillColor(year, breaks, theme, national), "fill-opacity": fillOpacity(year, national) } } as maplibregl.FillLayerSpecification,
          {
            id: "lgu-hatch",
            type: "fill",
            source: "lgu",
            "source-layer": "lgu",
            filter: hatchFilter(year, national) as maplibregl.FilterSpecification,
            paint: { "fill-pattern": hatchPattern(year, national) as maplibregl.DataDrivenPropertyValueSpecification<string> },
          },
          { ...(outline as object) } as maplibregl.LineLayerSpecification,
          {
            id: "prov-line",
            type: "line",
            source: "lgu",
            "source-layer": "prov",
            paint: { "line-color": tokenColor("color.text-muted", theme), "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 9, 1.4] },
          },
          {
            id: "prov-selected",
            type: "line",
            source: "lgu",
            "source-layer": "prov",
            filter: ["==", ["get", "pcode"], ""],
            paint: { "line-color": tokenColor("color.text", theme), "line-width": 2.5 },
          },
          {
            id: "lgu-hover",
            type: "line",
            source: "lgu",
            "source-layer": "lgu",
            paint: { "line-color": tokenColor("color.text", theme), "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 1.5, 0] },
          },
          {
            id: "lgu-selected",
            type: "line",
            source: "lgu",
            "source-layer": "lgu",
            filter: ["==", ["id"], -1],
            paint: { "line-color": tokenColor("color.accent", theme), "line-width": 3 },
          },
        ],
      },
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map?: MlMap }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

    map.on("load", () => {
      loaded.current = true;
      addHatchImages(map, theme);
      // The first idle after load: the tiles and their data are drawn. The glyph lifts.
      map.once("idle", () => setDrawn(true));
    });
    // Akari's hatch images on demand: tiles can be parsed before "load", and setStyle() drops added images.
    map.setMissingStyleImageResolver(async (id) => {
      if (id.startsWith("hatch-")) addHatchImages(map, themeRef.current);
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "lgu-popup", maxWidth: "260px" });
    let hovered: number | string | undefined;
    const clearHover = () => {
      if (hovered !== undefined) map.setFeatureState({ source: "lgu", sourceLayer: "lgu", id: hovered }, { hover: false });
      hovered = undefined;
      popup.remove();
    };
    map.on("mousemove", "lgu-fill", (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (!f) return;
      map.getCanvas().style.cursor = "pointer";
      if (f.id !== hovered) {
        clearHover();
        hovered = f.id;
        if (hovered !== undefined) map.setFeatureState({ source: "lgu", sourceLayer: "lgu", id: hovered }, { hover: true });
      }
      const { year: y, lang: l, names: n, national: nat } = props.current;
      const pcode = featurePcode(f);
      const p = f.properties as Record<string, unknown>;
      const { v, s, t: tr } = placeYear(pcode, p, y, nat);
      const name = (pcode && n.get(pcode)) ?? (typeof p.n === "string" ? p.n : "");
      const root = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = name;
      const line = document.createElement("div");
      if (v != null) {
        const label = sourceLabel(s === 0 ? "official" : "model", y, l);
        const tier = tr == null ? "" : (TIER_LABEL[tr as 0 | 1 | 2]?.[l] ?? "");
        line.textContent = `${label}: ${pctShown(v, l, s !== 0)} · ${tier}`;
        if (s !== 0) line.className = "lgu-popup-model";
      } else {
        line.textContent = l === "ja" ? `${y}年：データなし` : `${y}: no data`;
      }
      root.append(title, line);
      popup.setLngLat(e.lngLat).setDOMContent(root).addTo(map);
    });
    map.on("mouseleave", "lgu-fill", () => {
      map.getCanvas().style.cursor = "";
      clearHover();
    });
    map.on("click", "lgu-fill", (e) => {
      const f = e.features?.[0];
      const pcode = f && featurePcode(f);
      if (pcode) props.current.onPick(pcode);
    });

    return () => {
      loaded.current = false;
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
    // The map is created once per data version; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Year and theme: repaint (cheap: 1,642 features).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setPaintProperty("lgu-fill", "fill-color", fillColor(year, breaks, theme, national));
      map.setPaintProperty("lgu-fill", "fill-opacity", fillOpacity(year, national));
      map.setFilter("lgu-hatch", hatchFilter(year, national) as maplibregl.FilterSpecification);
      map.setPaintProperty("lgu-hatch", "fill-pattern", hatchPattern(year, national));
      map.setPaintProperty("background", "background-color", tokenColor("color.bg", theme));
      map.setPaintProperty("lgu-fill-outline", "line-color", tokenColor("color.bg", theme));
      map.setPaintProperty("prov-line", "line-color", tokenColor("color.text-muted", theme));
      map.setPaintProperty("prov-selected", "line-color", tokenColor("color.text", theme));
      map.setPaintProperty("lgu-hover", "line-color", tokenColor("color.text", theme));
      map.setPaintProperty("lgu-selected", "line-color", tokenColor("color.accent", theme));
      addHatchImages(map, theme); // recolours in place (updateImage) for the new theme
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [year, breaks, theme, national]);

  // Selection outlines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setFilter("prov-selected", ["==", ["get", "pcode"], province?.pcode ?? ""]);
      map.setFilter("lgu-selected", ["==", ["id"], idOf(lgu)]);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [province, lgu]);

  // Province -> fit its bbox; none -> the whole country. MapLibre skips the animation under reduced motion.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const b = province?.bbox ?? PH_BOUNDS;
    map.fitBounds(b, { padding: 32, maxZoom: 10, duration: 800 });
  }, [province]);

  // Localise MapLibre's control labels (its locale option is read only at construction).
  useEffect(() => {
    const root = el.current;
    if (!root) return;
    const label = (sel: string, text: string) => {
      const b = root.querySelector(sel);
      b?.setAttribute("aria-label", text);
      b?.setAttribute("title", text);
    };
    label(".maplibregl-ctrl-zoom-in", t("Zoom in", "拡大"));
    label(".maplibregl-ctrl-zoom-out", t("Zoom out", "縮小"));
    label(".maplibregl-ctrl-attrib-button", t("Toggle attribution", "出典の表示切替"));
  }, [t, base]);

  // MapLibre sets position: relative on its container, so the absolute frame is a separate wrapper.
  return (
    <div className="absolute inset-0">
      <div
        ref={el}
        className="h-full w-full"
        role="region"
        aria-label={t(
          "Map of poverty incidence by city and municipality. Use the search, the province list or the table to select places with the keyboard.",
          "市町村別の貧困率の地図。キーボードでは検索、州の一覧、表から地域を選べます。",
        )}
        data-testid="map"
      />
      {drawn ? null : <MapGlyph />}
    </div>
  );
}
