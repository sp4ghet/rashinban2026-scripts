import { execFileSync } from 'node:child_process';
import path from 'node:path';

import type { InstallationRoots } from '../../config/types.ts';

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function resolveInstallationRoots(
  appRoot = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): InstallationRoots {
  const resolvedAppRoot = path.resolve(appRoot);
  const explicit = env.RASHINBAN_SHARED_ROOT?.trim();
  if (explicit) {
    const sharedRoot = path.resolve(resolvedAppRoot, explicit);
    return { appRoot: resolvedAppRoot, sharedRoot, isWorktree: !samePath(resolvedAppRoot, sharedRoot) };
  }

  try {
    const commonDirectory = execFileSync(
      'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: resolvedAppRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (!commonDirectory) throw new Error('Git returned an empty common directory');
    const sharedRoot = path.dirname(path.resolve(resolvedAppRoot, commonDirectory));
    return { appRoot: resolvedAppRoot, sharedRoot, isWorktree: !samePath(resolvedAppRoot, sharedRoot) };
  } catch {
    return { appRoot: resolvedAppRoot, sharedRoot: resolvedAppRoot, isWorktree: false };
  }
}
