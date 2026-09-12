import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadSharedCredentials } from '../../extension/config/credentials.ts';
import type { InstallationRoots } from '../types.ts';

function fixture(): { root: string; roots: InstallationRoots } {
  const root = mkdtempSync(path.join(tmpdir(), 'rashinban-credentials-'));
  return { root, roots: { appRoot: root, sharedRoot: root, isWorktree: false } };
}

test('loads shared environment values while existing process values win', () => {
  const { root, roots } = fixture();
  try {
    writeFileSync(path.join(root, '.env'), 'GEOGUESSR_NCFA=from-file\nSTARTGG_TOKEN=from-file\n');
    const env: NodeJS.ProcessEnv = { GEOGUESSR_NCFA: 'from-process' };
    loadSharedCredentials(roots, env);
    assert.equal(env.GEOGUESSR_NCFA, 'from-process');
    assert.equal(env.STARTGG_TOKEN, 'from-file');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('migrates a legacy cookie over an empty env assignment and preserves the old file', () => {
  const { root, roots } = fixture();
  try {
    mkdirSync(path.join(root, '.secrets'));
    writeFileSync(path.join(root, '.env'), '# keep this\nOTHER=value\nGEOGUESSR_NCFA=\n');
    const legacy = path.join(root, '.secrets', 'geoguessr.json');
    writeFileSync(legacy, JSON.stringify({ cookie: 'legacy-secret' }));
    const env: NodeJS.ProcessEnv = {};

    loadSharedCredentials(roots, env);

    assert.equal(env.GEOGUESSR_NCFA, 'legacy-secret');
    const text = readFileSync(path.join(root, '.env'), 'utf8');
    assert.match(text, /# keep this/);
    assert.match(text, /OTHER=value/);
    assert.match(text, /GEOGUESSR_NCFA="legacy-secret"/);
    assert.equal(existsSync(legacy), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an existing nonempty environment cookie bypasses malformed legacy credentials', () => {
  const { root, roots } = fixture();
  try {
    mkdirSync(path.join(root, '.secrets'));
    writeFileSync(path.join(root, '.secrets', 'geoguessr.json'), '{secret text');
    const env: NodeJS.ProcessEnv = { GEOGUESSR_NCFA: 'existing' };
    loadSharedCredentials(roots, env);
    assert.equal(env.GEOGUESSR_NCFA, 'existing');
    assert.equal(existsSync(path.join(root, '.env')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a nonempty canonical env cookie wins when the inherited process assignment is empty', () => {
  const { root, roots } = fixture();
  try {
    mkdirSync(path.join(root, '.secrets'));
    const original = 'GEOGUESSR_NCFA=canonical\nOTHER=value\n';
    writeFileSync(path.join(root, '.env'), original);
    writeFileSync(path.join(root, '.secrets', 'geoguessr.json'), JSON.stringify({ cookie: 'legacy' }));
    const env: NodeJS.ProcessEnv = { GEOGUESSR_NCFA: '' };
    loadSharedCredentials(roots, env);
    assert.equal(env.GEOGUESSR_NCFA, 'canonical');
    assert.equal(readFileSync(path.join(root, '.env'), 'utf8'), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('malformed legacy credentials fail without exposing their contents', () => {
  const { root, roots } = fixture();
  try {
    mkdirSync(path.join(root, '.secrets'));
    writeFileSync(path.join(root, '.secrets', 'geoguessr.json'), '{super-secret-value');
    assert.throws(() => loadSharedCredentials(roots, {}), (error: unknown) => {
      assert.match((error as Error).message, /legacy GeoGuessr credentials/);
      assert.doesNotMatch((error as Error).message, /super-secret-value/);
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
