// Public 2026 sponsor logos, verified against https://rashinban.org/#sponsor.
// Keep the graphic independent of the public website during a broadcast.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = new URL('../bundles/rashinban/graphics/assets/interval-sponsors/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['tamura-builds.svg', 'geo_logo.svg', 'ajinomoto.gif', 'geoguessr-record.svg',
  'chofu-hernia-clinic.svg', 'bfcc.png', 'kawaii-shisshi.svg']) {
  const url = new URL(`/assets/2026/${encodeURIComponent('スポンサーロゴ')}/${name}`, 'https://rashinban.org');
  const response = await fetch(url);
  if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(name, target), bytes);
  console.log(`${name}: ${bytes.length} bytes -> ${fileURLToPath(target)}`);
}
