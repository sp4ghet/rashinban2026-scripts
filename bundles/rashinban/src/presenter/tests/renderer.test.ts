import assert from 'node:assert/strict';
import test from 'node:test';
import { createRenderer, rendererPlan, resultBounds, type MapFrame, type RendererAdapter, type RenderFrame } from '../../graphics/presenter/renderer.ts';
import type { Panorama } from '../../types/presenter.ts';
import { applySnapshot } from '../normalize.ts';
import { seedViews } from '../telemetry.ts';
import { advanceTimeline, DEFAULT_TIMING } from '../timeline.ts';
import { project } from '../projection.ts';
import { sample } from './fixtures.ts';
import { createGoogleRenderer, googleAdapter, googlePanoId } from '../../graphics/presenter/google.ts';

function frame(): RenderFrame {
  const state = structuredClone(applySnapshot(null, sample('gs2-ws-DuelStarted.json')).state!);
  state.mode = 'NMPZ';
  return { state, views: seedViews(state), source: 'rendered', playerIds: { left: state.players[0].id, right: state.players[1].id },
    projection: { phase: 'live', remainingMs: null, answer: null, players: [] } };
}
function surfaces() {
  const maps: { slot: string; frames: MapFrame[]; disposed: boolean }[] = [];
  const panos: { slot: string; frames: (Panorama | null)[]; options: any[]; disposed: boolean }[] = [];
  const adapter: RendererAdapter = {
    map(slot) { const item = { slot, frames: [] as MapFrame[], disposed: false }; maps.push(item); return { render: value => item.frames.push(structuredClone(value)), dispose: () => { item.disposed = true; } }; },
    panorama(slot) { const item = { slot, frames: [] as (Panorama | null)[], options: [] as any[], disposed: false }; panos.push(item); return { render: (value, options) => { item.frames.push(structuredClone(value)); item.options.push(options); }, dispose: () => { item.disposed = true; } }; },
  };
  return { maps, panos, adapter };
}
test('shared NMPZ renders one panorama and two player maps', () => {
  assert.deepEqual(rendererPlan('NMPZ', 'rendered', 'live'), { panoramas: 1, playerMaps: 2, resultsMap: false });
  assert.deepEqual(rendererPlan('NMPZ', 'chroma', 'results-reveal'), { panoramas: 0, playerMaps: 0, resultsMap: true });
  assert.deepEqual(rendererPlan('MOVE', 'rendered', 'live'), { panoramas: 2, playerMaps: 2, resultsMap: false });
  for (const phase of ['waiting-game', 'pre-round', 'results-transition', 'aborted'] as const) assert.deepEqual(rendererPlan('NM', 'rendered', phase), { panoramas: 0, playerMaps: 0, resultsMap: false });
});
test('orchestrator retains fixed NMPZ POV, independent maps and explicit side swaps', () => {
  const f = frame(); const fake = surfaces(); const renderer = createRenderer(fake.adapter, assert.fail);
  const left = f.views.players[f.playerIds!.left!]!; const right = f.views.players[f.playerIds!.right!]!;
  left.panorama.heading = 999; left.mapActive = true; left.mapBounds = { north: 20, east: -170, south: 0, west: 170 }; left.pin = { lat: 1, lng: 179 };
  right.mapSticky = true; right.mapBounds = { north: 40, east: 50, south: 30, west: 40 }; right.pin = { lat: 35, lng: 45 };
  renderer.render(f); renderer.render(f);
  assert.equal(fake.panos.length, 1); assert.equal(fake.maps.length, 2);
  assert.deepEqual(fake.panos[0].frames.at(-1), f.state.rounds[0].panorama);
  assert.deepEqual(fake.maps[0].frames.at(-1)?.bounds, left.mapBounds);
  assert.deepEqual(fake.maps[1].frames.at(-1)?.pins[0].point, right.pin);
  assert.equal(fake.maps[1].frames.at(-1)?.visible, true);
  f.playerIds = { left: f.playerIds!.right, right: f.playerIds!.left }; renderer.render(f);
  assert.deepEqual(fake.maps[0].frames.at(-1)?.pins[0].point, right.pin);
  f.playerIds = undefined; renderer.render(f);
  assert.equal(fake.maps[0].frames.at(-1)?.visible, false);
  assert.deepEqual(fake.maps[0].frames.at(-1)?.pins, []);
});
test('MOVE and NM retain per-slot Google objects across mode, source, phase and round changes', () => {
  const f = frame(); const fake = surfaces(); const renderer = createRenderer(fake.adapter, assert.fail);
  f.state.mode = 'MOVE'; f.views.players[f.playerIds!.left!]!.panorama.heading = 75;
  renderer.render(f); assert.equal(fake.panos.length, 2); assert.equal(fake.panos[0].frames.at(-1)?.heading, 75);
  f.state.mode = 'NM'; renderer.render(f); assert.ok(fake.panos.every(p => !p.disposed));
  assert.equal(fake.panos.at(-2)?.frames.at(-1)?.heading, 75);
  f.source = 'chroma'; renderer.render(f); assert.ok(fake.panos.every(p => !p.disposed)); assert.ok(fake.maps.every(p => !p.disposed));
  assert.ok(fake.panos.every(p => p.options.at(-1)?.visible === false));
  assert.ok(fake.maps.every(p => p.frames.at(-1)?.visible === false));
  f.source = 'rendered'; renderer.render(f);
  f.projection.phase = 'pre-round'; renderer.render(f);
  assert.ok(fake.panos.every(p => p.options.at(-1)?.visible === false));
  f.state.round++; renderer.render(f); assert.equal(fake.panos.length, 2); assert.equal(fake.panos.at(-1)?.frames.at(-1), null);
  assert.ok(fake.panos.every(p => !p.disposed));
  renderer.dispose(); renderer.dispose(); assert.ok(fake.maps.every(p => p.disposed));
});
test('reveal gates answer and actual best guesses; no-pin player gets no invented result marker', () => {
  const f = frame(); const fake = surfaces(); const renderer = createRenderer(fake.adapter, assert.fail);
  const answer = { ...f.state.rounds[0].panorama, lat: 0, lng: 179 };
  f.state.players[0].results = [{ round: f.state.round, score: 4000, bestGuess: { lat: 1, lng: -179, score: 4000, distanceM: 100, createdAtMs: 1, round: f.state.round }, healthBefore: 6000, healthAfter: 6000, damageDealt: 0, multiplier: 1 }];
  f.state.players[1].results = [{ ...f.state.players[0].results[0], bestGuess: null }];
  f.source = 'chroma'; f.projection.phase = 'results-transition'; renderer.render(f); assert.equal(fake.maps.length, 0);
  f.projection.phase = 'results-reveal'; renderer.render(f); assert.equal(fake.maps.length, 0);
  f.projection.answer = answer; renderer.render(f); assert.equal(fake.maps.length, 1);
  const visible = fake.maps[0].frames.at(-1)!;
  assert.equal(visible.pins.length, 2); assert.equal(visible.lines.length, 1);
  assert.deepEqual(visible.pins.map(pin => pin.point), [{ lat: 0, lng: 179 }, { lat: 1, lng: -179 }]);
  assert.deepEqual(visible.bounds, { north: 1, south: 0, west: 179, east: -179 });
  f.projection.answer = null; renderer.render(f); assert.equal(fake.maps[0].disposed, false); assert.equal(fake.maps[0].frames.at(-1)?.visible, false);
});
test('map construction failure is sanitized, disposes partial resources and does not throw per frame', () => {
  const f = frame(); const fake = surfaces(); const errors: string[] = [];
  fake.adapter.map = () => { throw new Error('private raw error'); };
  const renderer = createRenderer(fake.adapter, value => errors.push(value));
  renderer.render(f); renderer.render(f);
  assert.deepEqual(errors, ['Google Maps view unavailable']); assert.ok(fake.panos.every(p => p.disposed));
});
test('result map uses displayed round when a newer duel arrives before its timeline', () => {
  const rows = sample('gs2-ws-full-duel-sequence.json') as Array<{ message: any }>;
  const resolved = (number: number) => applySnapshot(null, rows.find(row => row.message.duel?.state.currentRoundNumber === number
    && row.message.duel.state.teams.every((team: any) => team.roundResults.some((result: any) => result.roundNumber === number)))!.message).state!;
  const older = resolved(1); const state = resolved(2); const now = 1900000000000;
  const timeline = advanceTimeline(null, older, now, true, DEFAULT_TIMING);
  const projection = project(state, timeline, now);
  assert.equal(state.round, 2); assert.equal(timeline.round, 1);
  assert.deepEqual(projection.players.map(player => player.score), [4240, 4164]);
  assert.deepEqual(projection.players.map(player => player.distanceM), [247202.9444761016, 274587.2846388461]);
  const fake = surfaces(); const renderer = createRenderer(fake.adapter, assert.fail);
  renderer.render({ state, views: seedViews(state), projection, source: 'chroma', displayedRound: timeline.round,
    playerIds: { left: state.players[0].id, right: state.players[1].id } });
  const visible = fake.maps.at(-1)!.frames.at(-1)!;
  const answer = { lat: 14.91906512738777, lng: 104.72329554263634 };
  const left = { lat: 15.421321155170894, lng: 102.4794131119633 };
  const right = { lat: 15.287361559113538, lng: 102.19410991386636 };
  assert.deepEqual(visible.pins.map(pin => pin.point), [answer, left, right]);
  assert.deepEqual(visible.lines.map(line => [line.from, line.to]), [[answer, left], [answer, right]]);
  assert.ok(visible.bounds!.west > 100 && visible.bounds!.east < 110);
});
test('results bounds choose shortest longitude arc and handle empty or coincident points', () => {
  assert.equal(resultBounds([]), null);
  assert.deepEqual(resultBounds([{ lat: 3, lng: 8 }]), { north: 3, south: 3, east: 8, west: 8 });
  assert.deepEqual(resultBounds([{ lat: 1, lng: -170 }, { lat: 2, lng: 170 }, { lat: 0, lng: 178 }]), { north: 2, south: 0, west: 170, east: -170 });
});
test('mapped minimaps stay visible in all modes and expand only for active or sticky state', () => {
  const f = frame(); const fake = surfaces(); const renderer = createRenderer(fake.adapter, assert.fail);
  renderer.render(f); assert.equal(fake.maps[0].frames.at(-1)?.visible, true);
  for (const mode of ['MOVE', 'NM', 'NMPZ'] as const) {
    f.state.mode = mode; renderer.render(f);
    assert.equal(fake.maps[0].frames.at(-1)?.visible, true);
    assert.equal(fake.maps[0].frames.at(-1)?.inactive, true);
    f.views.players[f.playerIds!.left!]!.mapActive = true; renderer.render(f);
    assert.equal(fake.maps[0].frames.at(-1)?.inactive, false);
    f.views.players[f.playerIds!.left!]!.mapActive = false;
    f.views.players[f.playerIds!.left!]!.mapSticky = true; renderer.render(f);
    assert.equal(fake.maps[0].frames.at(-1)?.inactive, false);
    f.views.players[f.playerIds!.left!]!.mapSticky = false;
  }
});

