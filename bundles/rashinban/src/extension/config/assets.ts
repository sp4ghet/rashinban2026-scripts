import { readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { InstallationRoots } from '../../config/types.ts';
import { isMediaCategory, isMediaFilename, MEDIA_CATEGORIES, type EffectiveAssetInventory, type MediaCategory } from '../../config/media-url.ts';

const EXTENSIONS: Record<MediaCategory, readonly string[]> = {
  music: ['.wav', '.mp3', '.ogg', '.m4a'],
  effects: ['.wav', '.mp3', '.ogg', '.m4a'],
  video: ['.webm', '.mp4'],
};

function containedFile(root: string, category: MediaCategory, filename: string): string | null {
  try {
    const library = realpathSync(path.join(root, 'assets/rashinban'));
    const resolved = realpathSync(path.join(library, category, filename));
    const relative = path.relative(library, resolved);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
    return statSync(resolved).isFile() ? resolved : null;
  } catch { return null; }
}

function allowed(category: MediaCategory, filename: string): boolean {
  return isMediaFilename(filename) && EXTENSIONS[category].includes(path.extname(filename).toLowerCase());
}

export function resolveMediaFile(roots: InstallationRoots, category: string, filename: string): string | null {
  if (!isMediaCategory(category) || !allowed(category, filename)) return null;
  return containedFile(roots.appRoot, category, filename)
    ?? (roots.isWorktree ? containedFile(roots.sharedRoot, category, filename) : null);
}

export function listMediaAssets(roots: InstallationRoots): EffectiveAssetInventory {
  const result: EffectiveAssetInventory = {music: [], effects: [], video: []};
  for (const category of MEDIA_CATEGORIES) {
    const entries = new Map<string, EffectiveAssetInventory[MediaCategory][number]>();
    const sources = roots.isWorktree
      ? [{root: roots.sharedRoot, source: 'shared' as const}, {root: roots.appRoot, source: 'local' as const}]
      : [{root: roots.appRoot, source: 'shared' as const}];
    for (const {root, source} of sources) {
      let filenames: string[];
      try { filenames = readdirSync(path.join(root, 'assets/rashinban', category)); } catch { continue; }
      for (const filename of filenames) {
        if (!allowed(category, filename) || !containedFile(root, category, filename)) continue;
        entries.set(filename, {base: filename, url: `/assets/rashinban/${category}/${encodeURIComponent(filename)}`, source});
      }
    }
    result[category] = [...entries.values()].sort((a,b) => a.base!.localeCompare(b.base!));
  }
  return result;
}

/** Mounted separately because NodeCG's built-in asset route terminates missing-file requests. */
export function createMediaRouter(roots: InstallationRoots): express.Router {
  const router = express.Router();
  router.get('/:category/:file', (req,res,next) => {
    const file = resolveMediaFile(roots, req.params.category, req.params.file);
    if (!file) { res.sendStatus(404); return; }
    res.sendFile(file, error => {
      if (!error) return;
      if (res.headersSent) { next(error); return; }
      const status = (error as {status?: number}).status;
      res.sendStatus(status === 416 ? 416 : 404);
    });
  });
  router.use(((error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    res.sendStatus(404);
  }) as express.ErrorRequestHandler);
  return router;
}
