// Copy the researched SFX into NodeCG's effects inventory; preserve existing media settings.
// Usage: node scripts/install-geoguessr-sfx.mjs [directory containing manifest.json and MP3s]
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const source = resolve(process.argv[2] ?? 'assets/sfx/geoguessr');
const target = resolve('assets/rashinban/effects');
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const aliases = {
  pin: 'guessMapSelectPin', guess: 'INTERACTION_YOU_GUESSED',
  countdown: 'EFFECT_COUNT_DOWN_TICK', 'round-start': 'EFFECT_PANO_REVEAL',
  results: 'SCORE_ROWS_SLIDE_IN', count: 'COUNT_DAMAGE', collision: 'DAMAGE_CRASH',
  tie: 'TIE_CRASH', multiplier: 'EFFECT_MULTIPLIER', damage: 'LOST_HEALTH', 'five-k': 'EFFECT_5K',
};
const selected = Object.entries(aliases).map(([cue, alias]) => {
  const asset = manifest.assets.find(asset => asset.aliases.includes(alias));
  assert.ok(asset, `Missing researched alias: ${alias}`);
  assert.match(asset.file, /^[\w-]+\.mp3$/);
  const data = readFileSync(join(source, asset.file));
  assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256, `Hash mismatch: ${asset.file}`);
  return { cue, file: asset.file };
});
mkdirSync(target, { recursive: true });
for (const asset of selected) copyFileSync(join(source, asset.file), join(target, asset.file));
console.log(JSON.stringify(Object.fromEntries(selected.map(({cue, file}) => [cue, `/assets/rashinban/effects/${file}`])), null, 2));