test('known current-round panoramas prepare hidden before live without leaking results or unmapped player views', () => {
  const f = frame(); f.state.mode = 'MOVE'; const fake = surfaces(); const renderer = createRenderer(fake.adapter, assert.fail);
  for (const phase of ['pre-round', 'results-transition', 'results-reveal', 'waiting-host'] as const) {
    f.projection.phase = phase; renderer.render(f);
    assert.equal(fake.panos.length, 2);
    assert.deepEqual(fake.panos[0].frames.at(-1), f.views.players[f.playerIds!.left!]!.panorama);
    assert.equal(fake.panos[0].options.at(-1)?.visible, false);
    assert.ok(fake.maps.every(map => !map.frames.at(-1)?.visible));
  }
  f.projection.phase = 'live'; renderer.render(f);
  assert.equal(fake.panos[0].options.at(-1)?.visible, true);
  assert.equal(fake.panos.length, 2);
  const identity = fake.panos[0].options.at(-1)?.identity;
  f.playerIds = { left: f.playerIds!.right, right: null }; renderer.render(f);
  assert.notEqual(fake.panos[0].options.at(-1)?.identity, identity);
  assert.equal(fake.panos[1].frames.at(-1), null);
  f.projection.phase = 'waiting-game'; renderer.render(f);
  assert.ok(fake.panos.every(p => p.frames.at(-1) === null));
});
test('Google ID decoding preserves plain movement IDs and decodes captured round hex only', () => {
  assert.equal(googlePanoId('4F39784262706177324F6D42787838766D776C577651'), 'O9xBbpaw2OmBxx8vmwlWvQ');
  assert.equal(googlePanoId('hf8Q0ZxJE-uRDeAUkKoG9Q'), 'hf8Q0ZxJE-uRDeAUkKoG9Q');
});
test('missing browser key fails without touching the DOM or loading Google', async () => {
  const errors: string[] = [];
  await assert.rejects(createGoogleRenderer(null as unknown as HTMLElement, '', value => errors.push(value)), /Google Maps browser key missing/);
  assert.deepEqual(errors, ['Google Maps browser key missing']);
});
// Only the external Google/DOM boundary is faked: assertions observe requested
// view state, exact lookup behavior, and cleanup produced by the real adapter.
function googleBoundary() {
  class Element {
    style: Record<string, string> = {}; dataset: Record<string, string> = {}; className = ''; textContent = ''; hidden = false;
    children: Element[] = []; ownerDocument = { createElement: () => new Element() };
    replaceChildren(...children: Element[]) { this.children = children; }
    append(...children: Element[]) { this.children.push(...children); }
  }
  const slots = new Map<string, Element>();
  const root = { querySelector(id: string) { if (!slots.has(id)) slots.set(id, new Element()); return slots.get(id); } } as unknown as HTMLElement;
  const panos: any[] = []; const maps: any[] = []; const overlays: any[] = []; const requests: any[] = []; const cleared: any[] = []; const resized: any[] = [];
  class Pano {
    options: any; pano = ''; pov: any; zoom = 0; visible = false; listeners = new Map(); povWrites = 0; zoomWrites = 0;
    constructor(_el: any, options: any) { this.options = options; panos.push(this); }
    setPano(value: string) { this.pano = value; } setPov(value: any) { this.pov = value; this.povWrites++; } setZoom(value: number) { this.zoom = value; this.zoomWrites++; }
    setVisible(value: boolean) { this.visible = value; } getStatus() { return 'OK'; }
    addListener(name: string, fn: Function) { this.listeners.set(name, fn); return { remove: () => this.listeners.delete(name) }; } unbindAll() {}
  }
  class GMap {
    fits: any[] = []; center: any; zoom: any; constructor(_el: any, publicOptions: any) { maps.push(this); }
    setCenter(center: any) { this.center = center; } setZoom(zoom: number) { this.zoom = zoom; }
    fitBounds(bounds: any, padding: any) { this.fits.push({ bounds, padding }); } unbindAll() {}
  }
  class Overlay {
    options: any; map: any; constructor(options: any) { this.options = options; this.map = options.map; overlays.push(this); }
    setMap(map: any) { this.map = map; } unbindAll() {}
  }
  const api = { Map: GMap, StreetViewPanorama: Pano, Marker: Overlay, Polyline: Overlay, SymbolPath: { CIRCLE: 0 },
    StreetViewService: class { getPanorama(request: any, callback: Function) { requests.push({ request, callback }); } },
    event: { clearInstanceListeners: (value: any) => cleared.push(value), trigger(value: any, name: string) { if (name === 'resize') resized.push(value); } } } as unknown as typeof google.maps;
  return { root, api, panos, maps, overlays, requests, cleared, resized, slots };
}
test('Google panorama adapter resolves exact IDs, applies latest POV and ignores disposed lookups', () => {
  const fake = googleBoundary(); const errors: string[] = [];
  const surface = googleAdapter(fake.root, fake.api, value => errors.push(value)).panorama('left-view');
  const p = { lat: 1, lng: 2, panoId: 'exact-id', heading: 10, pitch: 20, zoom: 1 };
  surface.render(p); surface.render({ ...p, heading: 30 });
  assert.equal(fake.requests.length, 1); assert.deepEqual(fake.requests[0].request, { pano: 'exact-id' });
  fake.requests[0].callback({ location: { pano: 'exact-id' } }, 'OK');
  assert.equal(fake.panos[0].pano, 'exact-id'); assert.deepEqual(fake.panos[0].pov, { heading: 30, pitch: 20 });
  assert.equal(fake.panos[0].zoom, 1); assert.equal(fake.panos[0].options.clickToGo, false);
  assert.equal(fake.panos[0].options.motionTracking, false); assert.equal(fake.panos[0].options.linksControl, false);
  surface.render({ ...p, panoId: 'missing' }); fake.requests[1].callback(null, 'ZERO_RESULTS');
  assert.equal(fake.panos[0].visible, true); assert.equal(fake.panos[0].pano, 'exact-id'); assert.deepEqual(errors, ['Exact Street View panorama unavailable']);
  surface.render({ ...p, panoId: 'later' }); surface.dispose(); fake.requests[2].callback({ location: { pano: 'later' } }, 'OK');
  assert.equal(fake.panos[0].visible, false); assert.ok(fake.cleared.includes(fake.panos[0]));
});
test('POV interpolation takes the short heading arc and reaches pitch/zoom targets without settled writes', () => {
  const fake = googleBoundary(); let now = 0;
  const surface = googleAdapter(fake.root, fake.api, assert.fail, () => {}, () => now).panorama('left-view');
  const p = { lat: 1, lng: 2, panoId: 'same', heading: 350, pitch: 20, zoom: 1 };
  surface.render(p); fake.requests[0].callback({ location: { pano: 'same' } }, 'OK');
  const target = { ...p, heading: 10, pitch: 40, zoom: 3 };
  surface.render(target);
  assert.equal(fake.panos[0].pov.heading, 350);
  now = 100; surface.render(target);
  assert.deepEqual(fake.panos[0].pov, { heading: 0, pitch: 30 }); assert.equal(fake.panos[0].zoom, 2);
  now = 200; surface.render(target);
  assert.deepEqual(fake.panos[0].pov, { heading: 10, pitch: 40 }); assert.equal(fake.panos[0].zoom, 3);
  const writes = [fake.panos[0].povWrites, fake.panos[0].zoomWrites];
  now = 300; surface.render(target); now = 400; surface.render(target);
  assert.deepEqual([fake.panos[0].povWrites, fake.panos[0].zoomWrites], writes);
});

