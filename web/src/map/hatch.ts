// Diagonal hatch patterns for "use with caution" (sparse) and "unreliable" (dense) areas. Each stroke
// is two-tone (ground + ink) so it stays visible over every class colour in light and dark themes.

export interface HatchImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export function hatchImage(size: number, ink: string, ground: string, pixelRatio = 2): HatchImage {
  const s = size * pixelRatio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  const stroke = (color: string, width: number, offset: number, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * pixelRatio;
    ctx.beginPath();
    // Three segments so the pattern tiles seamlessly.
    for (const k of [-s, 0, s]) {
      ctx.moveTo(k + offset, s);
      ctx.lineTo(k + s + offset, 0);
    }
    ctx.stroke();
  };
  stroke(ground, 1.4, pixelRatio * 1.1, 0.7);
  stroke(ink, 0.8, 0, 0.6);
  const img = ctx.getImageData(0, 0, s, s);
  return { width: s, height: s, data: new Uint8Array(img.data.buffer) };
}

/** CSS equivalent for legend swatches (same spacing as the map patterns). */
export function hatchCss(size: number): string {
  return `repeating-linear-gradient(-45deg, color-mix(in oklab, var(--foreground) 60%, transparent) 0 1px, color-mix(in oklab, var(--background) 80%, transparent) 1px 2.5px, transparent 2.5px ${(size / Math.SQRT2).toFixed(1)}px)`;
}

export const HATCH_SIZES = { sparse: 12, dense: 6 } as const;
