// Replicant shapes for the Google Sheet poller (shared by extension, dashboard, graphics).

export interface SheetConfig {
  enabled: boolean;
  /** Spreadsheet id from the URL (/spreadsheets/d/<id>/...). */
  sheetId: string;
  /** gid of the players tab (from #gid= in the URL). */
  playersGid: string;
  /** gid of the casters tab. Empty disables the casters fetch. */
  castersGid: string;
  /** English profile/caster tab gids. Empty disables a tab; absent uses defaults. */
  playersEnGid?: string;
  castersEnGid?: string;
  pollIntervalMs: number;
}

export interface SheetStatus {
  polling: boolean;
  lastFetchAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  playerCount: number;
  casterCount: number;
  playersEnCount?: number;
  castersEnCount?: number;
  missingColumns: string[];
  skippedRows: number;
}