test('a fixed initial POV stays exact without writes even when heading uses a signed representation', () => {
  const fake = googleBoundary(); let now = 0;
  const surface = googleAdapter(fake.root, fake.api, assert.fail, () => {}, () => now).panorama('shared-panorama');
  const p = { lat: 1, lng: 2, panoId: 'same', heading: -10, pitch: 20, zoom: 1 };
  surface.render(p); fake.requests[0].callback({ location: { pano: 'same' } }, 'OK');
  now = 100; surface.render(p);
  assert.deepEqual(fake.panos[0].pov, { heading: -10, pitch: 20 });
  assert.equal(fake.panos[0].povWrites, 1); assert.equal(fake.panos[0].zoomWrites, 1);
});

for (const fps of [30, 60]) test(`POV interpolation uses elapsed time at ${fps} fps and repeated targets do not restart it`, () => {
  const fake = googleBoundary(); let now = 0;
  const surface = googleAdapter(fake.root, fake.api, assert.fail, () => {}, () => now).panorama('left-view');
  const p = { lat: 1, lng: 2, panoId: 'same', heading: 0, pitch: 0, zoom: 1 };
  surface.render(p); fake.requests[0].callback({ location: { pano: 'same' } }, 'OK');
  const target = { ...p, heading: 120, pitch: -40, zoom: 3 }; surface.render(target);
  for (let i = 1; i <= fps / 5; i++) {
    now = i * 1000 / fps; surface.render(target);
    assert.ok(Math.abs(fake.panos[0].pov.heading - now / 200 * 120) < 1e-9);
    assert.ok(Math.abs(fake.panos[0].pov.pitch - now / 200 * -40) < 1e-9);
    assert.ok(Math.abs(fake.panos[0].zoom - (1 + now / 200 * 2)) < 1e-9);
  }
  assert.equal(fake.panos[0].pov.heading, 120);
  assert.equal(fake.panos[0].zoom, 3);
});

