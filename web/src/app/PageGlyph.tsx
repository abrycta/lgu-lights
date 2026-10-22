/**
 * The loading state of a page (CLAUDE.md rule 29a: loading is always the muted glyph, never "…" or a spinner):
 * Lights' kanji glyph on the muted surface, the same quiet tile as the map slot and krtmtthw.dev's embed slots. It fills
 * the page area under the Header (the viewport less the Header), so the footer starts below the fold and nothing
 * visible shifts when the page arrives.
 */
export function PageGlyph() {
  return (
    <div
      aria-hidden="true"
      lang="ja"
      data-testid="page-glyph"
      className="grid min-h-[calc(100dvh-81px)] place-items-center bg-muted font-heading text-[clamp(48px,9vw,80px)] leading-none font-bold text-muted-foreground"
    >
      光
    </div>
  );
}
