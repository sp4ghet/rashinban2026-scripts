// Google Sheet poller: fetches the players tab as CSV and publishes the
// parsed profiles. One poller for all overlays (2025 had every overlay
// polling on its own).
import type NodeCG from "@nodecg/types";

import { csvToObjects } from "../sheet/csv";
import { parsePlayers, type PlayerProfile } from "../sheet/players";
import type { SheetConfig, SheetStatus } from "../sheet/types";
import { REPLICANTS, SHEET_MESSAGES } from "../types/replicants";

const DEFAULT_CONFIG: SheetConfig = { enabled: false, sheetId: "1xozkRDAEeRLqVPzvpqqDFAcpC3vcbTrd9xekrQ28B50", playersGid: "0", pollIntervalMs: 15_000 };
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

export function registerSheet(nodecg: NodeCG.ServerAPI, router: ReturnType<NodeCG.ServerAPI["Router"]>) {
  const config = nodecg.Replicant<SheetConfig>(REPLICANTS.sheetConfig, { defaultValue: DEFAULT_CONFIG });
  const players = nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players, { defaultValue: [] });
  const status = nodecg.Replicant<SheetStatus>(REPLICANTS.sheetStatus, {
    defaultValue: { polling: false, lastFetchAt: null, lastSuccessAt: null, lastError: null, playerCount: 0, missingColumns: [], skippedRows: 0 },
    persistent: false,
  });
  const patch = (p: Partial<SheetStatus>) => {
    status.value = { ...status.value!, ...p };
  };

  async function fetchPlayers(cfg: SheetConfig): Promise<void> {
    if (!cfg.sheetId) throw new Error("sheetId is empty");
    const res = await fetch(csvExportUrl(cfg.sheetId, cfg.playersGid), { redirect: "follow" });
    if (!res.ok) throw new Error(`sheet export HTTP ${res.status} (is the sheet shared as "anyone with the link"?)`);
    const text = await res.text();
    if (text.trimStart().startsWith("<")) throw new Error("sheet export returned HTML, not CSV (check sharing and gid)");
    const parsed = parsePlayers(csvToObjects(text));
    players.value = parsed.players;
    patch({ playerCount: parsed.players.length, missingColumns: parsed.missingColumns, skippedRows: parsed.skippedRows });
  }

  let inFlight: Promise<boolean> | null = null;
  function refresh(): Promise<boolean> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      patch({ lastFetchAt: Date.now() });
      try {
        await fetchPlayers(config.value ?? DEFAULT_CONFIG);
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
    const changed = !prev || next.enabled !== prev.enabled || next.sheetId !== prev.sheetId || next.playersGid !== prev.playersGid || next.pollIntervalMs !== prev.pollIntervalMs;
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

  nodecg.listenFor(SHEET_MESSAGES.setConfig, (data: Partial<SheetConfig> & { sheetUrl?: string }, ack) => {
    const cur = config.value ?? DEFAULT_CONFIG;
    let sheetId = typeof data?.sheetId === "string" ? data.sheetId.trim() : cur.sheetId;
    let playersGid = typeof data?.playersGid === "string" ? data.playersGid.trim() : cur.playersGid;
    if (typeof data?.sheetUrl === "string" && data.sheetUrl.trim()) {
      const ref = parseSheetRef(data.sheetUrl);
      sheetId = ref.sheetId;
      if (ref.gid) playersGid = ref.gid;
    }
    config.value = {
      enabled: typeof data?.enabled === "boolean" ? data.enabled : cur.enabled,
      sheetId,
      playersGid: playersGid || "0",
      pollIntervalMs:
        typeof data?.pollIntervalMs === "number" && Number.isFinite(data.pollIntervalMs)
          ? Math.max(MIN_POLL_MS, Math.round(data.pollIntervalMs))
          : cur.pollIntervalMs,
    };
    if (ack && !ack.handled) ack(null, config.value);
  });

  router.post("/sheet/refresh", async (_req, res) => {
    const ok = await refresh();
    res.status(ok ? 200 : 502).json(status.value);
  });

  schedule();
}
