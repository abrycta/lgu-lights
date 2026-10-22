/**
 * The pre-load still of the map slot (Kurt, 2026-10-23): Lights' kanji glyph on the muted surface, the same quiet tile
 * as krtmtthw.dev's embed slots, until the map has drawn its first full frame with data. Never an empty map frame.
 * It fills the slot (`absolute inset-0`), so nothing shifts.
 */
export function MapGlyph() {
  return (
    <div
      aria-hidden="true"
      lang="ja"
      data-testid="map-glyph"
      className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-muted font-heading text-[clamp(40px,7vw,64px)] leading-none font-bold text-muted-foreground"
    >
      光
    </div>
  );
}
