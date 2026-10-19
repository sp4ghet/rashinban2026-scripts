import { countdownText, defaultInterval, INTERVAL_MESSAGES, restoreInterval, upcomingMatches, type IntervalContent, type IntervalState, type UpcomingMatch } from "../interval/state.ts";
import { REPLICANTS } from "../types/replicants.ts";
import { startIntervalClock } from "../interval/browser-clock.ts";

import type { MatchState } from "../match/state.ts";
import type { PlayerProfile } from "../sheet/players.ts";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
let state = defaultInterval(), dirty = false, ready = false, busy = false, restartDefaulted = false;
let nextMatch: MatchState | null = null;
let profiles: PlayerProfile[] = [];
const source = el<HTMLSelectElement>("match-source");
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

function renderMatchSource() {
  const automatic = source.value === "next";
  el("manual-matches").hidden = automatic;
  el("next-match-preview").hidden = !automatic;
  el("next-match-help").hidden = !automatic;
  const match = upcomingMatches({ ...state.content, matchSource: "next" }, nextMatch, profiles)[0];
  el("next-match-preview").textContent = match ? `${match.playerOne} vs ${match.playerTwo}`
    : "No complete Next Match saved. Upcoming matches will be hidden.";
}

function renderContent() {
  source.value = state.content.matchSource;
  input("title").value = state.content.title;
  input("upcoming-label").value = state.content.upcomingLabel;
  rows.forEach((row, index) => {
    const match = state.content.matches[index];
    for (const key of ["playerOne", "playerTwo"] as const) row[key].value = match?.[key] ?? "";
  });
  renderMatchSource();
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
      input("restart-at").value = new Date(now + 9 * 3600000 + 10 * 60000).toISOString().slice(11, 16);
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
source.addEventListener("change", () => {
  dirty = true;
  el("draft-status").textContent = "Unsaved changes";
  renderMatchSource();
});
el("content-form").addEventListener("submit", event => {
  event.preventDefault();
  const matchSource = source.value === "next" ? "next" : "manual";
  const matches = matchSource === "next" ? state.content.matches : rows.map(row => ({ playerOne: row.playerOne.value.trim(), playerTwo: row.playerTwo.value.trim() }))
    .filter(match => match.playerOne || match.playerTwo);
  const content: IntervalContent = { title: input("title").value, upcomingLabel: input("upcoming-label").value, matchSource, matches };
  void send(INTERVAL_MESSAGES.content, content);
});
el("reload").onclick = renderContent;
el("start").onclick = () => { void send(INTERVAL_MESSAGES.timer, { action: "start", durationSeconds: Number(input("duration").value) * 60 }); };
el("pause").onclick = () => { void send(INTERVAL_MESSAGES.timer, { action: state.timer.remainingMs !== null ? "resume" : "pause" }); };
el("clear").onclick = () => { void send(INTERVAL_MESSAGES.timer, { action: "clear" }); };
el("schedule").onclick = () => {
  void send(INTERVAL_MESSAGES.timer, { action: "startAtTime", time: input("restart-at").value });
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
nodecg.Replicant<MatchState>(REPLICANTS.nextMatchState).on("change", value => {
  nextMatch = value ?? null;
  renderMatchSource();
});
nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players).on("change", value => {
  profiles = value ?? [];
  renderMatchSource();
});
const tick = window.setInterval(renderTimer, 250);
window.addEventListener("pagehide", event => { if (!event.persisted) window.clearInterval(tick); });
