import { readFileSync } from 'node:fs';

export function sample(name: string): unknown {
  const url = new URL(`../../../../../docs/geoguessr/samples/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}
