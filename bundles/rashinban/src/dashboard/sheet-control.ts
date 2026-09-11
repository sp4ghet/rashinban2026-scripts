import type { SheetConfig, SheetStatus } from "../sheet/types.ts";
import { REPLICANTS, SHEET_MESSAGES } from "../types/replicants.ts";

const sheet = nodecg.Replicant<SheetConfig>(REPLICANTS.sheetConfig);
const sheetStatus = nodecg.Replicant<SheetStatus>(REPLICANTS.sheetStatus);
const el = (id: string) => document.getElementById(id)!;
const input = (id: string) => el(id) as HTMLInputElement;

async function send(name: string, value?: unknown) {
  try {
    await nodecg.sendMessage(name, value);
    el("error").textContent = "";
  } catch (error) {
    el("error").textContent = (error as Error).message;
  }
}
sheet.on("change", (v) => {
  if (!v) return;
  input("sheet-url").value = v.sheetId
    ? `https://docs.google.com/spreadsheets/d/${v.sheetId}/edit#gid=${v.playersGid}`
    : "";
  input("sheet-interval").value = String(v.pollIntervalMs / 1000);
  el("sheet-enabled").textContent = v.enabled ? "Polling ON" : "Polling OFF";
});
input("sheet-url").onchange = () =>
  send(SHEET_MESSAGES.setConfig, { sheetUrl: input("sheet-url").value });
input("sheet-interval").onchange = () =>
  send(SHEET_MESSAGES.setConfig, {
    pollIntervalMs: Number(input("sheet-interval").value) * 1000,
  });
el("sheet-enabled").onclick = () =>
  send(SHEET_MESSAGES.setConfig, { enabled: !sheet.value?.enabled });
el("sheet-refresh").onclick = () => send(SHEET_MESSAGES.refresh);
sheetStatus.on("change", (v) => {
  el("sheet-status").textContent = v
    ? `${v.playerCount} players · ${v.skippedRows} skipped rows${v.missingColumns.length ? " · Missing identity column: geoguessr_player_uid (or legacy startgg_tag)" : ""}${v.lastError ? "\n" + v.lastError : ""}`
    : "";
});
