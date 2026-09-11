// Downloads country flag PNGs (public domain, from flagcdn.com) into
// bundles/rashinban/graphics/assets/images/flags/<iso2>.png so overlays
// work offline. Run once: `node scripts/fetch-flags.mjs`.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const OUT = "bundles/rashinban/graphics/assets/images/flags";
const WIDTH = "w160";
mkdirSync(OUT, { recursive: true });
const codes = await (await fetch("https://flagcdn.com/en/codes.json")).json();
let done = 0;
for (const code of Object.keys(codes)) {
  if (code.includes("-")) continue; // skip subdivisions (us-ca etc.)
  const file = path.join(OUT, `${code}.png`);
  if (existsSync(file)) continue;
  const res = await fetch(`https://flagcdn.com/${WIDTH}/${code}.png`);
  if (!res.ok) {
    console.error(`skip ${code}: HTTP ${res.status}`);
    continue;
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  done++;
}
writeFileSync(path.join(OUT, "codes.json"), JSON.stringify(codes, null, 2) + "\n");
console.log(`downloaded ${done} flags into ${OUT}`);
