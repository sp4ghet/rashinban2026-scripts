import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

import type { InstallationRoots } from '../../config/types.ts';

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function writeEnvironmentCookie(filePath: string, original: string, cookie: string): void {
  const retained = original.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?GEOGUESSR_NCFA\s*=/.test(line));
  while (retained.length > 0 && retained.at(-1) === '') retained.pop();
  retained.push(`GEOGUESSR_NCFA=${JSON.stringify(cookie)}`, '');
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const lockPath = `${filePath}.lock`;
  let lock: number | undefined;
  mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    try { lock = openSync(lockPath, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Shared environment file is being changed');
      throw error;
    }
    const current = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
    if (current !== original) throw new Error('Shared environment file changed on disk');
    writeFileSync(temporary, retained.join('\n'), { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, filePath);
  } finally {
    rmSync(temporary, { force: true });
    if (lock !== undefined) {
      closeSync(lock);
      rmSync(lockPath, { force: true });
    }
  }
}

export function loadSharedCredentials(
  roots: InstallationRoots,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const environmentPath = path.join(roots.sharedRoot, '.env');
  let environmentText = '';
  if (existsSync(environmentPath)) {
    try {
      environmentText = readFileSync(environmentPath, 'utf8');
      const parsed = parseEnv(environmentText);
      for (const [key, value] of Object.entries(parsed)) {
        if (env[key] === undefined || (key === 'GEOGUESSR_NCFA' && !nonEmpty(env[key]) && nonEmpty(value))) env[key] = value;
      }
    } catch {
      throw new Error('Unable to load shared environment file');
    }
  }

  if (nonEmpty(env.GEOGUESSR_NCFA)) return;
  const legacyPath = path.join(roots.sharedRoot, '.secrets', 'geoguessr.json');
  if (!existsSync(legacyPath)) return;

  let cookie: string;
  try {
    const value = JSON.parse(readFileSync(legacyPath, 'utf8')) as unknown;
    if (typeof value !== 'object' || value === null || !('cookie' in value) || !nonEmpty(value.cookie)) throw new Error('Invalid payload');
    cookie = value.cookie.trim();
    if (/\r|\n|\0/.test(cookie)) throw new Error('Invalid payload');
  } catch {
    throw new Error('Unable to migrate legacy GeoGuessr credentials');
  }

  try {
    writeEnvironmentCookie(environmentPath, environmentText, cookie);
    env.GEOGUESSR_NCFA = cookie;
  } catch {
    throw new Error('Unable to migrate legacy GeoGuessr credentials');
  }
}
