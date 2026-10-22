/** True when a tile response body is HTML (the SPA fallback) rather than an MVT: protobuf tiles start with a
 * field tag byte (0x1a for `layers`), never "<"; leading whitespace or a BOM is skipped. */
export function isHtml(data: ArrayBuffer): boolean {
  const b = new Uint8Array(data, 0, Math.min(data.byteLength, 64));
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (
    i < b.length &&
    (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)
  )
    i++;
  return b[i] === 0x3c;
}
