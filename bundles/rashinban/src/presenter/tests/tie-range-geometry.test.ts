import assert from 'node:assert/strict';
import test from 'node:test';

import type { DuelState, Point, RoundResult } from '../../types/presenter.ts';
import { sampleGeodesicCircle, tieRangeMapGeometry, tieScoreRadius } from '../tie-range-geometry.ts';

const BLUE = '#458af2';
const RED = '#f05060';
const NEUTRAL = '#f5f7fc';
const GOLD = '#ffd55a';

function result(score: number, distanceM: number, point: Point | null): RoundResult {
  return {
    round: 1,
    score,
    bestGuess: point ? { ...point, round: 1, score, distanceM, createdAtMs: 1 } : null,
    healthBefore: 6000,
    healthAfter: 6000,
    damageDealt: 0,
    multiplier: 1,
  };
}

function state(
  scores: [number, number],
  distances: [number, number] = [100_000, 200_000],
  points: [Point | null, Point | null] = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
  maxErrorDistance: number | null = 14_999_250,
): DuelState {
  const best = Math.max(...scores);
  return {
    gameId: 'game', version: 1, round: 1, mode: 'MOVE', status: 'Ongoing', paused: false,
    manualRoundStart: false, initialHealth: 6000, aborted: false, winnerTeamId: null, isDraw: false,
    ruleOptions: { individual: 5, mutual: 0, delay: 1, maxErrorDistance },
    tieRange: { mode: 'full', rounds: [{ round: 1, band: 5000 - best, withinBand: Math.abs(scores[0] - scores[1]) <= 5000 - best }] },
    rounds: [{ number: 1, panorama: { lat: 0, lng: 0, panoId: 'pano', heading: 0, pitch: 0, zoom: 0 },
      startAtMs: 0, timerStartAtMs: 0, endAtMs: 1, multiplier: 1 }],
    players: [
      { id: 'blue', teamId: 'blue-team', teamColor: 'blue', health: 6000, multiplier: 1,
        pin: null, guesses: [], results: [result(scores[0], distances[0], points[0])] },
      { id: 'red', teamId: 'red-team', teamColor: 'red', health: 6000, multiplier: 1,
        pin: null, guesses: [], results: [result(scores[1], distances[1], points[1])] },
    ],
  };
}

const sides = { left: 'blue', right: 'red' };

test('tie score radius inverts the rounded score boundary and keeps the effective 25 metre floor', () => {
  const mapScale = 14_999_250;
  const expected = -(mapScale / 10) * Math.log(2999.5 / 5000);

  assert.ok(Math.abs(tieScoreRadius(3000, mapScale)! - expected) < 1e-6);
  assert.ok(Math.abs(tieScoreRadius(5000, mapScale)! - (-(mapScale / 10) * Math.log(4999.5 / 5000))) < 1e-6);
  assert.equal(tieScoreRadius(5000, 1000), 25);
  for (const [threshold, scale] of [[0, mapScale], [5001, mapScale], [3000, 0], [3000, Number.NaN]]) {
    assert.equal(tieScoreRadius(threshold, scale), null);
  }
});

