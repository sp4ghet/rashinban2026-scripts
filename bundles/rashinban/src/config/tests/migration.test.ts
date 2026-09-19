import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { DEFAULT_SETTINGS } from '../../presenter/settings.ts';
import { readLegacyConfiguration } from '../../extension/config/migration.ts';

function fixture(): { root: string; databasePath: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'rashinban-migration-'));
  return { root, databasePath: path.join(root, 'nodecg.sqlite3') };
}

test('a missing legacy database has no configuration to import', () => {
  const { root, databasePath } = fixture();
  try { assert.deepEqual(readLegacyConfiguration(databasePath), {}); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('reads only the four rashinban settings rows from one legacy database', () => {
  const { root, databasePath } = fixture();
  try {
    const db = new DatabaseSync(databasePath);
    db.exec('CREATE TABLE replicant (namespace TEXT, name TEXT, value TEXT)');
    const insert = db.prepare('INSERT INTO replicant VALUES (?, ?, ?)');
    insert.run('rashinban', 'presenterSettings', JSON.stringify({ ...DEFAULT_SETTINGS, muted: true }));
    insert.run('rashinban', 'sheetConfig', JSON.stringify({ enabled: true, sheetId: 'sheet', playersGid: '42', pollIntervalMs: 5000 }));
    insert.run('rashinban', 'unrelated', JSON.stringify({ ignored: true }));
    insert.run('another-bundle', 'presenterSettings', JSON.stringify({ ...DEFAULT_SETTINGS, muted: false }));
    db.close();

    assert.deepEqual(readLegacyConfiguration(databasePath), {
      presenterSettings: { ...DEFAULT_SETTINGS, muted: true },
      // castersGid postdates this row; parseSheetConfig backfills the default.
      sheetConfig: { enabled: true, sheetId: 'sheet', playersGid: '42', castersGid: '247806508', pollIntervalMs: 5000 },
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reads an on-disk SQLite fixture without requiring write access or creating journals', () => {
  const { root, databasePath } = fixture();
  try {
    const db = new DatabaseSync(databasePath);
    db.exec('CREATE TABLE replicant (namespace TEXT, name TEXT, value TEXT)');
    db.prepare('INSERT INTO replicant VALUES (?, ?, ?)').run('rashinban', 'startggConfig', JSON.stringify({
      enabled: false, eventSlug: 'event', tournamentSlug: 'tournament', pollIntervalMs: 10000,
    }));
    db.close();
    chmodSync(databasePath, 0o444);

    assert.deepEqual(readLegacyConfiguration(databasePath), {
      startggConfig: { enabled: false, eventSlug: 'event', tournamentSlug: 'tournament', pollIntervalMs: 10000 },
    });
    assert.equal(existsSync(`${databasePath}-journal`), false);
    assert.equal(existsSync(`${databasePath}-wal`), false);
  } finally {
    if (existsSync(databasePath)) chmodSync(databasePath, 0o666);
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports a malformed legacy settings row without including its value', () => {
  const { root, databasePath } = fixture();
  try {
    const db = new DatabaseSync(databasePath);
    db.exec('CREATE TABLE replicant (namespace TEXT, name TEXT, value TEXT)');
    db.prepare('INSERT INTO replicant VALUES (?, ?, ?)').run('rashinban', 'presenterSettings', '{private-value');
    db.close();
    assert.throws(() => readLegacyConfiguration(databasePath), (error: unknown) => {
      assert.match((error as Error).message, /presenterSettings/);
      assert.doesNotMatch((error as Error).message, /private-value/);
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
