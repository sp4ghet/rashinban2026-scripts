import { existsSync } from "node:fs";
import path from "node:path";

import type NodeCG from "@nodecg/types";

/**
 * Loads `.env` from the NodeCG working directory (the repo root) into
 * process.env. Existing variables win. Logs which keys were loaded, never
 * their values.
 */
export function loadLocalEnv(nodecg: NodeCG.ServerAPI, file = ".env"): string[] {
  const filePath = path.resolve(process.cwd(), file);
  if (!existsSync(filePath)) {
    nodecg.log.info(`env: no ${file} found (copy .env.example to add secrets)`);
    return [];
  }
  const before = new Set(Object.keys(process.env));
  try {
    process.loadEnvFile(filePath);
  } catch (err) {
    nodecg.log.error(`env: failed to load ${file}: ${(err as Error).message}`);
    return [];
  }
  const loaded = Object.keys(process.env).filter((k) => !before.has(k) && process.env[k] !== "");
  nodecg.log.info(`env: loaded ${loaded.length} key(s) from ${file}: ${loaded.join(", ") || "(none)"}`);
  return loaded;
}
