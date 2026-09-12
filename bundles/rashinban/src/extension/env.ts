import path from "node:path";

import type NodeCG from "@nodecg/types";
import type { InstallationRoots } from '../config/types.ts';
import { loadSharedCredentials } from './config/credentials.ts';

/** Loads credentials from the shared installation without logging values. */
export function loadSharedEnvironment(
  nodecg: NodeCG.ServerAPI,
  roots: InstallationRoots,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const filePath = path.join(roots.sharedRoot, '.env');
  try {
    loadSharedCredentials(roots, env);
  } catch (err) {
    nodecg.log.error(`env: unable to load the shared installation .env at ${filePath}`);
    throw err;
  }
  nodecg.log.info(`env: credentials use the shared installation .env at ${filePath}; changes require restart`);
}