test('mid-flight telemetry retargets from the interpolated current pose, including between drawn frames', () => {
  const fake = googleBoundary(); let now = 0;
  const surface = googleAdapter(fake.root, fake.api, assert.fail, () => {}, () => now).panorama('left-view');
  const p = { lat: 1, lng: 2, panoId: 'same', heading: 0, pitch: 0, zoom: 1 };
  surface.render(p); fake.requests[0].callback({ location: { pano: 'same' } }, 'OK');
  surface.render({ ...p, heading: 100 });
  now = 50; surface.render({ ...p, heading: 100 }); assert.equal(fake.panos[0].pov.heading, 25);
  now = 80; surface.render({ ...p, heading: 200 }); assert.equal(fake.panos[0].pov.heading, 40);
  now = 180; surface.render({ ...p, heading: 200 }); assert.equal(fake.panos[0].pov.heading, 120);
  now = 280; surface.render({ ...p, heading: 200 }); assert.equal(fake.panos[0].pov.heading, 200);
  assert.equal(fake.panos[0].zoomWrites, 1, 'heading-only movement must not rewrite zoom');
});

test('hidden preparation, reentry, frame gaps and identity changes snap instead of replaying stale interpolation', () => {
  const fake = googleBoundary(); let now = 0;
  const surface = googleAdapter(fake.root, fake.api, assert.fail, () => {}, () => now).panorama('left-view');
  const p = { lat: 1, lng: 2, panoId: 'same', heading: 0, pitch: 0, zoom: 1 };
  const options = { visible: true, identity: 'game:round:player' };
  surface.render(p, options); fake.requests[0].callback({ location: { pano: 'same' } }, 'OK');
  surface.render({ ...p, heading: 100 }, options);
  now = 50; surface.render({ ...p, heading: 100 }, options); assert.equal(fake.panos[0].pov.heading, 25);
  surface.render({ ...p, heading: 160 }, { ...options, visible: false }); assert.equal(fake.panos[0].pov.heading, 160);
  surface.render({ ...p, heading: 240 }, options); assert.equal(fake.panos[0].pov.heading, 240);
  now = 100; surface.render({ ...p, heading: 300 }, options);
  now = 800; surface.render({ ...p, heading: 320 }, options); assert.equal(fake.panos[0].pov.heading, 320);
  surface.render({ ...p, heading: 90 }, { ...options, identity: 'other-round' });
  fake.requests[1].callback({ location: { pano: 'same' } }, 'OK'); assert.equal(fake.panos[0].pov.heading, 90);
  surface.render(null);
  surface.render({ ...p, heading: 180 }, options); fake.requests[2].callback({ location: { pano: 'same' } }, 'OK');
  assert.equal(fake.panos[0].pov.heading, 180);
});

