import { countdownText, defaultInterval, INTERVAL_MESSAGES, restoreInterval, type IntervalState } from "../../interval/state.ts";
import { startIntervalClock } from "../../interval/browser-clock.ts";
import { REPLICANTS } from "../../types/replicants.ts";

/** Compact live timer controls; scene visibility still belongs to Preview/TAKE. */
export function mountIntervalTimer(host: HTMLElement, reportError: (message: string) => void, english = false): void {
  const controls = document.createElement("fieldset");
  controls.id = "interval-timer-controls";
  controls.className = "interval-timer-controls";
  controls.disabled = true;
  controls.setAttribute("aria-label", "Live interval timer");
  controls.title = english ? "Timer changes apply live to English only." : "Timer changes apply live to Stream and LED.";
  controls.innerHTML = `
    <label>Minutes <input id="interval-minutes" type="number" min="1" max="1440" step="1" value="10" /></label>
    <button id="interval-start" type="button">Start</button>
    <button id="interval-pause" type="button">Pause</button>
    <button id="interval-clear" type="button">Clear</button>
    <output id="interval-countdown" aria-label="Time remaining">—</output>
    <span id="interval-timer-status">Connecting…</span>`;
  host.append(controls);
  const minutes = controls.querySelector<HTMLInputElement>("#interval-minutes")!;
  const pause = controls.querySelector<HTMLButtonElement>("#interval-pause")!;
  const clear = controls.querySelector<HTMLButtonElement>("#interval-clear")!;
  const countdown = controls.querySelector<HTMLOutputElement>("#interval-countdown")!;
  const status = controls.querySelector<HTMLElement>("#interval-timer-status")!;
  const clock = startIntervalClock();
  let state = defaultInterval(), ready = false, busy = false;

  function render() {
    const now = clock.now();
    const running = state.timer.endsAtMs !== null, paused = state.timer.remainingMs !== null;
    controls.disabled = !ready || busy;
    pause.textContent = paused ? "Resume" : "Pause";
    pause.disabled = clear.disabled = !running && !paused;
    countdown.textContent = (now === null && running ? "" : countdownText(state.timer, now ?? 0)) || "—";
    status.textContent = !ready ? "Connecting…" : paused ? "Paused" : running ?
      (now === null ? "Syncing clock…" : state.timer.endsAtMs! <= now ? "Finished" : "Running") : "Hidden";
  }

  async function send(command: unknown) {
    if (!ready || busy) return;
    busy = true;
    render();
    try {
      state = restoreInterval(await nodecg.sendMessage(english ? INTERVAL_MESSAGES.timerEn : INTERVAL_MESSAGES.timer, command));
      reportError("");
    } catch (error) {
      reportError((error as { message?: string })?.message ?? String(error));
    } finally {
      busy = false;
      render();
    }
  }
  controls.querySelector<HTMLButtonElement>("#interval-start")!.onclick = () => {
    void send({ action: "start", durationSeconds: minutes.valueAsNumber * 60 });
  };
  pause.onclick = () => { void send({ action: state.timer.remainingMs !== null ? "resume" : "pause" }); };
  clear.onclick = () => { void send({ action: "clear" }); };
  nodecg.Replicant<IntervalState>(english ? REPLICANTS.intervalEn : REPLICANTS.interval).on("change", value => {
    ready = Boolean(value);
    state = restoreInterval(value);
    render();
  });
  render();
  const tick = window.setInterval(render, 250);
  window.addEventListener("pagehide", event => { if (!event.persisted) window.clearInterval(tick); });
}
