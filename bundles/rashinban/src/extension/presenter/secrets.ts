import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ConnectionConfig } from './connection.ts';

export type PublicConnectionConfig = {
  partyId: string | null;
  clientVersion: string;
  cookieFile?: string;
};

export type ConnectionConfigLoaderOptions = {
  baseDir?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function loadConnectionConfig(
  publicConfig: PublicConnectionConfig,
  options: ConnectionConfigLoaderOptions = {},
): ConnectionConfig {
  if ('cookie' in publicConfig) {
    throw new Error('GeoGuessr credentials must not be stored in public NodeCG config');
  }
  if (
    !(publicConfig.partyId === null || nonEmpty(publicConfig.partyId)) ||
    !nonEmpty(publicConfig.clientVersion)
  ) {
    throw new Error('Invalid public GeoGuessr connection config');
  }

  const env = options.env ?? process.env;
  let cookie = env.GEOGUESSR_NCFA?.trim();
  if (!cookie) {
    if (!nonEmpty(publicConfig.cookieFile)) throw new Error('Set GEOGUESSR_NCFA in the shared installation .env and restart');
    try {
      const readFile = options.readFile ?? ((filePath: string) => readFileSync(filePath, 'utf8'));
      const filePath = path.resolve(options.baseDir ?? process.cwd(), publicConfig.cookieFile);
      const secret = JSON.parse(readFile(filePath)) as unknown;
      if (
        typeof secret !== 'object' ||
        secret === null ||
        !('cookie' in secret) ||
        !nonEmpty(secret.cookie)
      ) {
        throw new Error('Invalid credential payload');
      }
      cookie = secret.cookie.trim();
    } catch {
      throw new Error('Unable to load GeoGuessr credentials');
    }
  }

  return {
    cookie,
    partyId: publicConfig.partyId === null ? null : publicConfig.partyId.trim(),
    clientVersion: publicConfig.clientVersion.trim(),
  };
}