test('new panorama resolution snaps its latest pose and pending targets never interpolate onto the old scene', () => {
  const fake = googleBoundary(); let now = 0;
  const surface = googleAdapter(fake.root, fake.api, assert.fail, () => {}, () => now).panorama('left-view');
  const p = { lat: 1, lng: 2, panoId: 'first', heading: 0, pitch: 0, zoom: 1 };
  surface.render(p); fake.requests[0].callback({ location: { pano: 'first' } }, 'OK');
  surface.render({ ...p, heading: 100 }); now = 50; surface.render({ ...p, heading: 100 });
  const old = { ...fake.panos[0].pov };
  surface.render({ ...p, panoId: 'second', heading: 250, zoom: 3 });
  now = 100; surface.render({ ...p, panoId: 'second', heading: 280, zoom: 4 });
  assert.deepEqual(fake.panos[0].pov, old); assert.equal(fake.panos[0].zoom, 1);
  fake.requests[1].callback({ location: { pano: 'second' } }, 'OK');
  assert.deepEqual(fake.panos[0].pov, { heading: 280, pitch: 0 }); assert.equal(fake.panos[0].zoom, 4);
});

test('pending panorama movement keeps the prior scene and POV until the newest exact lookup succeeds', () => {
  const fake = googleBoundary(); const errors: string[] = [];
  const surface = googleAdapter(fake.root, fake.api, value => errors.push(value)).panorama('left-view');
  const p = { lat: 1, lng: 2, panoId: 'first', heading: 10, pitch: 20, zoom: 1 };
  surface.render(p); fake.requests[0].callback({ location: { pano: 'first' } }, 'OK');
  surface.render({ ...p, panoId: 'second', heading: 50 });
  surface.render({ ...p, panoId: 'second', heading: 60 });
  assert.equal(fake.panos[0].visible, true);
  assert.deepEqual(fake.panos[0].pov, { heading: 10, pitch: 20 });
  assert.equal(fake.slots.get('#left-view')?.children[1].hidden, true);
  surface.render({ ...p, panoId: 'third', heading: 70 });
  fake.requests[1].callback(null, 'ZERO_RESULTS');
  assert.deepEqual(errors, []);
  fake.requests[2].callback({ location: { pano: 'third' } }, 'OK');
  assert.equal(fake.panos[0].pano, 'third'); assert.equal(fake.panos[0].pov.heading, 70);
  surface.render({ ...p, panoId: 'fourth', heading: 90 });
  fake.requests[3].callback(null, 'ZERO_RESULTS');
  assert.equal(fake.panos[0].pano, 'third'); assert.equal(fake.panos[0].visible, true);
  assert.equal(errors.length, 1);
  surface.render({ ...p, panoId: 'fifth' });
  surface.render({ ...p, panoId: 'sixth', heading: 120 });
  fake.requests[5].callback({ location: { pano: 'sixth' } }, 'OK');
  fake.requests[4].callback({ location: { pano: 'fifth' } }, 'OK');
  assert.equal(fake.panos[0].pano, 'sixth'); assert.equal(fake.panos[0].pov.heading, 120);
});

