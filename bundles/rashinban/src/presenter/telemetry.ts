import type { Bounds, DuelState, PlayerView, Point, Views } from '../types/presenter.ts';

type RecordValue = Record<string, unknown>;

const SAMPLE_TYPES = new Set([
  'MapDisplay',
  'MapBoundingBox',
  'PinPosition',
  'GuessWithLatLng',
  'PanoPosition',
  'PanoPov',
  'PanoZoom',
]);

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function point(value: RecordValue): Point | null {
  if (!finite(value.lat) || !finite(value.lng)) return null;
  return { lat: value.lat, lng: value.lng };
}

function bounds(value: RecordValue): Bounds | null {
  if (!finite(value.north) || !finite(value.east) || !finite(value.south) || !finite(value.west)) {
    return null;
  }
  return { north: value.north, east: value.east, south: value.south, west: value.west };
}

function updatePlayer(view: PlayerView, mode: DuelState['mode'], sample: RecordValue): PlayerView | null {
  if (!finite(sample.time) || typeof sample.type !== 'string' || !SAMPLE_TYPES.has(sample.type)) {
    return null;
  }
  if (!isRecord(sample.payload)) return null;
  const previousTime = view.lastByType[sample.type];
  if (previousTime !== undefined && sample.time <= previousTime) return null;

  const payload = sample.payload;
  let update: Partial<PlayerView> | null = null;
  switch (sample.type) {
    case 'MapDisplay':
      if (typeof payload.isActive === 'boolean' && typeof payload.isSticky === 'boolean' && finite(payload.size)) {
        update = {
          mapActive: payload.isActive,
          mapSticky: payload.isSticky,
          mapSize: payload.size,
        };
      }
      break;
    case 'MapBoundingBox': {
      const decoded = bounds(payload);
      if (decoded) update = { mapBounds: decoded };
      break;
    }
    case 'PinPosition':
    case 'GuessWithLatLng': {
      const decoded = point(payload);
      if (decoded) update = { pin: decoded };
      break;
    }
    case 'PanoPosition': {
      const decoded = point(payload);
      if (decoded && typeof payload.panoId === 'string') {
        update =
          mode === 'MOVE'
            ? { panorama: { ...view.panorama, ...decoded, panoId: payload.panoId } }
            : {};
      }
      break;
    }
    case 'PanoPov':
      if (finite(payload.heading) && finite(payload.pitch)) {
        update =
          mode === 'NMPZ'
            ? {}
            : { panorama: { ...view.panorama, heading: payload.heading, pitch: payload.pitch } };
      }
      break;
    case 'PanoZoom':
      if (finite(payload.zoom)) {
        update = mode === 'NMPZ' ? {} : { panorama: { ...view.panorama, zoom: payload.zoom } };
      }
      break;
  }
  if (update === null) return null;
  return {
    ...view,
    ...update,
    lastByType: { ...view.lastByType, [sample.type]: sample.time },
  };
}

export function seedViews(state: DuelState): Views {
  const round = state.rounds.find((candidate) => candidate.number === state.round);
  if (!round) throw new Error(`Missing round ${state.round}`);
  const players: Record<string, PlayerView> = {};
  for (const player of state.players) {
    players[player.id] = {
      panorama: { ...round.panorama },
      mapBounds: null,
      pin: player.pin === null ? null : { ...player.pin },
      mapActive: false,
      mapSticky: false,
      mapSize: 0,
      lastByType: {},
    };
  }
  return { gameId: state.gameId, round: state.round, players };
}

export function applyTelemetry(views: Views, state: DuelState, message: unknown): Views {
  let current = views.gameId === state.gameId && views.round === state.round ? views : seedViews(state);
  if (!isRecord(message) || message.code !== 'LiveStreamSamples' || typeof message.playerId !== 'string') {
    return current;
  }
  const existing = current.players[message.playerId];
  if (!existing || !Array.isArray(message.payload)) return current;

  const round = state.rounds.find((candidate) => candidate.number === state.round);
  let player = existing;
  for (const rawSample of message.payload) {
    if (!isRecord(rawSample) || !finite(rawSample.time)) continue;
    if (round?.startAtMs !== null && round?.startAtMs !== undefined && rawSample.time < round.startAtMs) {
      continue;
    }
    player = updatePlayer(player, state.mode, rawSample) ?? player;
  }
  if (player === existing) return current;
  current = { ...current, players: { ...current.players, [message.playerId]: player } };
  return current;
}
