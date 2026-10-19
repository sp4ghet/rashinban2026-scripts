import type { ToggleLayer } from "../../broadcast/state.ts";
import { countdownText, defaultInterval, restoreInterval, upcomingMatches, type IntervalState } from "../../interval/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { startIntervalClock } from "../../interval/browser-clock.ts";
import { mustQuery, type Layer } from "./layer.ts";
import { mountKvBackground } from "./kv-background.ts";

import type { MatchState } from "../../match/state.ts";
import type { PlayerProfile } from "../../sheet/players.ts";

const ROTATING_SPONSORS = [
  ["geo_logo.svg", "GeoGuessr", "logo-geoguessr"],
  ["ajinomoto.gif", "味の素株式会社", ""],
  ["geoguessr-record.svg", "GeoGuessr Record", "logo-geoguessr-record"],
  ["chofu-hernia-clinic.svg", "調布駅前そけいヘルニアクリニック", "logo-chofu"],
  ["bfcc.png", "BFCC — Powered by バラジオ放送局", ""],
  ["kawaii-shisshi.svg", "かわいいしっしー", ""],
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
          <div class="interval-rule"></div>
          <div class="interval-matches"></div>
        </section>
        <section class="interval-timer" hidden>
          <div class="interval-countdown"><span data-fit></span></div>
        </section>
        <section class="interval-slides" aria-label="Interval slides">
          <img src="assets/interval-slides/${output === "led" ? "placeholder-led.svg" : "placeholder.svg"}" alt="RASHINBAN 2026 — slide placeholder" />
        </section>
        <section class="interval-sponsors" aria-label="Sponsors">
          <div class="interval-sponsor-lead"><img src="${sponsorPath}tamura-builds.svg" alt="TAMURA BUILDS" /></div>
          <div class="interval-sponsor-rotating">
            <img class="logo-geoguessr" src="${sponsorPath}geo_logo.svg" alt="GeoGuessr" />
          </div>
        </section>
        <div class="interval-bottombar"></div>
      </div>
    </section>`;

  const background = mountKvBackground(mustQuery(host, ".interval-screen"));
  const title = mustQuery(host, ".interval-title span");
  const upcoming = mustQuery(host, ".interval-upcoming");
  const upcomingTitle = mustQuery(host, ".interval-upcoming h2 span");
  const matches = mustQuery(host, ".interval-matches");
  const timer = mustQuery(host, ".interval-timer");
  const countdown = mustQuery(host, ".interval-countdown span");
  const sponsor = host.querySelector<HTMLImageElement>(".interval-sponsor-rotating img")!;
  // Match 2025 sponsors.js: every 12 seconds fade out for 300ms, swap while
  // invisible, then fade in at 600ms. Cache every image before its first turn.
  const sponsorImages = (output === "stream" ? ROTATING_SPONSORS : []).map(([file]) => {
    const image = new Image();
    image.src = sponsorPath + file;
    return image;
  });
  let sponsorIndex = 0;
  let swapTimeout: number | undefined;
  let fadeTimeout: number | undefined;
  const sponsorRotation = output === "stream" ? window.setInterval(() => {
    sponsor.style.opacity = "0";
    swapTimeout = window.setTimeout(() => {
      const nextIndex = (sponsorIndex + 1) % ROTATING_SPONSORS.length;
      const image = sponsorImages[nextIndex]!;
      if (!image.complete || image.naturalWidth === 0) return;
      sponsorIndex = nextIndex;
      const [, name, className] = ROTATING_SPONSORS[sponsorIndex]!;
      sponsor.className = className;
      sponsor.alt = name;
      sponsor.src = image.src;
    }, 300);
    fadeTimeout = window.setTimeout(() => { sponsor.style.opacity = "1"; }, 600);
  }, 12000) : undefined;
  let state = defaultInterval();
  let nextMatch: MatchState | null = null;
  let profiles: PlayerProfile[] = [];
  const clock = startIntervalClock();

  function fit() {
    if (host.hidden) return;
    matches.style.transform = "";
    for (const span of host.querySelectorAll<HTMLElement>("[data-fit]")) {
      span.style.transform = "";
      const width = span.parentElement!.clientWidth;
      const scale = span.scrollWidth > width ? width / span.scrollWidth : 1;
      span.style.transform = `scaleX(${scale})`;
    }
    // Keep the original name sizes unless fallback font metrics make the list
    // reach the countdown (or the bottom of the LED band).
    const list = matches.getBoundingClientRect();
    const boundary = output === "led" ? 560 : timer.hidden ? 931
      : timer.getBoundingClientRect().top;
    const available = Math.max(0, boundary - list.top - 12);
    if (list.height > available) matches.style.transform = `scale(${available / list.height})`;
  }

  function tick() {
    const now = clock.now();
    const value = now === null && state.timer.endsAtMs !== null ? "" : countdownText(state.timer, now ?? 0);
    timer.hidden = value === "";
    if (countdown.textContent !== value) {
      countdown.textContent = value;
      fit();
    }
  }

  function renderContent() {
    const upcomingList = upcomingMatches(state.content, nextMatch, profiles);
    title.textContent = state.content.title;
    upcomingTitle.textContent = state.content.upcomingLabel;
    upcoming.hidden = upcomingList.length === 0;
    matches.dataset.count = String(upcomingList.length);
    matches.replaceChildren(...upcomingList.map(match => {
      const row = document.createElement("div");
      row.className = "interval-match";
      // Only fixed markup goes through innerHTML. Dashboard text is always textContent.
      row.innerHTML = '<p class="interval-match-players"><span data-fit><span class="interval-player"></span> <span class="interval-versus">VS</span> <span class="interval-player"></span></span></p>';
      row.querySelectorAll<HTMLElement>(".interval-player").forEach((player, index) => {
        const name = index === 0 ? match.playerOne : match.playerTwo;
        player.textContent = name;
        player.classList.toggle("interval-player-jp", /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(name));
      });
      return row;
    }));
    tick();
    fit();
  }
  nodecg.Replicant<IntervalState>(REPLICANTS.interval).on("change", value => {
    state = restoreInterval(value);
    renderContent();
  });
  nodecg.Replicant<MatchState>(REPLICANTS.nextMatchState).on("change", value => {
    nextMatch = value ?? null;
    renderContent();
  });
  nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players).on("change", value => {
    profiles = value ?? [];
    renderContent();
  });
  const interval = window.setInterval(tick, 250);
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    window.clearInterval(interval);
    window.clearInterval(sponsorRotation);
    window.clearTimeout(swapTimeout);
    window.clearTimeout(fadeTimeout);
  });
  void document.fonts.ready.then(fit);
  document.fonts.addEventListener("loadingdone", fit);
  return { apply(layer) { host.hidden = !layer.visible; background.setVisible(layer.visible); tick(); fit(); } };
}