test('hidden panorama preparation reuses its lookup at live and resets stale imagery on identity or null frame', () => {
  const fake = googleBoundary(); const surface = googleAdapter(fake.root, fake.api, assert.fail).panorama('left-view');
  const p = { lat: 1, lng: 2, panoId: 'prepared', heading: 10, pitch: 20, zoom: 1 };
  surface.render(p, { visible: false, identity: 'game:1:player' });
  fake.requests[0].callback({ location: { pano: 'prepared' } }, 'OK');
  assert.equal(fake.panos[0].pano, 'prepared');
  assert.equal(fake.slots.get('#left-view')?.children[0].style.visibility, 'hidden');
  surface.render(p, { visible: true, identity: 'game:1:player' });
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.slots.get('#left-view')?.children[0].style.visibility, 'visible');
  assert.deepEqual(fake.resized, [fake.panos[0]]);
  surface.render(p, { visible: true, identity: 'game:1:player' });
  assert.equal(fake.resized.length, 1, 'stable frames must not resize Google continuously');
  surface.render({ ...p, panoId: 'replacement' }, { visible: true, identity: 'game:2:other-player' });
  assert.equal(fake.slots.get('#left-view')?.children[0].style.visibility, 'hidden');
  surface.render(null); fake.requests[1].callback({ location: { pano: 'replacement' } }, 'OK');
  assert.equal(fake.slots.get('#left-view')?.children[0].style.visibility, 'hidden');
  assert.equal(fake.panos.length, 1);
});

