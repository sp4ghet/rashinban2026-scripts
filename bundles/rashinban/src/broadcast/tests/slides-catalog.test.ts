import assert from "node:assert/strict";
import test from "node:test";
import { SLIDE_SEQUENCES, SLIDE_MODES, adjacentSlideIndex, slideCue } from "../slides.ts";
import { INTERVAL_SLIDES, shuffledIntervalSlides } from "../../interval/slides.ts";

test("interval shuffle visits every image once without changing the source catalog", () => {
  const original = [...INTERVAL_SLIDES];
  const shuffled = shuffledIntervalSlides(() => 0);
  assert.notDeepEqual(shuffled, original);
  assert.equal(shuffled.length, original.length);
  assert.deepEqual(new Set(shuffled), new Set(original));
  assert.deepEqual(INTERVAL_SLIDES, original);
});

test("script places bracket after Day 2 tie range and before prizes, and first in Day 1 ending", () => {
  const opening = SLIDE_SEQUENCES["day2-opening"];
  const index = opening.findIndex(cue => cue.kind === "bracket");
  assert.equal((opening[index - 1] as any).file, "DAY2 TIE RANGE.png");
  assert.equal((opening[index + 1] as any).file, "PRIZE POOL-1.png");
  assert.equal(SLIDE_SEQUENCES["day1-ending"][0].kind, "bracket");
  assert.equal((SLIDE_SEQUENCES["day1-ending"][2] as any).file, "day2スケジュール.png");
});

test("manual sequences stop at a clear cue and navigation never wraps", () => {
  for (const mode of SLIDE_MODES) {
    const last = SLIDE_SEQUENCES[mode].length - 1;
    assert.equal(adjacentSlideIndex({ mode, visible: true, index: 0 }, -1), 0);
    assert.equal(adjacentSlideIndex({ mode, visible: true, index: last }, 1), last);
    assert.equal(slideCue({ mode, index: last }).kind, "clear");
  }
});

test("sponsor modes follow Tamura company, service and recruitment before Voicemod", () => {
  const one = SLIDE_SEQUENCES["one-sponsor"];
  assert.deepEqual(one.slice(0, 3).map(cue => (cue as any).file), [
    "スポンサー紹介 - 田村ビルズ様.png", "スポンサー紹介-田村ビルズ様-サービス紹介.png", "スポンサー紹介-田村ビルズ様-採用.png",
  ]);
  assert.deepEqual(SLIDE_SEQUENCES["two-sponsors"].slice(0, 3), one.slice(0, 3));
  assert.ok(SLIDE_SEQUENCES["two-sponsors"].some(cue => cue.kind === "clear" && cue.label.includes("demonstration")));
});
