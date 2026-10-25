import { defaultLayers, type PlayerInfoLayer } from '../../broadcast/state.ts';
import { playerInfoPlayers, playerInfoPhoto, playerInfoResults, type InfoAsset, type InfoRecord } from '../../broadcast/player-info.ts';
import { normalizeTag, type PlayerProfile } from '../../sheet/players.ts';
import type { StartggBracket } from '../../startgg/types.ts';
import { matchProfile } from '../../match/identity.ts';
import { REPLICANTS } from '../../types/replicants.ts';
import { mustQuery, type Layer } from './layer.ts';

export function mountPlayerInfo(host: HTMLElement, english = false): Layer<PlayerInfoLayer> {
  host.innerHTML = `<div class="player-info">
    <img class="pi-photo" alt="" />
    <div class="pi-content">
      <div class="pi-header"><span class="pi-name" data-fit></span><span class="pi-handle" data-fit></span></div>
      <section class="pi-results">
        <div class="pi-placement" data-fit></div>
        <div class="pi-results-body">
          <div class="pi-records">
            <div><span class="pi-label">MATCH COUNT</span><div class="pi-record pi-sets"></div></div>
            <div><span class="pi-label">GAME COUNT</span><div class="pi-record pi-games"></div></div>
          </div>
          <div class="pi-day"><span class="pi-label">DAY 1</span></div>
          <div class="pi-day-results"><div class="pi-matches"></div><div class="pi-empty"></div></div>
          <div class="pi-highlights" hidden><span class="pi-label">CAREER HIGHLIGHTS</span><div class="pi-highlights-text" data-fit></div></div>
        </div>
      </section>
      <section class="pi-profile">
        <div class="pi-profile-body">
          <div class="pi-numbers"><span class="pi-label">AGE</span><span class="pi-age" data-fit></span><span class="pi-label">RATING</span><span class="pi-rating" data-fit></span></div>
          <div class="pi-field pi-mode"><span class="pi-label">FAVORITE GAME MODE</span><div class="pi-value" data-fit></div></div>
          <div class="pi-field pi-strengths"><span class="pi-label">STRENGTHS</span><div class="pi-value" data-fit></div></div>
          <div class="pi-field pi-food"><span class="pi-label">FAVORITE FOOD</span><div class="pi-value" data-fit></div></div>
          <div class="pi-field pi-message"><span class="pi-label">MESSAGE</span><div class="pi-value" data-fit></div></div>
        </div>
      </section>
    </div>
  </div>`;
  const root = mustQuery(host, '.player-info');
  const photo = host.querySelector<HTMLImageElement>('.pi-photo')!;
  let profiles: PlayerProfile[] = [], translations: PlayerProfile[] = [], assets: InfoAsset[] = [];
  let bracket: StartggBracket | null = null;
  let layer = defaultLayers(english ? 'en' : 'stream').playerInfo;
  let photoUrl: string | null = null, photoReady = false, request = 0;
  const text = (selector: string, value: string) => { mustQuery(host, selector).textContent = value; };
  const visible = () => { host.hidden = !layer.visible || !photoReady; };
  function fit() {
    if (host.hidden) return;
    const fields = Array.from(host.querySelectorAll<HTMLElement>('[data-fit]')).filter(el => el.getClientRects().length);
    // Flex siblings share available height. Reset the whole page before fitting
    // any field so repeated sheet/bus refreshes always use the same baseline.
    for (const el of fields) el.style.removeProperty('font-size');
    for (const el of fields) {
      let size = parseFloat(getComputedStyle(el).fontSize);
      const minimum = el.classList.contains('pi-highlights-text') && root.dataset.compactHighlights === 'true' ? 24 : 20;
      while ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && size > minimum) {
        size -= 1; el.style.fontSize = `${size}px`;
      }
    }
  }
  function showPhoto(url: string | null) {
    if (url === photoUrl) { visible(); return; }
    photoUrl = url; photoReady = false; const version = ++request;
    visible(); photo.removeAttribute('src');
    host.dataset.status = url ? 'loading' : 'missing-photo';
    if (!url) return;
    photo.src = url;
    void photo.decode().then(() => {
      if (request !== version) return;
      photoReady = true; host.dataset.status = 'ready'; visible(); fit();
    }).catch(() => { if (request === version) { host.dataset.status = 'photo-error'; photoReady = false; visible(); } });
  }
  function renderRecord(selector: string, value: InfoRecord | null) {
    const el = mustQuery(host, selector);
    el.replaceChildren();
    const count = document.createElement('span'), percent = document.createElement('small');
    count.textContent = value ? `${value.wins}-${value.losses}` : '—';
    percent.textContent = value ? ` (${value.percent})` : '';
    el.append(count, percent);
  }
  function render() {
    const players = playerInfoPlayers(profiles, bracket, english ? translations : []);
    const player = layer.playerId ? players.find(p => p.id === layer.playerId) : players[0];
    root.dataset.page = layer.page;
    host.dataset.player = player?.id ?? '';
    if (!player) { showPhoto(null); host.dataset.status = 'missing-player'; return; }
    const profile = player.profile;
    const highlights = profile?.extra?.major_tournament?.trim() || player.source?.extra?.major_tournament?.trim() || '';
    root.dataset.highlights = String(Boolean(highlights));
    root.dataset.compactHighlights = String(normalizeTag(player.tag) === 'nowlo');
    mustQuery(host, '.pi-highlights').hidden = !highlights;
    text('.pi-highlights-text', highlights);
    text('.pi-name', player.name);
    text('.pi-handle', player.handle ? '@' + player.handle.replace(/^@/, '') : '');
    text('.pi-age', profile?.age || '—'); text('.pi-rating', profile?.rating || '—');
    for (const [field, value] of [['mode', profile?.favoriteMode], ['strengths', profile?.strengths], ['food', profile?.favoriteFood], ['message', profile?.message]]) {
      text(`.pi-${field} .pi-value`, value || '—');
    }
    const localized = profiles.map(p => english ? matchProfile(translations, {
      uid: p.geoguessrPlayerUid, entrantId: p.startggEntrantId, tag: p.startggTag, name: p.name,
    }).profile ?? p : p).map((p, i) => ({ ...p, startggEntrantId: profiles[i]!.startggEntrantId, startggTag: profiles[i]!.startggTag }));
    const results = playerInfoResults(bracket, player.entrantId, localized);
    text('.pi-placement', results.placement);
    renderRecord('.pi-sets', results.setRecord); renderRecord('.pi-games', results.gameRecord);
    const list = mustQuery(host, '.pi-matches');
    list.style.setProperty('--rows', String(Math.max(4, Math.ceil(results.rows.length / 2))));
    list.replaceChildren(...results.rows.map(result => {
      const row = document.createElement('div'); row.className = 'pi-match';
      for (const [className, value] of [['pi-versus', 'VS'], ['pi-opponent', result.opponent], ['pi-score', result.score]]) {
        const span = document.createElement('span'); span.className = className!;
        span.dataset.fit = ''; span.textContent = value!; row.append(span);
      }
      return row;
    }));
    text('.pi-empty', { ready: '', empty: 'No recorded Day 1 results', unavailable: 'Day 1 results unavailable', unlinked: 'No tournament results linked' }[results.status]);
    showPhoto(playerInfoPhoto(player, layer.page, assets)); fit();
  }
  nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players).on('change', value => { profiles = value ?? []; render(); });
  if (english) nodecg.Replicant<PlayerProfile[]>(REPLICANTS.playersEn).on('change', value => { translations = value ?? []; render(); });
  nodecg.Replicant<StartggBracket | null>(REPLICANTS.startggBracket).on('change', value => { bracket = value ?? null; render(); });
  nodecg.Replicant<InfoAsset[]>('assets:player-info').on('change', value => { assets = value ?? []; render(); });
  document.fonts.ready.then(fit); document.fonts.addEventListener('loadingdone', fit);
  render();
  return { apply(next) { layer = next; render(); } };
}