test('geodesic sampling closes the full ring and preserves radius across the antimeridian', () => {
  const center = { lat: 10, lng: 179.8 };
  const path = sampleGeodesicCircle(center, 80_000, 72);
  const radians = (value: number) => value * Math.PI / 180;
  const distance = (point: Point) => {
    const lat = radians(point.lat - center.lat); const lng = radians(point.lng - center.lng);
    const a = Math.sin(lat / 2) ** 2 + Math.cos(radians(center.lat)) * Math.cos(radians(point.lat)) * Math.sin(lng / 2) ** 2;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  assert.equal(path.length, 73);
  assert.deepEqual(path.at(-1), path[0]);
  assert.ok(path.some(point => point.lng < -179));
  assert.ok(path.some(point => point.lng > 179));
  assert.ok(path.every(point => Math.abs(distance(point) - 80_000) < 0.01));

  const oneDegree = sampleGeodesicCircle({ lat: 0, lng: 0 }, 6_371_000 * Math.PI / 180, 72);
  assert.ok(Math.abs(oneDegree[0].lat - 1) < 1e-12);
});

test('ordinary tie-range geometry draws the closer side, finite outer ring, annulus and multiplier verdict', () => {
  const geometry = tieRangeMapGeometry(state([4000, 3500]), 1, sides, { lat: 0, lng: 0 })!;
  const expectedOuter = -(14_999_250 / 10) * Math.log(2999.5 / 5000);

  assert.equal(geometry.circles.length, 1);
  assert.deepEqual(geometry.circles[0], { kind: 'inner', center: { lat: 0, lng: 0 }, radiusM: 100_000, color: BLUE });
  assert.equal(geometry.circlePaths[0].length, 129);
  assert.ok(Math.abs(geometry.outerRadiusM! - expectedOuter) < 1e-6);
  assert.equal(geometry.outerPath?.length, 129);
  assert.equal(geometry.annulus?.length, 2);
  assert.equal(geometry.world, false);
  assert.equal(geometry.fullLongitude, false);
  assert.equal(geometry.label, 'Tie band: 1,000 points · Both multipliers increase');
});

test('equal scores choose the geographically closer display side and exact distance ties use neutral', () => {
  const closer = tieRangeMapGeometry(state([3500, 3500], [200, 100]), 1, sides, { lat: 0, lng: 0 })!;
  assert.equal(closer.circles[0].color, RED);
  assert.equal(closer.circles[0].radiusM, 100);

  const tied = tieRangeMapGeometry(state([3500, 3500], [100, 100]), 1, sides, { lat: 0, lng: 0 })!;
  assert.equal(tied.circles[0].color, NEUTRAL);
  assert.equal(tied.label, 'Tie band: 1,500 points · Both multipliers increase');
});

test('missing scale or closer guess omits only geometry that depends on it and keeps score copy', () => {
  const noScale = tieRangeMapGeometry(state([4000, 2999], [100, 200], undefined, null), 1, sides, { lat: 0, lng: 0 })!;
  assert.equal(noScale.outerPath, undefined);
  assert.equal(noScale.annulus, undefined);
  assert.equal(noScale.circles.length, 1);
  assert.equal(noScale.label, 'Tie band: 1,000 points · Left multiplier increases');

  const noCloserGuess = tieRangeMapGeometry(state([4000, 3500], [100, 200], [null, { lat: 2, lng: 2 }]), 1, sides, { lat: 0, lng: 0 })!;
  assert.equal(noCloserGuess.circles.length, 0);
  assert.equal(noCloserGuess.annulus, undefined);
  assert.ok(noCloserGuess.outerPath);
});

test('low score bands and globe-covering radii use world framing without a misleading outer ring', () => {
  const unbounded = tieRangeMapGeometry(state([2500, 100]), 1, sides, { lat: 0, lng: 0 })!;
  assert.equal(unbounded.world, true);
  assert.equal(unbounded.outerPath, undefined);
  assert.equal(unbounded.label, 'All guesses within tie range');
  assert.equal(unbounded.circles[0].kind, 'inner');

  const global = tieRangeMapGeometry(state([4000, 3500], undefined, undefined, 1_000_000_000), 1, sides, { lat: 0, lng: 0 })!;
  assert.equal(global.world, true);
  assert.equal(global.outerPath, undefined);
  assert.equal(global.label, 'Entire map within tie range');

  const globalFiveK = tieRangeMapGeometry(state([5000, 4999], undefined, undefined, 3_000_000_000_000), 1, sides, { lat: 0, lng: 0 })!;
  assert.equal(globalFiveK.world, true);
  assert.equal(globalFiveK.circles.length, 0);
  assert.equal(globalFiveK.label, 'Entire map within 5K range');
});

test('single and double 5Ks use one gold effective-radius circle and dedicated copy', () => {
  const single = tieRangeMapGeometry(state([5000, 4999]), 1, sides, { lat: 0, lng: 0 })!;
  assert.equal(single.label, '5K required to tie');
  assert.equal(single.circles.length, 1);
  assert.equal(single.circles[0].kind, 'five-k');
  assert.equal(single.circles[0].color, GOLD);
  assert.ok(single.circles[0].radiusM > 25);
  assert.equal(single.outerPath, undefined);
  assert.equal(single.annulus, undefined);

  const both = tieRangeMapGeometry(state([5000, 5000]), 1, sides, { lat: 0, lng: 0 })!;
  assert.equal(both.label, 'Both 5K');
  assert.equal(both.circles.length, 1);
});

test('polar circles request full-longitude bounds and disabled tie-range produces no geometry', () => {
  const polar = tieRangeMapGeometry(state([4000, 3500]), 1, sides, { lat: 89, lng: 45 })!;
  assert.equal(polar.fullLongitude, true);
  assert.equal(polar.world, false);

  const disabled = state([4000, 3500]);
  delete disabled.tieRange;
  assert.equal(tieRangeMapGeometry(disabled, 1, sides, { lat: 0, lng: 0 }), null);
});

test('terminal tie-range copy describes the verdict without promising a next-round increment', () => {
  const terminal = state([4000, 3500]); terminal.status = 'Finished';
  assert.equal(tieRangeMapGeometry(terminal, 1, sides, { lat: 0, lng: 0 })?.label,
    'Tie band: 1,000 points · Within tie range');
});

test('ordinary copy reflects delay, zero increments and mutual increments', () => {
  const delayed = state([4000, 3500]); delayed.ruleOptions!.delay = 2;
  assert.equal(tieRangeMapGeometry(delayed, 1, sides, { lat: 0, lng: 0 })?.label,
    'Tie band: 1,000 points · Within tie range');

  const zero = state([4000, 2999]); zero.ruleOptions!.individual = 0;
  assert.equal(tieRangeMapGeometry(zero, 1, sides, { lat: 0, lng: 0 })?.label,
    'Tie band: 1,000 points · Outside tie range');

  const mutualOnly = state([4000, 2999]); mutualOnly.ruleOptions!.individual = 0; mutualOnly.ruleOptions!.mutual = 5;
  assert.equal(tieRangeMapGeometry(mutualOnly, 1, sides, { lat: 0, lng: 0 })?.label,
    'Tie band: 1,000 points · Both multipliers increase');
});
