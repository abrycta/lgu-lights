/**
 * An inline loading mark (CLAUDE.md rule 29a: loading is always the muted glyph, never "…" or a spinner): Lights'
 * kanji glyph in a small muted tile exactly one line high (`1lh`), so it takes the place of the "…" it replaces
 * without moving anything. Decorative; the surrounding panel says what it is.
 */
export function GlyphLoading() {
  return (
    <span
      aria-hidden="true"
      lang="ja"
      data-testid="glyph-loading"
      className="inline-grid size-[1lh] place-items-center rounded-xs bg-muted align-top font-heading text-[0.7em] leading-none font-bold text-muted-foreground"
    >
      光
    </span>
  );
}
