// Google Sheet poller: fetches the players tab as CSV and publishes the
// parsed profiles. One poller for all overlays (2025 had every overlay
// polling on its own).
import type NodeCG from "@nodecg/types";

import { parseCasters, type Caster } from "../casters/casters.ts";
import { csvToObjects } from "../sheet/csv.ts";
import { parsePlayers, type PlayerProfile } from "../sheet/players.ts";
import type { SheetConfig, SheetStatus } from "../sheet/types.ts";
import { REPLICANTS, SHEET_MESSAGES } from "../types/replicants.ts";
import type { ConfigStore } from '../config/types.ts';
import { DEFAULT_SHEET_CONFIG } from '../config/schema.ts';

const DEFAULT_CONFIG = DEFAULT_SHEET_CONFIG;
const MIN_POLL_MS = 5_000;

/** Google export URL for a sheet id, or the id itself when it is already a full CSV URL (local tests, Apps Script endpoints). */
export function csvExportUrl(sheetId: string, gid: string): string {
  if (/^https?:\/\//.test(sheetId)) return sheetId;
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

/** Accepts a full sheet URL or a bare id; returns { sheetId, gid|null }. */
export function parseSheetRef(input: string): { sheetId: string; gid: string | null } {
  const s = input.trim();
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(s);
  const gid = /[#&?]gid=(\d+)/.exec(s)?.[1] ?? null;
  // A non-Google URL is used verbatim as the CSV source.
  return { sheetId: m?.[1] ?? s, gid };
}

export function registerSheet(nodecg: NodeCG.ServerAPI, router: ReturnType<NodeCG.ServerAPI["Router"]>, store?: ConfigStore) {
  const config = nodecg.Replicant<SheetConfig>(REPLICANTS.sheetConfig, { defaultValue: store ? structuredClone(store.get().sheet) : DEFAULT_CONFIG, persistent: store ? false : true });
  const players = nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players, { defaultValue: [] });
  const casters = nodecg.Replicant<Caster[]>(REPLICANTS.casters, { defaultValue: [] });
  const playersEn = nodecg.Replicant<PlayerProfile[]>(REPLICANTS.playersEn, { defaultValue: [] });
  const castersEn = nodecg.Replicant<Caster[]>(REPLICANTS.castersEn, { defaultValue: [] });
  const status = nodecg.Replicant<SheetStatus>(REPLICANTS.sheetStatus, {
    defaultValue: { polling: false, lastFetchAt: null, lastSuccessAt: null, lastError: null, playerCount: 0, casterCount: 0, missingColumns: [], skippedRows: 0 },
    persistent: false,
  });
  const patch = (p: Partial<SheetStatus>) => {
    status.value = { ...status.value!, ...p };
  };

  async function fetchTab(cfg: SheetConfig, gid: string): Promise<Record<string, string>[]> {
    const res = await fetch(csvExportUrl(cfg.sheetId, gid), { redirect: "follow" });
    if (!res.ok) throw new Error(`sheet export HTTP ${res.status} (is the sheet shared as "anyone with the link"?)`);
    const text = await res.text();
    if (text.trimStart().startsWith("<")) throw new Error("sheet export returned HTML, not CSV (check sharing and gid)");
    return csvToObjects(text);
  }

  async function fetchSheet(cfg: SheetConfig): Promise<void> {
    if (!cfg.sheetId) throw new Error("sheetId is empty");
    const tasks: [string, () => Promise<void>][] = [["players", async () => {
      const parsed = parsePlayers(await fetchTab(cfg, cfg.playersGid));
      if (parsed.missingColumns.length) throw new Error("missing player identity columns");
      players.value = parsed.players;
      patch({ playerCount: parsed.players.length, missingColumns: parsed.missingColumns, skippedRows: parsed.skippedRows });
    }]];
    // A direct CSV URL is one tab, used by local previews.
    if (!/^https?:\/\//.test(cfg.sheetId)) {
      tasks.push(["casters", async () => {
        const value = cfg.castersGid ? parseCasters(await fetchTab(cfg, cfg.castersGid)) : [];
        casters.value = value;
        patch({ casterCount: value.length });
      }], ["players_en", async () => {
        const gid = cfg.playersEnGid ?? DEFAULT_CONFIG.playersEnGid!;
        const parsed = gid ? parsePlayers(await fetchTab(cfg, gid)) : { players: [], missingColumns: [] };
        if (parsed.missingColumns.length) throw new Error("missing player identity columns");
        playersEn.value = parsed.players;
        patch({ playersEnCount: parsed.players.length });
      }], ["casters_en", async () => {
        const gid = cfg.castersEnGid ?? DEFAULT_CONFIG.castersEnGid!;
        const value = gid ? parseCasters(await fetchTab(cfg, gid)) : [];
        castersEn.value = value;
        patch({ castersEnCount: value.length });
      }]);
    }
    // Each tab publishes independently and retains its last good value on failure.
    const results = await Promise.allSettled(tasks.map(([, run]) => run()));
    const errors = results.flatMap((result, index) => result.status === "rejected"
      ? [`${tasks[index]![0]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
    if (errors.length) throw new Error(errors.join("; "));
  }

  let inFlight: Promise<boolean> | null = null;
  function refresh(): Promise<boolean> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      patch({ lastFetchAt: Date.now() });
      try {
        await fetchSheet(config.value ?? DEFAULT_CONFIG);
        patch({ lastSuccessAt: Date.now(), lastError: null });
        return true;
      } catch (err) {
        const message = (err as Error).message;
        nodecg.log.warn(`sheet: ${message}`);
        patch({ lastError: message });
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  let timer: NodeJS.Timeout | null = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    const cfg = config.value ?? DEFAULT_CONFIG;
    if (!cfg.enabled) {
      patch({ polling: false });
      return;
    }
    patch({ polling: true });
    timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, Math.max(MIN_POLL_MS, cfg.pollIntervalMs));
  }

  config.on("change", (next, prev) => {
    if (!next) return;
    const changed = !prev || next.enabled !== prev.enabled || next.sheetId !== prev.sheetId || next.playersGid !== prev.playersGid || next.castersGid !== prev.castersGid || next.playersEnGid !== prev.playersEnGid || next.castersEnGid !== prev.castersEnGid || next.pollIntervalMs !== prev.pollIntervalMs;
    if (!changed) return;
    if (next.enabled) {
      patch({ polling: true });
      void refresh().then(schedule);
    } else {
      schedule();
    }
  });

  nodecg.listenFor(SHEET_MESSAGES.refresh, async (_data, ack) => {
    const ok = await refresh();
    if (ack && !ack.handled) ok ? ack(null, status.value) : ack(new Error(status.value?.lastError ?? "refresh failed"));
  });

  nodecg.listenFor(SHEET_MESSAGES.setConfig, (data: Partial<SheetConfig> & { sheetUrl?: string; castersUrl?: string; revision?: string }, ack) => {
    const cur = config.value ?? DEFAULT_CONFIG;
    let sheetId = typeof data?.sheetId === "string" ? data.sheetId.trim() : cur.sheetId;
    let playersGid = typeof data?.playersGid === "string" ? data.playersGid.trim() : cur.playersGid;
    let castersGid = typeof data?.castersGid === "string" ? data.castersGid.trim() : cur.castersGid;
    if (typeof data?.castersUrl === "string") {
      // Both tabs share one spreadsheet, so only the gid is taken from this URL.
      // Clearing the field empties castersGid, which skips the casters fetch.
      const trimmed = data.castersUrl.trim();
      castersGid = trimmed ? (parseSheetRef(trimmed).gid ?? castersGid) : "";
    }
    if (typeof data?.sheetUrl === "string" && data.sheetUrl.trim()) {
      const ref = parseSheetRef(data.sheetUrl);
      sheetId = ref.sheetId;
      if (ref.gid) playersGid = ref.gid;
    }
    const next = {
      enabled: typeof data?.enabled === "boolean" ? data.enabled : cur.enabled,
      sheetId,
      playersGid: playersGid || "0",
      castersGid,
      playersEnGid: typeof data?.playersEnGid === "string" ? data.playersEnGid.trim() : cur.playersEnGid ?? DEFAULT_CONFIG.playersEnGid,
      castersEnGid: typeof data?.castersEnGid === "string" ? data.castersEnGid.trim() : cur.castersEnGid ?? DEFAULT_CONFIG.castersEnGid,
      pollIntervalMs:
        typeof data?.pollIntervalMs === "number" && Number.isFinite(data.pollIntervalMs)
          ? Math.max(MIN_POLL_MS, Math.round(data.pollIntervalMs))
          : cur.pollIntervalMs,
    };
    try {
      if (store) store.save('sheetConfig', next, data?.revision);
      else config.value = next;
      if (ack && !ack.handled) ack(null, store?.get().sheet ?? config.value);
    } catch (error) {
      if (ack && !ack.handled) ack(error instanceof Error ? error : new Error('Unable to save sheet configuration'));
    }
  });

  router.post("/sheet/refresh", async (_req, res) => {
    const ok = await refresh();
    res.status(ok ? 200 : 502).json(status.value);
  });

  schedule();
}
