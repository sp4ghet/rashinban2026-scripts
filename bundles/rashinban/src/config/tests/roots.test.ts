import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveInstallationRoots } from '../../extension/config/roots.ts';

function fixture(): string {
  return mkdtempSync(path.join(tmpdir(), 'rashinban-roots-'));
}

test('falls back to the application root outside Git', () => {
  const root = fixture();
  try {
    assert.deepEqual(resolveInstallationRoots(root, {}), {
      appRoot: path.resolve(root), sharedRoot: path.resolve(root), isWorktree: false,
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('honors an explicit shared root relative to the application root', () => {
  const root = fixture();
  try {
    mkdirSync(path.join(root, 'checkout'));
    const result = resolveInstallationRoots(path.join(root, 'checkout'), { RASHINBAN_SHARED_ROOT: '../shared' });
    assert.deepEqual(result, {
      appRoot: path.join(root, 'checkout'), sharedRoot: path.join(root, 'shared'), isWorktree: true,
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('uses the Git common directory to find the main checkout from a linked worktree', () => {
  const root = fixture();
  const main = path.join(root, 'main');
  const linked = path.join(root, 'linked');
  try {
    mkdirSync(main);
    execFileSync('git', ['init'], { cwd: main, stdio: 'ignore' });
    writeFileSync(path.join(main, 'tracked.txt'), 'base\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: main, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: main, stdio: 'ignore' });
    execFileSync('git', ['worktree', 'add', '-b', 'linked', linked], { cwd: main, stdio: 'ignore' });

    assert.deepEqual(resolveInstallationRoots(linked, {}), {
      appRoot: path.resolve(linked), sharedRoot: path.resolve(main), isWorktree: true,
    });
    assert.deepEqual(resolveInstallationRoots(main, {}), {
      appRoot: path.resolve(main), sharedRoot: path.resolve(main), isWorktree: false,
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
