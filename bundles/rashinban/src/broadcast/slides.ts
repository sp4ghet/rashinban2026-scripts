// Script: 配信資料_RASHINBAN2026, slides 3–6, 12–13, 16–21, 30–39.
// Original artwork is served locally; see docs/slides/assets.json for provenance.
export const SLIDE_MODES = ["day1-opening", "day2-opening", "day1-ending", "day2-ending", "two-sponsors", "one-sponsor"] as const;
export type SlideMode = typeof SLIDE_MODES[number];
export type SlidesLayer = { visible: boolean; mode: SlideMode; index: number };
export const MODE_LABELS: Record<SlideMode, string> = {
  "day1-opening": "DAY 1 OPENING", "day2-opening": "DAY 2 OPENING",
  "day1-ending": "DAY 1 ENDING", "day2-ending": "DAY 2 ENDING",
  "two-sponsors": "2 SPONSORS", "one-sponsor": "1 SPONSOR",
};
export type SlideCue =
  | { kind: "image"; label: string; file: string }
  | { kind: "bracket" | "clear"; label: string };
const image = (file: string, label = file.replace(/\.png$/i, "")): SlideCue => ({ kind: "image", label, file });
const bracket: SlideCue = { kind: "bracket", label: "BRACKET · live tournament bracket" };
const clear: SlideCue = { kind: "clear", label: "CLEAR · return to talk / cameras" };
const intro = [
  image("What is geoguessr_-1.png", "What is GeoGuessr? 1"),
  image("What is geoguessr_-2.png", "What is GeoGuessr? 2"),
  image("GAME MODES.png"),
  ...[1, 2, 3, 4].map(n => image(`What is duels_-${n}.png`, `What is Duels? ${n}`)),
];
const tournament = [image("RASHINBAN.png"), image("TOURNAMENT SCHEDULE.png", "TOURNAMENT · format")];
const prizes = [image("PRIZE POOL-1.png"), image("PRIZE POOL-2.png"), image("企業賞-田村ビルズ様.png", "Corporate award · Tamura Builds")];
const sponsors = [image("SPONSOR.png"), image("COMMUNITY PARTNER.png")];
const bonus = [image("副賞紹介-Voicemod様.png", "Bonus prize · Voicemod"), image("副賞紹介時-味の素様.png", "Bonus prize · Ajinomoto")];
const tamura = [
  image("スポンサー紹介 - 田村ビルズ様.png", "Tamura Builds 1 · company"),
  image("スポンサー紹介-田村ビルズ様-サービス紹介.png", "Tamura Builds 2 · service"),
  image("スポンサー紹介-田村ビルズ様-採用.png", "Tamura Builds 3 · recruitment"),
];
export const SLIDE_SEQUENCES: Record<SlideMode, readonly SlideCue[]> = {
  "day1-opening": [
    ...intro, image("DAY1 GAME MODES & MAPS.png"), ...tournament,
    image("DAY1 REGULATION.png"), image("DAY1 TIE RANGE.png"),
    ...prizes, ...bonus, ...sponsors, image("day1スケジュール.png", "DAY 1 · broadcast schedule"), clear,
  ],
  "day2-opening": [
    ...intro, ...tournament, image("DAY2 GAME MODES & MAP POOL.png"), image("DAY2 BAN & PICK.png"),
    image("DAY2 PINPOINTING DUELS.png"), image("DAY2 REGULATION - MOVE.png"),
    image("DAY2 REGULATION - NM,NMPZ.png"), image("DAY2 TIE RANGE.png"),
    bracket, ...prizes, ...sponsors, ...bonus,
    { kind: "clear", label: "TOP 8 introductions · use player controls" },
    image("day2スケジュール.png", "DAY 2 · broadcast schedule"), clear,
  ],
  "day1-ending": [bracket, image("SPONSOR.png"), image("day2スケジュール.png", "Tomorrow · DAY 2 schedule"), clear],
  "day2-ending": [
    image("企業賞-田村ビルズ様.png", "Corporate award · Tamura Builds"),
    image("表彰時-副賞紹介.png", "Awards ceremony · bonus prizes"),
    { kind: "clear", label: "Organizer address · return to cameras" },
    image("SPONSOR.png"), clear,
  ],
  "two-sponsors": [
    ...tamura, image("スポンサー紹介-VOICEMOD様.png", "Voicemod 1 · overview"),
    { kind: "clear", label: "Voicemod demonstration · return to cameras" },
    image("スポンサー紹介-Voicemod様-副賞紹介.png", "Voicemod 2 · product and trial"),
    image("副賞紹介-Voicemod様.png", "Voicemod 3 · bonus prize"), clear,
  ],
  "one-sponsor": [...tamura, clear],
};
export function slideCue(layer: Pick<SlidesLayer, "mode" | "index">): SlideCue {
  return SLIDE_SEQUENCES[layer.mode][layer.index] ?? clear;
}
export function slideUrl(file: string): string {
  return "/bundles/rashinban/graphics/assets/stream-slides/" + encodeURIComponent(file);
}
export function validSlideIndex(mode: SlideMode, index: unknown): index is number {
  return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < SLIDE_SEQUENCES[mode].length;
}
/** Navigation clamps at each end. The final cue explicitly clears the slide. */
export function adjacentSlideIndex(layer: SlidesLayer, direction: -1 | 1): number {
  return Math.max(0, Math.min(SLIDE_SEQUENCES[layer.mode].length - 1, layer.index + direction));
}
/** Image and bracket changes are one preview patch, committed by one TAKE. */
export function slideSelection(mode: SlideMode, index: number, visible = true) {
  const slides = { mode, index, visible };
  return { slides, bracket: { visible: visible && slideCue(slides).kind === "bracket" },
    ...(visible ? { interval: { visible: false } } : {}) };
}
