import assert from 'node:assert/strict';
import test from 'node:test';

import type { DuelState, Panorama, Views } from '../../types/presenter.ts';
import { applySnapshot } from '../normalize.ts';
import { applyTelemetry, seedViews } from '../telemetry.ts';
import { sample } from './fixtures.ts';

function stateFrom(name = 'gs2-ws-DuelStarted.json'): DuelState {
  const result = applySnapshot(null, sample(name));
  assert.ok(result.state);
  return structuredClone(result.state);
}

function message(playerId: string, payload: unknown[]): unknown {
  return { code: 'LiveStreamSamples', playerId, payload };
}

function telemetry(time: number, type: string, payload: unknown): unknown {
  return { time, type, payload };
}

function withMode(mode: DuelState['mode']): DuelState {
  const state = stateFrom();
  state.mode = mode;
  return state;
}

function currentPanorama(state: DuelState): Panorama {
  const panorama = state.rounds.find((round) => round.number === state.round)?.panorama;
  assert.ok(panorama);
  return panorama;
}

test('captured nested samples update maps and pins but keep NMPZ panorama fixed', () => {
  const state = stateFrom();
  const playerId = state.players[0].id;
  const views = seedViews(state);

  const result = applyTelemetry(views, state, sample('gs2-ws-LiveStreamSamples.json'));

  assert.deepEqual(result.players[playerId], {
    panorama: currentPanorama(state),
    mapBounds: { north: 67.646416, east: 143.4268, south: -68.87581, west: -135.71382 },
    pin: { lat: -4.565503, lng: -80.984344 },
    mapActive: true,
    mapSticky: false,
    mapSize: 4,
    lastByType: {
      MapDisplay: 1789042526683,
      MapBoundingBox: 1789042526699,
      PinPosition: 1789042529633,
      GuessWithLatLng: 1789042535005,
      PanoPosition: 1789042021609,
      PanoZoom: 1789042535370,
      PanoPov: 1789050625819,
    },
  });
});

test('movement trace changes MOVE panorama position, POV, and zoom', () => {
  const state = withMode('MOVE');
  const playerId = state.players[1].id;
  const trace = sample('gs2-ws-LiveStreamSamples-movement-trace.json') as {
    samples: unknown[];
  };

  const result = applyTelemetry(seedViews(state), state, message(playerId, trace.samples));

  assert.deepEqual(result.players[playerId]?.panorama, {
    lat: 49.41499228404625,
    lng: -120.26109922143681,
    panoId: 'hf8Q0ZxJE-uRDeAUkKoG9Q',
    heading: 192.66139,
    pitch: -6.8980255,
    zoom: 0.13053228,
  });
});

test('out-of-order samples are compared within their own type', () => {
  const state = withMode('MOVE');
  const playerId = state.players[0].id;
  const start = currentPanorama(state);
  const time = 1789042520000;
  const first = applyTelemetry(
    seedViews(state),
    state,
    message(playerId, [
      telemetry(time + 200, 'PanoPov', { heading: 20, pitch: 2 }),
      telemetry(time + 100, 'MapBoundingBox', { north: 4, east: 3, south: 2, west: 1 }),
    ]),
  );
  const result = applyTelemetry(
    first,
    state,
    message(playerId, [
      telemetry(time + 150, 'PanoPov', { heading: 15, pitch: 1 }),
      telemetry(time + 250, 'MapBoundingBox', { north: 40, east: -170, south: -20, west: 170 }),
    ]),
  );

  assert.deepEqual(result.players[playerId]?.panorama, { ...start, heading: 20, pitch: 2 });
  assert.deepEqual(result.players[playerId]?.mapBounds, {
    north: 40,
    east: -170,
    south: -20,
    west: 170,
  });
});

test('players keep independent map state', () => {
  const state = stateFrom();
  const [leftId, rightId] = state.players.map((player) => player.id);
  const time = 1789042520000;
  const left = applyTelemetry(
    seedViews(state),
    state,
    message(leftId, [telemetry(time, 'MapBoundingBox', { north: 1, east: 2, south: 3, west: 4 })]),
  );
  const result = applyTelemetry(
    left,
    state,
    message(rightId, [telemetry(time + 1, 'MapBoundingBox', { north: 5, east: 6, south: 7, west: 8 })]),
  );

  assert.deepEqual(result.players[leftId]?.mapBounds, { north: 1, east: 2, south: 3, west: 4 });
  assert.deepEqual(result.players[rightId]?.mapBounds, { north: 5, east: 6, south: 7, west: 8 });
});

