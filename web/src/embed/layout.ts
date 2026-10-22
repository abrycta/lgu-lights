// The /embed's two layouts, chosen by the frame's own width (so a preload can pick its pack by media query):
// - desktop: krtmtthw.dev shows a fixed 1280×800 frame scaled to its picture slot (mouse and trackpad devices);
// - compact: phones and tablets get the frame at the slot's real size (at most about 960 px wide), laid out for
//   that size: the map above a two-line caption (MapPage). Phones (SMALL) get a lighter pack than tablets.
// The widths are scripts/build-embed.mjs's COMPACT_MAX_W and SMALL_MAX_W (it writes the preloads in embed.html).
import { useSyncExternalStore } from "react";

import { PACK_URL, PACK_URL_MEDIUM, PACK_URL_SMALL } from "./pack.gen";

export const COMPACT_QUERY = "(max-width: 1100px)";
export const SMALL_QUERY = "(max-width: 600px)";
/** The province fit's padding in the compact layout (scripts/build-embed.mjs: COMPACT_PAD). */
export const COMPACT_PADDING = 12;

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (on) => {
      const m = matchMedia(query);
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => matchMedia(query).matches,
  );
}

export function useLayout(): { compact: boolean; pack: string } {
  const compact = useMedia(COMPACT_QUERY);
  const small = useMedia(SMALL_QUERY);
  return { compact, pack: !compact ? PACK_URL : small ? PACK_URL_SMALL : PACK_URL_MEDIUM };
}
