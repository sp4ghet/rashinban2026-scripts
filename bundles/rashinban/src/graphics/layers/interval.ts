import type { ToggleLayer } from "../../broadcast/state.ts";
import { countdownText, defaultInterval, restoreInterval, type IntervalState } from "../../interval/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { startIntervalClock } from "../../interval/browser-clock.ts";
import { mustQuery, type Layer } from "./layer.ts";

const SPONSOR_GROUPS = [
  [["geo_logo.svg", "GeoGuessr"], ["ajinomoto.gif", "味の素株式会社"]],
  [["geoguessr-record.svg", "GeoGuessr Record"], ["chofu-hernia-clinic.svg", "調布駅前そけいヘルニアクリニック"]],
  [["bfcc.png", "BFCC — Powered by バラジオ放送局"], ["kawaii-shisshi.svg", "かわいいしっしー"]],
] as const;
const sponsorPath = "assets/interval-sponsors/";

/** One shared renderer for standalone sources and the switcher info pages. */
export function mountInterval(host: HTMLElement, output: "stream" | "led"): Layer<ToggleLayer> {
  host.hidden = true;
  host.innerHTML = `
    <section class="interval-output" data-layout="${output}">
      <div class="interval-screen">
        <div class="interval-topbar"></div>
        <img class="interval-icon" src="assets/images/icon.svg" alt="" />
        <h1 class="interval-title"><span data-fit></span></h1>
        <section class="interval-upcoming">
          <h2><span data-fit></span></h2>
          <div class="interval-matches"></div>
        </section>
        <section class="interval-timer" hidden>
          <div class="interval-countdown-label"><span data-fit></span></div>
          <div class="interval-countdown"><span data-fit></span></div>
        </section>
        <section class="interval-slides" aria-label="Interval slides">
          <img src="assets/interval-slides/placeholder.svg" alt="RASHINBAN 2026 — slide placeholder" />
        </section>
        <section class="interval-sponsors" aria-label="Sponsors">
          <div class="interval-sponsor-lead"><img src="${sponsorPath}tamura-builds.svg" alt="TAMURA BUILDS" /></div>
          <div class="interval-sponsor-groups">${SPONSOR_GROUPS.map((group, index) => `
            <div class="interval-sponsor-group" data-sponsor-group="${index}"${index ? " hidden" : ""}>
              ${group.map(([file, name]) => `<img src="${sponsorPath}${file}" alt="${name}" />`).join("")}
            </div>`).join("")}
          </div>
        </section>
        <div class="interval-bottombar"></div>
      </div>
    </section>`;

  const title = mustQuery(host, ".interval-title span");
  const upcoming = mustQuery(host, ".interval-upcoming");
  const upcomingTitle = mustQuery(host, ".interval-upcoming h2 span");
  const matches = mustQuery(host, ".interval-matches");
  const timer = mustQuery(host, ".interval-timer");
  const label = mustQuery(host, ".interval-countdown-label span");
  const countdown = mustQuery(host, ".interval-countdown span");
  const groups = [...host.querySelectorAll<HTMLElement>("[data-sponsor-group]")];
  let state = defaultInterval();
  const clock = startIntervalClock();

  function fit() {
    if (host.hidden) return;
    for (const span of host.querySelectorAll<HTMLElement>("[data-fit]")) {
      span.style.transform = "";
      const width = span.parentElement!.clientWidth;
      const scale = span.scrollWidth > width ? width / span.scrollWidth : 1;
      span.style.transform = `scaleX(${scale})`;
    }
  }

  function tick() {
    const now = clock.now();
    const value = now === null && state.timer.endsAtMs !== null ? "" : countdownText(state.timer, now ?? 0);
    timer.hidden = value === "";
    if (countdown.textContent !== value) {
      countdown.textContent = value;
      fit();
    }
    const group = Math.floor((now ?? 0) / 10000) % groups.length;
    groups.forEach((element, index) => { element.hidden = index !== group; });
  }

  nodecg.Replicant<IntervalState>(REPLICANTS.interval).on("change", value => {
    state = restoreInterval(value);
    title.textContent = state.content.title;
    upcomingTitle.textContent = state.content.upcomingLabel;
    label.textContent = state.content.countdownLabel;
    upcoming.hidden = state.content.matches.length === 0;
    matches.dataset.count = String(state.content.matches.length);
    matches.replaceChildren(...state.content.matches.map(match => {
      const row = document.createElement("div");
      row.className = "interval-match";
      // Only fixed markup goes through innerHTML. Dashboard text is always textContent.
      row.innerHTML = '<div class="interval-match-label"><span data-fit></span></div><div class="interval-match-players"><div><span data-fit></span></div><b>VS</b><div><span data-fit></span></div></div>';
      const spans = row.querySelectorAll("span");
      spans[0]!.textContent = match.label;
      spans[1]!.textContent = match.playerOne;
      spans[2]!.textContent = match.playerTwo;
      return row;
    }));
    tick();
    fit();
  });
  const interval = window.setInterval(tick, 250);
  window.addEventListener("pagehide", event => { if (!event.persisted) window.clearInterval(interval); });
  void document.fonts.ready.then(fit);
  document.fonts.addEventListener("loadingdone", fit);
  return { apply(layer) { host.hidden = !layer.visible; tick(); fit(); } };
}
