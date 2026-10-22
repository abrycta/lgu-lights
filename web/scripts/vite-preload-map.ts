// Vite plugin: preload the map's lazy chunks and the MapLibre worker from the HTML.
//
// Every page that index.html and embed.html serve in practice shows the map, but the map code is two lazy
// imports deep (App -> MapPage -> MapView) and the worker starts only when MapView runs. Vite writes
// <link rel=modulepreload> only for static imports, so without this the browser finds those files two or
// three round trips late. This adds them to <head> at build time (the hashed names exist only then).
import type { HtmlTagDescriptor, Plugin, Rollup } from "vite";

type OutputBundle = Rollup.OutputBundle;
type OutputChunk = Rollup.OutputChunk;

/** Source modules whose chunks (and their static imports) every map page needs. */
const LAZY_MAP_MODULES = [/\/src\/pages\/MapPage\.tsx$/, /\/src\/map\/MapView\.tsx$/];
/** The MapLibre worker, emitted as an asset by `maplibre-gl-worker.mjs?url` in MapView. */
const WORKER_ASSET = /(^|\/)maplibre-gl-worker-[^/]+\.mjs$/;

function chunkClosure(bundle: OutputBundle, roots: OutputChunk[]): OutputChunk[] {
  const seen = new Map<string, OutputChunk>();
  const visit = (fileName: string) => {
    const c = bundle[fileName];
    if (seen.has(fileName) || !c || c.type !== "chunk") return;
    seen.set(fileName, c);
    c.imports.forEach(visit);
  };
  roots.forEach((r) => visit(r.fileName));
  return [...seen.values()];
}

export function preloadMap(): Plugin {
  let base = "/";
  return {
    name: "lights-preload-map",
    apply: "build",
    configResolved: (config) => void (base = config.base),
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const chunks = Object.values(bundle).filter(
          (c): c is OutputChunk => c.type === "chunk" && !!c.facadeModuleId && LAZY_MAP_MODULES.some((re) => re.test(c.facadeModuleId!)),
        );
        if (chunks.length !== LAZY_MAP_MODULES.length) throw new Error("preload-map: MapPage or MapView is no longer a separate chunk");
        const worker = Object.keys(bundle).find((f) => WORKER_ASSET.test(f));
        if (!worker) throw new Error("preload-map: no maplibre-gl-worker asset in the bundle");
        const tags: HtmlTagDescriptor[] = [];
        const closure = chunkClosure(bundle, chunks);
        for (const { fileName } of closure) {
          // The entry's own static imports already have a modulepreload (or are the entry itself).
          if (html.includes(`${base}${fileName}"`)) continue;
          tags.push({ tag: "link", attrs: { rel: "modulepreload", crossorigin: true, href: `${base}${fileName}` }, injectTo: "head" });
        }
        // Their CSS (MapLibre's), fetched early but applied only when the chunk loads, as Vite does.
        for (const css of new Set(closure.flatMap((c) => [...(c.viteMetadata?.importedCss ?? [])]))) {
          if (html.includes(`${base}${css}"`)) continue;
          tags.push({ tag: "link", attrs: { rel: "preload", as: "style", href: `${base}${css}` }, injectTo: "head" });
        }
        // MapLibre starts it as a module worker (same-origin, credentials same-origin). A worker has its own
        // module map, so this only warms the HTTP cache (/assets/* is immutable), which the worker then reads.
        tags.push({ tag: "link", attrs: { rel: "preload", as: "fetch", crossorigin: "anonymous", href: `${base}${worker}` }, injectTo: "head" });
        return { html, tags };
      },
    },
  };
}