test('Google map adapter fits visible bounds once and refits on expansion, and detaches pins and lines on updates/dispose', () => {
  const fake = googleBoundary(); const surface = googleAdapter(fake.root, fake.api, assert.fail).map('left-map');
  const f: MapFrame = { visible: false, bounds: { north: 2, south: 0, west: 170, east: -170 }, pins: [{ point: { lat: 1, lng: 179 }, color: '#458af2', label: 'left' }], lines: [] };
  surface.render(f); assert.equal(fake.maps.length, 1); assert.equal(fake.maps[0].fits.length, 0);
  f.visible = true; surface.render(f); surface.render(f); assert.equal(fake.maps[0].fits.length, 1);
  assert.deepEqual(fake.maps[0].fits[0].bounds, f.bounds); assert.equal(fake.maps[0].fits[0].padding, 0);
  surface.render({ ...f, inactive: true }); assert.equal(fake.maps[0].fits.length, 2);
  surface.render({ ...f, inactive: false }); assert.equal(fake.maps[0].fits.length, 3);
  surface.render({ ...f, pins: [], lines: [{ from: { lat: 0, lng: 170 }, to: { lat: 1, lng: -170 }, color: '#458af2' }] });
  assert.equal(fake.overlays[0].map, null); assert.deepEqual(fake.overlays.at(-1).options.path, [{ lat: 0, lng: 170 }, { lat: 1, lng: -170 }]);
  surface.render({ ...f, bounds: null }); assert.deepEqual(fake.maps[0].center, { lat: 0, lng: 0 }); assert.equal(fake.maps[0].zoom, 1);
  surface.dispose(); assert.ok(fake.overlays.every(overlay => overlay.map === null)); assert.ok(fake.cleared.includes(fake.maps[0]));
});
test('empty exact panorama ID reports unavailable', () => {
  const fake = googleBoundary(); const errors: string[] = [];
  const adapter = googleAdapter(fake.root, fake.api, value => errors.push(value));
  const surface = adapter.panorama('left-view');
  surface.render({ lat: 0, lng: 0, panoId: '', heading: 0, pitch: 0, zoom: 0 });
  assert.deepEqual(errors, ['Exact Street View panorama unavailable']);
});
test('failed Google constructors clear loading slots', () => {
  const fake = googleBoundary(); const adapter = googleAdapter(fake.root, fake.api, assert.fail);
  fake.api.Map = class { constructor() { throw new Error('raw SDK error'); } } as unknown as typeof google.maps.Map;
  assert.throws(() => adapter.map('left-map'));
  assert.equal(fake.slots.get('#left-map')?.children.length, 0);
});

