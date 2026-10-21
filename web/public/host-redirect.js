// The app moved from lgu.krtmtthw.dev to lights.krtmtthw.dev (2026-10-21). DNS is at Porkbun, so there is no
// edge redirect: send old-host visitors on before anything renders, keeping the path, query and hash.
if (location.hostname === "lgu.krtmtthw.dev") {
  location.replace("https://lights.krtmtthw.dev" + location.pathname + location.search + location.hash);
}
