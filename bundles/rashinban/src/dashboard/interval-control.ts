import { countdownText, defaultInterval, INTERVAL_MESSAGES, parseJstDateTime, restoreInterval, type IntervalContent, type IntervalState, type UpcomingMatch } from "../interval/state.ts";
import { REPLICANTS } from "../types/replicants.ts";
import { startIntervalClock } from "../interval/browser-clock.ts";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
let state = defaultInterval(), dirty = false, ready = false, busy = false, restartDefaulted = false;
const clock = startIntervalClock();
const rows: Record<keyof UpcomingMatch, HTMLInputElement>[] = [];
for (let index = 0; index < 4; index++) {
  const row = document.createElement("div");
  row.className = "match-row";
  const fields = {} as Record<keyof UpcomingMatch, HTMLInputElement>;
  for (const [key, label] of [["playerOne", "Player 1"], ["playerTwo", "Player 2"]] as const) {
    const field = document.createElement("input");
    field.maxLength = 60;
    field.setAttribute("aria-label", `Match ${index + 1} ${label}`);
    field.placeholder = index === 0 ? label : "";
    fields[key] = field;
    row.append(field);
  }
  rows.push(fields);
  el("matches").append(row);
}

function renderContent() {
  input("title").value = state.content.title;
  input("upcoming-label").value = state.content.upcomingLabel;
  rows.forEach((row, index) => {
    const match = state.content.matches[index];
    for (const key of ["playerOne", "playerTwo"] as const) row[key].value = match?.[key] ?? "";
  });
  dirty = false;
  el("draft-status").textContent = "Saved content";
}

function renderTimer() {
  const now = clock.now();
  const running = state.timer.endsAtMs !== null, paused = state.timer.remainingMs !== null;
  el("countdown").textContent = (now === null && running ? "" : countdownText(state.timer, now ?? 0)) || "—";
  el("timer-status").textContent = !ready ? "Connecting…" : paused ? "Paused" : running ?
    (now === null ? "Syncing clock…" : state.timer.endsAtMs! <= now ? "Finished" : "Running") : "Hidden";
  if (now !== null && !restartDefaulted) {
    if (!input("restart-at").value && document.activeElement !== input("restart-at")) {
      input("restart-at").value = new Date(now + 9 * 3600000 + 10 * 60000).toISOString().slice(0, 16);
    }
    restartDefaulted = true;
  }
  const pause = el<HTMLButtonElement>("pause");
  pause.textContent = paused ? "Resume" : "Pause";
  pause.disabled = busy || !ready || (!running && !paused);
  el<HTMLButtonElement>("clear").disabled = busy || !ready || (!running && !paused);
}

async function send(message: string, data: unknown) {
  if (!ready || busy) return;
  busy = true;
  el<HTMLFieldSetElement>("timer-controls").disabled = true;
  el<HTMLFieldSetElement>("content-controls").disabled = true;
  try {
    const saved = await nodecg.sendMessage(message, data);
    state = restoreInterval(saved);
    if (message === INTERVAL_MESSAGES.content) renderContent();
    el("error").textContent = "";
  } catch (error) {
    el("error").textContent = (error as { message?: string })?.message ?? String(error);
  } finally {
    busy = false;
    el<HTMLFieldSetElement>("timer-controls").disabled = !ready;
    el<HTMLFieldSetElement>("content-controls").disabled = !ready;
    renderTimer();
  }
}

el("content-form").addEventListener("input", () => { dirty = true; el("draft-status").textContent = "Unsaved changes"; });
el("content-form").addEventListener("submit", event => {
  event.preventDefault();
  const matches = rows.map(row => ({ playerOne: row.playerOne.value.trim(), playerTwo: row.playerTwo.value.trim() }))
    .filter(match => match.playerOne || match.playerTwo);
  const content: IntervalContent = { title: input("title").value, upcomingLabel: input("upcoming-label").value, matches };
  void send(INTERVAL_MESSAGES.content, content);
});
el("reload").onclick = renderContent;
el("start").onclick = () => { void send(INTERVAL_MESSAGES.timer, { action: "start", durationSeconds: Number(input("duration").value) * 60 }); };
el("pause").onclick = () => { void send(INTERVAL_MESSAGES.timer, { action: state.timer.remainingMs !== null ? "resume" : "pause" }); };
el("clear").onclick = () => { void send(INTERVAL_MESSAGES.timer, { action: "clear" }); };
el("schedule").onclick = () => {
  try {
    const endsAtMs = parseJstDateTime(input("restart-at").value);
    void send(INTERVAL_MESSAGES.timer, { action: "startAt", endsAtMs });
  } catch (error) { el("error").textContent = (error as Error).message; }
};
nodecg.Replicant<IntervalState>(REPLICANTS.interval).on("change", value => {
  if (!value) return;
  state = restoreInterval(value);
  ready = true;
  if (!dirty) renderContent();
  el<HTMLFieldSetElement>("timer-controls").disabled = busy;
  el<HTMLFieldSetElement>("content-controls").disabled = busy;
  renderTimer();
});
const tick = window.setInterval(renderTimer, 250);
window.addEventListener("pagehide", event => { if (!event.persisted) window.clearInterval(tick); });