test('game or round changes clear telemetry before applying current samples', () => {
  const state = stateFrom();
  const playerId = state.players[0].id;
  const populated = applyTelemetry(
    seedViews(state),
    state,
    message(playerId, [telemetry(1789042526699, 'MapDisplay', { isActive: true, isSticky: true, size: 3 })]),
  );
  const next = structuredClone(state);
  next.round = 2;
  next.rounds.push({
    number: 2,
    panorama: { lat: 1, lng: 2, panoId: 'round-two', heading: 3, pitch: 4, zoom: 5 },
    startAtMs: 300,
    timerStartAtMs: null,
    endAtMs: null,
    multiplier: 1.5,
  });

  const result = applyTelemetry(populated, next, { code: 'Other' });

  assert.equal(result.round, 2);
  assert.deepEqual(result.players[playerId], {
    panorama: currentPanorama(next),
    mapBounds: null,
    pin: state.players[0].pin,
    mapActive: false,
    mapSticky: false,
    mapSize: 0,
    lastByType: {},
  });

  const nextGame = structuredClone(state);
  nextGame.gameId = 'next-game';
  const gameResult = applyTelemetry(populated, nextGame, { code: 'Other' });
  assert.equal(gameResult.gameId, 'next-game');
  assert.equal(gameResult.players[playerId]?.mapActive, false);
  assert.deepEqual(gameResult.players[playerId]?.lastByType, {});
});

test('NM fixes position while allowing POV and zoom changes', () => {
  const state = withMode('NM');
  const playerId = state.players[0].id;
  const start = currentPanorama(state);
  const result = applyTelemetry(
    seedViews(state),
    state,
    message(playerId, [
      telemetry(1789042520000, 'PanoPosition', { lat: 9, lng: 8, panoId: 'moved' }),
      telemetry(1789042520001, 'PanoPov', { heading: 7, pitch: 6 }),
      telemetry(1789042520002, 'PanoZoom', { zoom: 5 }),
    ]),
  );

  assert.deepEqual(result.players[playerId]?.panorama, {
    ...start,
    heading: 7,
    pitch: 6,
    zoom: 5,
  });
});

test('samples before a known round start and non-finite payloads are ignored', () => {
  const state = withMode('MOVE');
  const playerId = state.players[0].id;
  const start = currentPanorama(state);
  const startAtMs = state.rounds[0]?.startAtMs;
  assert.ok(startAtMs);

  const result = applyTelemetry(
    seedViews(state),
    state,
    message(playerId, [
      telemetry(startAtMs - 1, 'PanoPov', { heading: 1, pitch: 2 }),
      telemetry(startAtMs + 1, 'PanoPosition', { lat: Number.NaN, lng: 2, panoId: 'bad' }),
      telemetry(startAtMs + 2, 'PanoPov', { heading: Number.POSITIVE_INFINITY, pitch: 2 }),
      telemetry(startAtMs + 3, 'MapBoundingBox', { north: 1, east: 2, south: 3, west: Number.NaN }),
    ]),
  );

  assert.deepEqual(result.players[playerId]?.panorama, start);
  assert.equal(result.players[playerId]?.mapBounds, null);
  assert.deepEqual(result.players[playerId]?.lastByType, {});
});

test('unknown players and sample types do not change views', () => {
  const state = stateFrom();
  const views: Views = seedViews(state);
  const unknownPlayer = applyTelemetry(
    views,
    state,
    message('unknown', [
      telemetry(1789042520000, 'MapDisplay', { isActive: true, isSticky: true, size: 2 }),
    ]),
  );
  const unknownType = applyTelemetry(
    views,
    state,
    message(state.players[0].id, [telemetry(1789042520000, 'Timer', { time: 10 })]),
  );

  assert.deepEqual(unknownPlayer, views);
  assert.deepEqual(unknownType, views);
});
