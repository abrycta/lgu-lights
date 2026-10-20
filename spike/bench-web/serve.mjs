// Minimal static server that honours single-range requests (206 + Content-Range) and sends CORS headers,
// i.e. what GitHub Pages does for PMTiles. Logs every request (method, path, range, status, bytes) to a
// JSONL file so a browser session's tile traffic can be counted. Throwaway spike code.
//   node serve.mjs <root> <port> <logfile>
import { createServer } from "node:http";
import { createReadStream, statSync, appendFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const [root, port = "8765", log = "requests.jsonl"] = process.argv.slice(2);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".json": "application/json", ".pmtiles": "application/octet-stream", ".bin": "application/octet-stream" };

export const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const path = normalize(join(root, decodeURIComponent(url.pathname)));
  const rec = { t: Date.now(), m: req.method, p: url.pathname, range: req.headers.range ?? null };
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, If-Match");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, ETag, Accept-Ranges");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  let st;
  try { st = statSync(path); if (!st.isFile()) throw 0; } catch { res.writeHead(404); res.end(); appendFileSync(log, JSON.stringify({ ...rec, s: 404, b: 0 }) + "\n"); return; }
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
  res.setHeader("ETag", `"${st.size}-${st.mtimeMs}"`);
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  let start = 0, end = st.size - 1, status = 200;
  if (m) {
    if (m[1] === "") { start = Math.max(0, st.size - Number(m[2])); } else { start = Number(m[1]); if (m[2] !== "") end = Math.min(Number(m[2]), st.size - 1); }
    if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); res.end(); return; }
    status = 206; res.setHeader("Content-Range", `bytes ${start}-${end}/${st.size}`);
  }
  res.setHeader("Content-Length", end - start + 1);
  res.writeHead(status);
  appendFileSync(log, JSON.stringify({ ...rec, s: status, b: end - start + 1 }) + "\n");
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(path, { start, end }).pipe(res);
});
server.listen(Number(port), "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
