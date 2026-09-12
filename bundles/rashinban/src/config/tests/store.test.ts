import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { DEFAULT_APPLICATION_CONFIG } from '../schema.ts';
import type { ApplicationConfig, InstallationRoots } from '../types.ts';
import { createConfigStore } from '../../extension/config/store.ts';

function fixture(worktree = true): { root: string; shared: string; app: string; roots: InstallationRoots } {
  const root = mkdtempSync(path.join(tmpdir(), 'rashinban-store-'));
  const shared = path.join(root, 'main');
  const app = worktree ? path.join(root, 'worktree') : shared;
  mkdirSync(path.join(shared, 'cfg'), { recursive: true });
  mkdirSync(app, { recursive: true });
  return { root, shared, app, roots: { appRoot: app, sharedRoot: shared, isWorktree: worktree } };
}

function sharedConfig(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, ...patch };
}

function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (check()) resolve();
      else if (Date.now() >= deadline) reject(new Error('Timed out waiting for file watcher'));
      else setTimeout(poll, 20);
    };
    poll();
  });
}

test('worktree precedence and saves remain sparse without changing shared text', () => {
  const f = fixture();
  try {
    const sharedFile = path.join(f.shared, 'cfg', 'rashinban.json');
    const localFile = path.join(f.app, 'cfg', 'rashinban.local.json');
    const originalSharedText = JSON.stringify(sharedConfig({ presenter: { settings: { musicGain: 0.25 } } }), null, 2) + '\n';
    writeFileSync(sharedFile, originalSharedText);
    mkdirSync(path.dirname(localFile));
    writeFileSync(localFile, JSON.stringify({ presenter: { settings: { keyColor: '#00ff00' } } }, null, 2) + '\n');
    const store = createConfigStore({ roots: f.roots, watch: false });

    assert.equal(store.get().presenter.settings.musicGain, 0.25);
    assert.equal(store.get().presenter.settings.keyColor, '#00ff00');
    store.save('presenterSettings', { ...store.get().presenter.settings, muted: true });

    const local = JSON.parse(readFileSync(localFile, 'utf8'));
    assert.equal(local.presenter.settings.muted, true);
    assert.equal(local.presenter.settings.keyColor, '#00ff00');
    assert.equal(local.presenter.settings.musicGain, undefined);
    assert.equal(readFileSync(sharedFile, 'utf8'), originalSharedText);
    assert.deepEqual(store.status().overridden, ['presenterSettings']);
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('arrays replace and explicit null clears nullable inherited values', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.shared, 'cfg', 'rashinban.json'), JSON.stringify(sharedConfig({
      presenter: { media: { stems: [{ id: 'one', url: '/assets/rashinban/music/one.mp3', loopStartS: 0, loopEndS: 10,
        gains: { idle: 1, round: 1, urgent: 1, results: 1 } }], fiveK: { single: {
          url: '/assets/rashinban/video/one.mp4', watchdogMs: 1000, soundtrack: 'silent',
        } } } },
    })));
    mkdirSync(path.join(f.app, 'cfg'));
    writeFileSync(path.join(f.app, 'cfg', 'rashinban.local.json'), JSON.stringify({
      presenter: { media: { stems: [], fiveK: { single: null } } },
    }));
    const store = createConfigStore({ roots: f.roots, watch: false });
    assert.deepEqual(store.get().presenter.media.stems, []);
    assert.equal(store.get().presenter.media.fiveK.single, null);
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('reset removes one local section and preserves unrelated overrides', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.shared, 'cfg', 'rashinban.json'), JSON.stringify(sharedConfig({ presenter: { settings: { muted: true } } })));
    mkdirSync(path.join(f.app, 'cfg'));
    const localFile = path.join(f.app, 'cfg', 'rashinban.local.json');
    writeFileSync(localFile, JSON.stringify({ presenter: { settings: { muted: false }, media: { sounds: {} } }, sheet: { enabled: true } }));
    const store = createConfigStore({ roots: f.roots, watch: false });
    store.reset('presenterSettings');
    assert.equal(store.get().presenter.settings.muted, true);
    const saved = JSON.parse(readFileSync(localFile, 'utf8'));
    assert.equal(saved.sheet.enabled, true);
    assert.deepEqual(saved.presenter.media.sounds, {});
    assert.deepEqual(store.status().overridden, ['sheetConfig']);
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects stale revisions and compare-before-write races', () => {
  const f = fixture();
  try {
    const sharedFile = path.join(f.shared, 'cfg', 'rashinban.json');
    writeFileSync(sharedFile, JSON.stringify(sharedConfig()));
    const store = createConfigStore({ roots: f.roots, watch: false });
    const revision = store.status().revision;
    mkdirSync(path.join(f.app, 'cfg'));
    writeFileSync(path.join(f.app, 'cfg', 'rashinban.local.json'), JSON.stringify({ sheet: { enabled: true } }));
    assert.throws(() => store.save('sheetConfig', store.get().sheet, revision), /changed on disk/);
    assert.equal(readFileSync(sharedFile, 'utf8'), JSON.stringify(sharedConfig()));
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects an expected revision after another successful save', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.shared, 'cfg', 'rashinban.json'), JSON.stringify(sharedConfig()));
    const store = createConfigStore({ roots: f.roots, watch: false });
    const stale = store.status().revision;
    store.save('sheetConfig', { ...store.get().sheet, enabled: true }, stale);
    assert.throws(() => store.save('sheetConfig', { ...store.get().sheet, enabled: false }, stale), /revision is stale/);
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('an exclusive writer lock rejects a cooperative concurrent writer', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.shared, 'cfg', 'rashinban.json'), JSON.stringify(sharedConfig()));
    mkdirSync(path.join(f.app, 'cfg'));
    const localFile = path.join(f.app, 'cfg', 'rashinban.local.json');
    writeFileSync(`${localFile}.lock`, 'held');
    const store = createConfigStore({ roots: f.roots, watch: false });
    assert.throws(() => store.save('sheetConfig', { ...store.get().sheet, enabled: true }), /another process/);
    assert.throws(() => readFileSync(localFile, 'utf8'), /ENOENT/);
    assert.equal(readFileSync(`${localFile}.lock`, 'utf8'), 'held');
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('missing config directories are created by the first successful save', () => {
  const f = fixture();
  try {
    rmSync(path.join(f.app, 'cfg'), { recursive: true, force: true });
    writeFileSync(path.join(f.shared, 'cfg', 'rashinban.json'), JSON.stringify(sharedConfig()));
    const store = createConfigStore({ roots: f.roots, watch: false });
    store.save('startggConfig', { ...store.get().startgg, enabled: true });
    assert.equal(JSON.parse(readFileSync(path.join(f.app, 'cfg', 'rashinban.local.json'), 'utf8')).startgg.enabled, true);
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('an atomic write failure leaves the file and effective state unchanged', () => {
  const f = fixture();
  try {
    const sharedFile = path.join(f.shared, 'cfg', 'rashinban.json');
    writeFileSync(sharedFile, JSON.stringify(sharedConfig()));
    const store = createConfigStore({ roots: f.roots, watch: false, fileSystem: {
      writeAtomic() { throw new Error('simulated disk failure'); },
    } });
    const before = store.get();
    assert.throws(() => store.save('sheetConfig', { ...before.sheet, enabled: true }), /simulated disk failure/);
    assert.deepEqual(store.get(), before);
    assert.equal(readFileSync(sharedFile, 'utf8'), JSON.stringify(sharedConfig()));
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('launch overrides remain process-local when a section is saved', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.shared, 'cfg', 'rashinban.json'), JSON.stringify(sharedConfig({ presenter: { settings: { muted: false } } })));
    const store = createConfigStore({ roots: f.roots, watch: false, launchOverrides: { presenter: { settings: { muted: true } } } });
    store.save('presenterSettings', { ...store.get().presenter.settings, musicGain: 0.4 });
    const local = JSON.parse(readFileSync(path.join(f.app, 'cfg', 'rashinban.local.json'), 'utf8'));
    assert.equal(local.presenter.settings.muted, undefined);
    assert.equal(local.presenter.settings.musicGain, 0.4);
    assert.equal(store.get().presenter.settings.muted, true);
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('invalid startup files expose a diagnostic instead of appearing valid', () => {
  const f = fixture(false);
  try {
    writeFileSync(path.join(f.shared, 'cfg', 'rashinban.json'), JSON.stringify({ schemaVersion: 1, cookie: 'forbidden' }));
    const store = createConfigStore({ roots: f.roots, watch: false });
    assert.match(store.status().error ?? '', /Unknown configuration field|credential/i);
    assert.deepEqual(store.get(), DEFAULT_APPLICATION_CONFIG);
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('an invalid worktree startup file retains valid shared bindings with a diagnostic', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.shared, 'cfg', 'rashinban.json'), JSON.stringify(sharedConfig({ presenter: { settings: { musicGain: 0.35 } } })));
    mkdirSync(path.join(f.app, 'cfg'));
    writeFileSync(path.join(f.app, 'cfg', 'rashinban.local.json'), '{broken');
    const store = createConfigStore({ roots: f.roots, watch: false });
    assert.equal(store.get().presenter.settings.musicGain, 0.35);
    assert.match(store.status().error ?? '', /Worktree configuration contains invalid JSON/);
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('watching retains the last good state through an invalid edit and recovers', async () => {
  const f = fixture(false);
  try {
    const file = path.join(f.shared, 'cfg', 'rashinban.json');
    writeFileSync(file, JSON.stringify(sharedConfig({ sheet: { enabled: true } })));
    const store = createConfigStore({ roots: f.roots, watch: true });
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });
    writeFileSync(file, '{broken');
    await waitFor(() => store.status().error !== null);
    assert.equal(store.get().sheet.enabled, true);
    writeFileSync(file, JSON.stringify(sharedConfig({ sheet: { enabled: false } })));
    await waitFor(() => store.status().error === null && store.get().sheet.enabled === false);
    assert.ok(notifications >= 2);
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('startup migration fills missing fields, keeps file values, and writes a marker once', () => {
  const f = fixture(false);
  try {
    const sharedFile = path.join(f.shared, 'cfg', 'rashinban.json');
    writeFileSync(sharedFile, JSON.stringify({ presenter: { settings: { muted: false }, cookieFile: '.secrets/geoguessr.json' } }));
    mkdirSync(path.join(f.shared, 'db'));
    const db = new DatabaseSync(path.join(f.shared, 'db', 'nodecg.sqlite3'));
    db.exec('CREATE TABLE replicant (namespace TEXT, name TEXT, value TEXT)');
    db.prepare('INSERT INTO replicant VALUES (?, ?, ?)').run('rashinban', 'presenterSettings', JSON.stringify({
      ...DEFAULT_APPLICATION_CONFIG.presenter.settings, muted: true, musicGain: 0.2,
    }));
    db.close();
    const store = createConfigStore({ roots: f.roots, watch: false });
    assert.equal(store.get().presenter.settings.muted, false);
    assert.equal(store.get().presenter.settings.musicGain, 0.2);
    const migrated = JSON.parse(readFileSync(sharedFile, 'utf8'));
    assert.equal(migrated.schemaVersion, 1);
    assert.equal(migrated.presenter.cookieFile, undefined);
    store.dispose();

    writeFileSync(path.join(f.shared, 'db', 'nodecg.sqlite3'), 'unreadable now');
    const reopened = createConfigStore({ roots: f.roots, watch: false });
    assert.equal(reopened.status().error, null);
    assert.equal(reopened.get().presenter.settings.musicGain, 0.2);
    reopened.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a missing legacy database does not create a shared migration marker', () => {
  const f = fixture(false);
  try {
    const sharedFile = path.join(f.shared, 'cfg', 'rashinban.json');
    const store = createConfigStore({ roots: f.roots, watch: false });
    assert.equal(store.status().error, null);
    assert.deepEqual(store.get(), DEFAULT_APPLICATION_CONFIG);
    assert.throws(() => readFileSync(sharedFile, 'utf8'), /ENOENT/);
    store.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('schema rejects unknown fields, unsafe fixtures, and undersized polling intervals', () => {
  for (const value of [
    { schemaVersion: 1, surprise: true },
    { schemaVersion: 1, presenter: { replayFixture: '../secret.json' } },
    { schemaVersion: 1, sheet: { pollIntervalMs: 4999 } },
    { schemaVersion: 1, startgg: { pollIntervalMs: Number.POSITIVE_INFINITY } },
    { schemaVersion: 1, startgg: { pollIntervalMs: 9999 } },
  ]) {
    const f = fixture(false);
    try {
      writeFileSync(path.join(f.shared, 'cfg', 'rashinban.json'), JSON.stringify(value));
      const store = createConfigStore({ roots: f.roots, watch: false });
      assert.notEqual(store.status().error, null);
      store.dispose();
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('an unreadable existing legacy database is a startup diagnostic and worktree databases are ignored', () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.shared, 'db'));
    writeFileSync(path.join(f.shared, 'db', 'nodecg.sqlite3'), 'not sqlite');
    const broken = createConfigStore({ roots: f.roots, watch: false });
    assert.match(broken.status().error ?? '', /legacy configuration database/);
    broken.dispose();

    rmSync(path.join(f.shared, 'db', 'nodecg.sqlite3'));
    mkdirSync(path.join(f.app, 'db'));
    const db = new DatabaseSync(path.join(f.app, 'db', 'nodecg.sqlite3'));
    db.exec('CREATE TABLE replicant (namespace TEXT, name TEXT, value TEXT)');
    db.prepare('INSERT INTO replicant VALUES (?, ?, ?)').run('rashinban', 'sheetConfig', JSON.stringify({
      enabled: true, sheetId: 'worktree', playersGid: '0', pollIntervalMs: 5000,
    }));
    db.close();
    const clean = createConfigStore({ roots: f.roots, watch: false });
    assert.equal(clean.status().error, null);
    assert.equal(clean.get().sheet.enabled, false);
    clean.dispose();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
