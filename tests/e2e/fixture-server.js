// Serve site/ like GitHub Pages does, but answer the data files from a fixture folder.
// The page itself is not changed: it still fetches data.json and labs.json next to
// index.html, and this server hands it the small committed fixtures instead.
//
// Run by hand to look at the site with fixture data:
//   node tests/e2e/fixture-server.js --port 8771
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const SITE = join(ROOT, "site");
export const FIXTURES = join(ROOT, "tests", "fixtures");
// Files the page fetches that come from the fixture folder instead of site/.
const DATA_FILES = new Set(["data.json", "labs.json"]);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function fileFor(url, fixtures) {
  let path;
  try { path = decodeURIComponent(new URL(url, "http://localhost").pathname); } catch { return null; }
  if (path.endsWith("/")) path += "index.html";
  const name = path.slice(1);
  if (DATA_FILES.has(name)) return join(fixtures, name);
  const file = resolve(SITE, "." + path);
  return file.startsWith(SITE + sep) ? file : null;
}

export function createFixtureServer(fixtures = FIXTURES) {
  return createServer(async (req, res) => {
    const file = fileFor(req.url, fixtures);
    try {
      if (!file) throw new Error("outside site/");
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { port: { type: "string", default: "8771" }, fixtures: { type: "string", default: FIXTURES } },
  });
  createFixtureServer(values.fixtures).listen(Number(values.port), "127.0.0.1", () => {
    console.log(`Serving ${SITE} with data from ${values.fixtures} at http://127.0.0.1:${values.port}/`);
  });
}
