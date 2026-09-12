import type { SheetConfig, SheetStatus } from "../sheet/types.ts";
import { REPLICANTS, SHEET_MESSAGES } from "../types/replicants.ts";
import { bindConfigurationControls } from './configuration-status.ts';

const sheet = nodecg.Replicant<SheetConfig>(REPLICANTS.sheetConfig);
const sheetStatus = nodecg.Replicant<SheetStatus>(REPLICANTS.sheetStatus);
const el = (id: string) => document.getElementById(id)!;
const input = (id: string) => el(id) as HTMLInputElement;
const configuration = bindConfigurationControls('sheetConfig', {
  status: 'configuration-status', reset: 'configuration-reset', importLocal: 'configuration-import', error: 'configuration-error',
}, () => applySheet(sheet.value));

async function send(name: string, value?: unknown) {
  try {
    await nodecg.sendMessage(name, value);
    el("error").textContent = "";
    return true;
  } catch (error) {
    el("error").textContent = (error as Error).message;
    return false;
  }
}
async function save(value: Record<string, unknown>) {
  configuration.draft.markDirty();
  if (await send(SHEET_MESSAGES.setConfig, { ...value, revision: configuration.draft.expectedRevision() })) configuration.saved();
}
function applySheet(v: SheetConfig | undefined) {
  if (!v) return;
  input("sheet-url").value = v.sheetId
    ? `https://docs.google.com/spreadsheets/d/${v.sheetId}/edit#gid=${v.playersGid}`
    : "";
  input("sheet-interval").value = String(v.pollIntervalMs / 1000);
  el("sheet-enabled").textContent = v.enabled ? "Polling ON" : "Polling OFF";
}
sheet.on("change", (v) => configuration.acceptProjection(() => applySheet(v)));
if (sheet.value) configuration.acceptProjection(() => applySheet(sheet.value));
input('sheet-url').addEventListener('input', () => configuration.draft.markDirty());
input('sheet-interval').addEventListener('input', () => configuration.draft.markDirty());
input("sheet-url").onchange = () =>
  save({ sheetUrl: input("sheet-url").value });
input("sheet-interval").onchange = () =>
  save({
    pollIntervalMs: Number(input("sheet-interval").value) * 1000,
  });
el("sheet-enabled").onclick = () =>
  save({ enabled: !sheet.value?.enabled });
el("sheet-refresh").onclick = () => send(SHEET_MESSAGES.refresh);
sheetStatus.on("change", (v) => {
  el("sheet-status").textContent = v
    ? `${v.playerCount} players · ${v.skippedRows} skipped rows${v.missingColumns.length ? " · Missing identity column: geoguessr_player_uid (or legacy startgg_tag)" : ""}${v.lastError ? "\n" + v.lastError : ""}`
    : "";
});
