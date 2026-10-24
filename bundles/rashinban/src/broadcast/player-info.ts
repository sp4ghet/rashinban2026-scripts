import { normalizeTag, type PlayerProfile } from '../sheet/players.ts';
import type { StartggBracket } from '../startgg/types.ts';
import { matchProfile } from '../match/identity.ts';
import type { PlayerInfoLayer } from './state.ts';

export type InfoPlayer = {
  id: string; name: string; handle: string; entrantId: number | null;
  profile: PlayerProfile | null; source: PlayerProfile | null; tag: string; top8: boolean;
  photoKeys: string[];
};
export type InfoAsset = { base?: string; url?: string; sum?: string };
export type InfoRecord = { wins: number; losses: number; percent: string };
export type InfoResults = {
  placement: string; setRecord: InfoRecord | null; gameRecord: InfoRecord | null;
  rows: { id: number; opponent: string; score: string }[];
  status: 'ready' | 'unavailable' | 'unlinked' | 'empty';
};

function phases(bracket: StartggBracket | null) {
  const ordered = [...(bracket?.phases ?? [])].sort((a, b) => a.order - b.order);
  const day1 = ordered.find(p => /DAY\s*1/i.test(p.name.normalize('NFKC'))) ?? (ordered.length > 1 ? ordered[0] : undefined);
  const day2 = ordered.find(p => /DAY\s*2/i.test(p.name.normalize('NFKC'))) ?? (ordered.length > 1 ? ordered.at(-1) : undefined);
  return { day1, day2 };
}

