// Replicant shapes for the Google Sheet poller (shared by extension, dashboard, graphics).

export interface SheetConfig {
  enabled: boolean;
  /** Spreadsheet id from the URL (/spreadsheets/d/<id>/...). */
  sheetId: string;
  /** gid of the players tab (from #gid= in the URL). */
  playersGid: string;
  pollIntervalMs: number;
}

export interface SheetStatus {
  polling: boolean;
  lastFetchAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  playerCount: number;
  missingColumns: string[];
  skippedRows: number;
}

export interface PlayerCardsState {
  visible: boolean;
  page: "profile" | "stats";
}