test('panorama recovery clears obsolete errors only after all failed visible surfaces recover or leave', () => {
  const fake = googleBoundary(); const statuses: string[] = [];
  const adapter = googleAdapter(fake.root, fake.api, () => statuses.push('pano-error'), () => statuses.push('api-ready'));
  const left = adapter.panorama('left-view'); const right = adapter.panorama('right-view');
  const p = { lat: 0, lng: 0, panoId: 'missing', heading: 0, pitch: 0, zoom: 0 };
  left.render(p); right.render(p);
  fake.requests[0].callback(null, 'ZERO_RESULTS'); fake.requests[1].callback(null, 'ZERO_RESULTS');
  left.render({ ...p, panoId: 'good-left' }); fake.requests[2].callback({ location: { pano: 'good-left' } }, 'OK');
  assert.equal(statuses.at(-1), 'pano-error');
  right.render({ ...p, panoId: 'good-right' }); fake.requests[3].callback({ location: { pano: 'good-right' } }, 'OK');
  assert.equal(statuses.at(-1), 'api-ready');
  left.render(p); fake.requests[4].callback(null, 'ZERO_RESULTS');
  assert.equal(statuses.at(-1), 'pano-error'); left.render(null); assert.equal(statuses.at(-1), 'api-ready');
  right.render(p); fake.requests[5].callback(null, 'ZERO_RESULTS');
  assert.equal(statuses.at(-1), 'pano-error'); right.dispose(); assert.equal(statuses.at(-1), 'api-ready');
});
