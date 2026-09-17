import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { parseConfigSection } from '../../config/schema.ts';
import type { ConfigSection, ConfigSections } from '../../config/types.ts';

const SETTINGS_ROWS = ['presenterSettings', 'presenterMedia', 'sheetConfig', 'startggConfig'] as const satisfies readonly ConfigSection[];

export function readLegacyConfiguration(databasePath: string): Partial<ConfigSections> {
  if (!existsSync(databasePath)) return {};
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare(`
      SELECT name, value FROM replicant
      WHERE namespace = ?
        AND name IN ('presenterSettings', 'presenterMedia', 'sheetConfig', 'startggConfig')
    `).all('rashinban') as { name: string; value: string }[];
    const result: Partial<ConfigSections> = {};
    for (const row of rows) {
      if (!SETTINGS_ROWS.includes(row.name as ConfigSection)) continue;
      const section = row.name as ConfigSection;
      try {
        const raw = JSON.parse(row.value) as unknown;
        Object.assign(result, { [section]: parseConfigSection(section, raw) });
      } catch {
        throw new Error(`Unable to read legacy ${section} row`);
      }
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unable to read legacy ')) throw error;
    throw new Error('Unable to read legacy configuration database');
  } finally {
    database?.close();
  }
}