/** Stable source identities remain the same in both languages and across sheet polling. */
export function playerInfoPlayers(profiles: PlayerProfile[], bracket: StartggBracket | null, english: PlayerProfile[] = []): InfoPlayer[] {
  const finalIds = new Set((phases(bracket).day2?.groupIds ?? []).flatMap(id => {
    const group = bracket?.groups[id];
    return [...(group?.seeds.filter(s => !s.isBye).map(s => s.entrantId) ?? []),
      ...(group?.setIds.flatMap(setId => bracket?.sets[setId]?.slots.map(s => s.entrantId) ?? []) ?? [])]
      .filter((id): id is number => id != null);
  }));
  const entrants = Object.values(bracket?.entrants ?? {});
  const result: InfoPlayer[] = profiles.map(source => {
    let entrantId = source.startggEntrantId;
    if (entrantId != null && profiles.filter(p => p.startggEntrantId === entrantId).length > 1) entrantId = null;
    if (entrantId == null || !bracket?.entrants[entrantId]) {
      const matches = entrants.filter(e => matchProfile(profiles, { tag: e.tag, name: e.name }).profile === source);
      entrantId = matches.length === 1 ? matches[0]!.id : null;
    }
    const translated = matchProfile(english, { uid: source.geoguessrPlayerUid, entrantId, tag: source.startggTag, name: source.name }).profile;
    const profile = translated ?? source;
    const id = source.geoguessrPlayerUid ? `uid:${source.geoguessrPlayerUid}` : source.startggEntrantId != null
      ? `entrant:${source.startggEntrantId}` : `tag:${normalizeTag(source.startggTag || source.name)}`;
    return { id, name: profile.name, handle: profile.twitter, entrantId, profile, source,
      tag: source.startggTag, top8: entrantId != null && finalIds.has(entrantId),
      photoKeys: [...new Set([source.geoguessrPlayerUid, source.startggEntrantId?.toString(), entrantId?.toString(), source.startggTag, source.name]
        .filter((key): key is string => Boolean(key)).map(normalizeTag))] };
  });
  for (const entrantId of finalIds) {
    if (result.some(p => p.entrantId === entrantId)) continue;
    const entrant = bracket?.entrants[entrantId];
    if (!entrant) continue;
    const profile = matchProfile(english, { entrantId, tag: entrant.tag, name: entrant.name }).profile;
    result.push({ id: `entrant:${entrantId}`, name: profile?.name || entrant.tag || entrant.name,
      handle: profile?.twitter ?? '', entrantId, profile, source: null, tag: entrant.tag, top8: true,
      photoKeys: [...new Set([String(entrantId), entrant.tag, entrant.name].filter(Boolean).map(normalizeTag))] });
  }
  // Ambiguous source identities never pick an arbitrary row. Weak photo aliases
  // must have exactly one owner, even across profiles in different languages.
  const owners = new Map<string, number>(), identities = new Map<string, number>();
  for (const player of result) {
    identities.set(player.id, (identities.get(player.id) ?? 0) + 1);
    for (const key of player.photoKeys) owners.set(key, (owners.get(key) ?? 0) + 1);
  }
  return result.filter(player => identities.get(player.id) === 1)
    .map(player => ({ ...player, photoKeys: player.photoKeys.filter(key => owners.get(key) === 1) }))
    .sort((a, b) => Number(b.top8) - Number(a.top8));
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
const record = (wins: number, losses: number): InfoRecord | null => wins + losses ?
  { wins, losses, percent: `${(100 * wins / (wins + losses)).toFixed(1)}%` } : null;

function groupLabel(identifier: string, index: number): string {
  const normalized = identifier.normalize('NFKC').trim();
  if (/^[a-z]+$/i.test(normalized)) return `Group ${normalized.toUpperCase()}`;
  // start.gg calls the event's four pools 1–4; broadcast labels are A–D.
  const numeric = Number(normalized);
  let number = /^\d+$/.test(normalized) && Number.isSafeInteger(numeric) && numeric > 0 ? numeric : index + 1;
  let letters = '';
  while (number > 0) { number--; letters = String.fromCharCode(65 + number % 26) + letters; number = Math.floor(number / 26); }
  return `Group ${letters}`;
}

/** Day 1 is selected by phase, so Day 2 scores can never leak into the introduction. */
export function playerInfoResults(bracket: StartggBracket | null, entrantId: number | null, profiles: PlayerProfile[]): InfoResults {
  const empty: InfoResults = { placement: '', setRecord: null, gameRecord: null, rows: [], status: 'empty' };
  if (!bracket) return { ...empty, status: 'unavailable' };
  if (entrantId == null) return { ...empty, status: 'unlinked' };
  const { day1, day2 } = phases(bracket);
  if (!day1) return { ...empty, status: 'unavailable' };
  const groups = day1.groupIds.map(id => bracket.groups[id]).filter(g => g != null);
  const group = groups.find(g => g.seeds.some(s => s.entrantId === entrantId))
    ?? groups.find(g => g.setIds.some(id => bracket.sets[id]?.slots.some(s => s.entrantId === entrantId)));
  const progressed = (day2?.groupIds ?? []).flatMap(id => bracket.groups[id]?.seeds ?? [])
    .find(seed => seed.entrantId === entrantId && seed.source?.phaseGroupId === group?.id)?.source;
  const place = group?.seeds.find(seed => seed.entrantId === entrantId)?.placement ?? progressed?.placement;
  const placement = group ? `${place && place > 0 ? `${ordinal(place)} - ` : ''}${groupLabel(group.identifier, day1.groupIds.indexOf(group.id))}` : '';
  let setWins = 0, setLosses = 0, gameWins = 0, gameLosses = 0, missingGames = false, missingWinner = false;
  const rows: InfoResults['rows'] = [];
  const sets = Object.values(bracket.sets).filter(s => day1.groupIds.includes(s.groupId) && s.state === 'completed')
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0) || a.id - b.id);
  for (const set of sets) {
    const own = set.slots.find(s => s.entrantId === entrantId);
    const opponent = set.slots.find(s => s.entrantId != null && s.entrantId !== entrantId);
    if (!own || !opponent) continue;
    const won = set.winnerEntrantId === entrantId, lost = set.winnerEntrantId === opponent.entrantId;
    if (won) setWins++; else if (lost) setLosses++; else missingWinner = true;
    let score = '—';
    if (own.score === -1 && lost) score = 'DQ-W';
    else if (opponent.score === -1 && won) score = 'W-DQ';
    else if (own.score != null && opponent.score != null && Number.isInteger(own.score) && Number.isInteger(opponent.score) && own.score >= 0 && opponent.score >= 0) {
      gameWins += own.score; gameLosses += opponent.score; score = `${own.score}-${opponent.score}`;
    } else missingGames = true;
    const entrant = bracket.entrants[opponent.entrantId!];
    const profile = matchProfile(profiles, { entrantId: opponent.entrantId, tag: entrant?.tag, name: entrant?.name }).profile;
    rows.push({ id: set.id, opponent: profile?.name || entrant?.tag || entrant?.name || 'Unknown opponent', score });
  }
  return { placement, rows, status: rows.length ? 'ready' : 'empty',
    setRecord: missingWinner ? null : record(setWins, setLosses), gameRecord: missingGames ? null : record(gameWins, gameLosses) };
}

/** Only uploader-owned local assets are accepted. Ambiguous names deliberately stay unassigned. */
export function playerInfoPhoto(player: InfoPlayer, page: PlayerInfoLayer['page'], assets: InfoAsset[]): string | null {
  const aliases = player.photoKeys;
  const suffixes = page === 'results' ? ['-results', '-1', '', '-blank', '-profile', '-2'] : ['-profile', '-2', '', '-blank', '-results', '-1'];
  for (const suffix of suffixes) for (const alias of aliases) {
    const matches = assets.filter(asset => asset.base && /\.(jpe?g|png|webp)$/i.test(asset.base)
      && normalizeTag(asset.base.replace(/\.[^.]+$/, '')) === alias + suffix
      && asset.url?.startsWith('/assets/rashinban/player-info/'));
    if (matches.length > 1) return null;
    if (matches.length === 1) {
      const asset = matches[0]!;
      return asset.url! + (asset.sum ? `?v=${encodeURIComponent(asset.sum)}` : '');
    }
  }
  return null;
}
