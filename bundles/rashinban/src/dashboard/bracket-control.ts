import { withDefaults, type BracketConfig, type BracketFinals, type BracketSource } from "../bracket/finals";
import { BRACKET_MESSAGES, REPLICANTS } from "../types/replicants";

const config = nodecg.Replicant<BracketConfig>(REPLICANTS.bracketConfig);
const finals = nodecg.Replicant<BracketFinals>(REPLICANTS.bracketFinals);
const el = (id: string) => document.getElementById(id)!;
const source = el("source") as HTMLSelectElement;
const samplePath = el("sample-path") as HTMLInputElement;
const groupId = el("group-id") as HTMLInputElement;

async function send(message: string, value?: unknown) {
  try {
    await nodecg.sendMessage(message, value);
    el("error").textContent = "";
  } catch (error) {
    el("error").textContent = (error as Error).message;
  }
}

function showFields() {
  el("sample-row").hidden = source.value !== "sample";
  el("group-row").hidden = source.value !== "startgg";
}
source.addEventListener("change", showFields);

el("apply").onclick = () =>
  send(BRACKET_MESSAGES.setConfig, {
    source: source.value as BracketSource,
    samplePath: samplePath.value,
    groupId: groupId.value.trim() ? Number(groupId.value) : null,
  });
el("refresh").onclick = () => send(BRACKET_MESSAGES.refresh);

config.on("change", (value) => {
  const cfg = withDefaults(value);
  source.value = cfg.source;
  samplePath.value = cfg.samplePath;
  groupId.value = cfg.groupId === null ? "" : String(cfg.groupId);
  showFields();
});

finals.on("change", (value) => {
  if (!value) return;
  const from = `${value.source === "sample" ? "Sample" : "start.gg"} (group ${value.groupId ?? "?"})`;
  const at = value.updatedAt ? new Date(value.updatedAt).toLocaleTimeString() : "never";
  const status = el("status");
  status.textContent = value.error ? `${from}: ${value.error}` : `${from} · updated ${at}`;
  status.classList.toggle("error", Boolean(value.error));
  el("rows").textContent = value.rows
    .map((r) => {
      const score = r.topScore || r.bottomScore ? `${r.topScore}-${r.bottomScore}` : "vs";
      return `${String(r.match).padStart(2)}  ${r.top || "—"} ${score} ${r.bottom || "—"}${r.active ? "  ● on now" : ""}`;
    })
    .join("\n");
});
