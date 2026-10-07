# Broadcast Pages and Switcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the eight per-overlay graphic pages with four output pages (stream presenter, LED presenter, stream info, LED info) whose layers are switched from a preview/program/TAKE dashboard, one workspace per output.

**Architecture:** A new `broadcast` replicant holds a `program` and a `preview` layer set per output. A pure reducer in `src/broadcast/` validates patches, takes, and reverts; the extension exposes it as NodeCG messages and Companion HTTP routes. Overlay markup moves into layer modules under `src/graphics/layers/` that the two info pages compose; the presenter gets an LED layout and an `led` client role. Two identical switcher panels (parameterised by output) show preview/program monitors as scaled iframes and edit preview only.

**Tech Stack:** NodeCG 2 bundle, TypeScript (strict, `.ts` imports), esbuild, `node:test` + `node:assert/strict`, vanilla DOM. Design: `docs/plans/2026-10-07-broadcast-switcher-design.md`.

**Conventions to follow:**
- Run everything from the worktree root `.worktrees/broadcast-switcher`.
- Tests: `npm test` runs the globs listed in `package.json`. Run one file with
  `node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test <file>`.
- `npm run typecheck` must pass after every task. `npm run build` must pass after any graphics/dashboard task.
- Browser entries: every `.ts` directly inside `src/graphics/` or `src/dashboard/` becomes a bundle. Helpers go in subdirectories.
- Keep content ASCII in shell heredocs (see memory); use the Write tool for files with non-ASCII text.
- Commit after each task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Task 1: Broadcast state reducer

**Files:**
- Create: `bundles/rashinban/src/broadcast/state.ts`
- Create: `bundles/rashinban/src/broadcast/tests/state.test.ts`
- Modify: `package.json` (test globs)

**Step 1: Add the test glob**

In `package.json`, inside the `"test"` script string, append
` \"bundles/rashinban/src/broadcast/tests/**/*.test.ts\"` after the bracket glob (keep the escaped quotes consistent with the others).

**Step 2: Write the failing tests**

`bundles/rashinban/src/broadcast/tests/state.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  BroadcastError,
  createInitialState,
  cutProgram,
  layersEqual,
  revertPreview,
  setPreview,
  take,
  withDefaults,
} from "../state.ts";

test("initial state hides every layer on both buses and keeps the caster title bar on", () => {
  const s = createInitialState();
  assert.deepEqual(s.stream.program, s.stream.preview);
  assert.deepEqual(s.led.program, s.led.preview);
  assert.equal(s.stream.program.playerCards.visible, false);
  assert.equal(s.stream.program.playerCards.page, "profile");
  assert.equal(s.stream.program.lowerThird.mode, "match");
  assert.equal(s.stream.program.casters.titleBar, true);
  assert.deepEqual(s.stream.program.casters.slots, [false, false]);
  assert.equal(s.led.program.presenter.visible, false);
  assert.equal(s.led.program.banpick.visible, false);
});

test("setPreview deep-merges a partial into preview only", () => {
  const s = setPreview(createInitialState(), "stream", { playerCards: { visible: true }, lowerThird: { title: "Hello" } });
  assert.equal(s.stream.preview.playerCards.visible, true);
  assert.equal(s.stream.preview.playerCards.page, "profile");
  assert.equal(s.stream.preview.lowerThird.title, "Hello");
  assert.equal(s.stream.preview.lowerThird.mode, "match");
  assert.equal(s.stream.program.playerCards.visible, false);
  assert.equal(s.led.preview.playerCards.visible, false);
});

test("setPreview rejects unknown keys, wrong types, bad enums, and overlong text", () => {
  const s = createInitialState();
  assert.throws(() => setPreview(s, "stream", { bogus: {} } as any), BroadcastError);
  assert.throws(() => setPreview(s, "stream", { playerCards: { visible: "yes" } } as any), BroadcastError);
  assert.throws(() => setPreview(s, "stream", { playerCards: { page: "bio" } } as any), BroadcastError);
  assert.throws(() => setPreview(s, "stream", { casters: { slots: [true] } } as any), BroadcastError);
  assert.throws(() => setPreview(s, "stream", { lowerThird: { title: "x".repeat(121) } }), BroadcastError);
  assert.throws(() => setPreview(s, "led", { lowerThird: { visible: true } } as any), BroadcastError);
  assert.throws(() => setPreview(s, "tv" as any, {}), BroadcastError);
  assert.throws(() => setPreview(s, "stream", null as any), BroadcastError);
});

test("take copies preview onto program for one output and leaves the other untouched", () => {
  let s = setPreview(createInitialState(), "led", { banpick: { visible: true }, presenter: { visible: true } });
  s = setPreview(s, "stream", { banpick: { visible: true } });
  s = take(s, "led");
  assert.equal(s.led.program.banpick.visible, true);
  assert.equal(s.led.program.presenter.visible, true);
  assert.equal(s.stream.program.banpick.visible, false);
  assert.notEqual(s.led.program, s.led.preview, "take must copy, not alias");
});

test("revertPreview copies program back onto preview", () => {
  let s = setPreview(createInitialState(), "stream", { playerCards: { visible: true } });
  s = take(s, "stream");
  s = setPreview(s, "stream", { playerCards: { visible: false }, lowerThird: { visible: true } });
  s = revertPreview(s, "stream");
  assert.equal(s.stream.preview.playerCards.visible, true);
  assert.equal(s.stream.preview.lowerThird.visible, false);
});

test("cutProgram merges straight into program and validates like setPreview", () => {
  const s = cutProgram(createInitialState(), "stream", { casters: { slots: [true, false] } });
  assert.deepEqual(s.stream.program.casters.slots, [true, false]);
  assert.deepEqual(s.stream.preview.casters.slots, [false, false]);
  assert.throws(() => cutProgram(s, "stream", { casters: { slots: "on" } } as any), BroadcastError);
});

test("withDefaults repairs missing or malformed persisted state without throwing", () => {
  assert.deepEqual(withDefaults(undefined), createInitialState());
  assert.deepEqual(withDefaults({ stream: { program: { playerCards: { visible: true } } } }).stream.program.playerCards, { visible: true, page: "profile" });
  assert.deepEqual(withDefaults({ led: 5 }).led, createInitialState().led);
  assert.deepEqual(withDefaults({ stream: { preview: { lowerThird: { title: 42 } } } }).stream.preview.lowerThird.title, "");
});

test("layersEqual compares structurally", () => {
  const s = createInitialState();
  assert.equal(layersEqual(s.stream.program, s.stream.preview), true);
  assert.equal(layersEqual(s.stream.program, setPreview(s, "stream", { banpick: { visible: true } }).stream.preview), false);
});
```

**Step 3: Run the tests to verify they fail**

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test bundles/rashinban/src/broadcast/tests/state.test.ts`
Expected: FAIL, cannot find module `../state.ts`.

**Step 4: Write the implementation**

`bundles/rashinban/src/broadcast/state.ts`:

```ts
// Broadcast buses: what each output (stream, LED) shows on air (program) and
// what its operator is lining up (preview). Pure functions; the extension
// owns the replicant, the dashboard edits preview, TAKE copies it to program.

export type BroadcastOutput = "stream" | "led";
export const BROADCAST_OUTPUTS: readonly BroadcastOutput[] = ["stream", "led"];

export type CardPage = "profile" | "stats";
export type PlayerCardsLayer = { visible: boolean; page: CardPage };
export type LowerThirdLayer = { visible: boolean; mode: "match" | "text"; title: string; subtitle: string };
export type CastersLayer = { titleBar: boolean; slots: [boolean, boolean] };
export type ToggleLayer = { visible: boolean };

export type StreamLayers = {
  playerCards: PlayerCardsLayer;
  lowerThird: LowerThirdLayer;
  casters: CastersLayer;
  banpick: ToggleLayer;
};
export type LedLayers = {
  playerCards: PlayerCardsLayer;
  banpick: ToggleLayer;
  presenter: ToggleLayer;
};
export type LayersFor<O extends BroadcastOutput> = O extends "stream" ? StreamLayers : LedLayers;
export type OutputBus<L> = { program: L; preview: L };
export type BroadcastState = { stream: OutputBus<StreamLayers>; led: OutputBus<LedLayers> };

/** Recursive patch type: every leaf optional. */
export type Patch<L> = { [K in keyof L]?: L[K] extends object ? (L[K] extends readonly unknown[] ? L[K] : Patch<L[K]>) : L[K] };

export class BroadcastError extends Error {}

export const MAX_TEXT = 120;

// ---- Schema -----------------------------------------------------------------
// Each leaf names its validator; objects nest. Arrays are described by
// "booleanPair" because the only array in the buses is the caster slot pair.
type Leaf = "boolean" | "text" | "booleanPair" | readonly string[];
type Spec = { [key: string]: Leaf | Spec };
const CARD_SPEC = { visible: "boolean", page: ["profile", "stats"] } as const satisfies Spec;
const TOGGLE_SPEC = { visible: "boolean" } as const satisfies Spec;
const STREAM_SPEC = {
  playerCards: CARD_SPEC,
  lowerThird: { visible: "boolean", mode: ["match", "text"], title: "text", subtitle: "text" },
  casters: { titleBar: "boolean", slots: "booleanPair" },
  banpick: TOGGLE_SPEC,
} as const satisfies Spec;
const LED_SPEC = { playerCards: CARD_SPEC, banpick: TOGGLE_SPEC, presenter: TOGGLE_SPEC } as const satisfies Spec;
const SPECS: Record<BroadcastOutput, Spec> = { stream: STREAM_SPEC, led: LED_SPEC };

function isLeaf(spec: Leaf | Spec): spec is Leaf { return typeof spec === "string" || Array.isArray(spec); }

function defaultFor(spec: Leaf | Spec): unknown {
  if (spec === "boolean") return false;
  if (spec === "text") return "";
  if (spec === "booleanPair") return [false, false];
  if (Array.isArray(spec)) return spec[0];
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(spec as Spec)) out[key] = defaultFor(child);
  return out;
}

function validLeaf(spec: Leaf, value: unknown): boolean {
  if (spec === "boolean") return typeof value === "boolean";
  if (spec === "text") return typeof value === "string" && value.length <= MAX_TEXT;
  if (spec === "booleanPair") return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "boolean");
  return typeof value === "string" && (spec as readonly string[]).includes(value);
}

/** Deep-merge `patch` onto `base` following `spec`; throws on anything the spec does not describe. */
function merge(spec: Spec, base: Record<string, unknown>, patch: unknown, path = ""): Record<string, unknown> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new BroadcastError(`${path || "patch"} must be an object`);
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const child = spec[key];
    const here = path ? `${path}.${key}` : key;
    if (!child) throw new BroadcastError(`unknown field ${here}`);
    if (isLeaf(child)) {
      if (!validLeaf(child, value)) throw new BroadcastError(`invalid value for ${here}`);
      out[key] = Array.isArray(value) ? [...value] : value;
    } else {
      out[key] = merge(child, base[key] as Record<string, unknown>, value, here);
    }
  }
  return out;
}

/** Lenient repair for persisted data: keeps valid leaves, replaces the rest. */
function repair(spec: Spec, value: unknown): Record<string, unknown> {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(spec)) {
    out[key] = isLeaf(child)
      ? validLeaf(child, source[key]) ? (Array.isArray(source[key]) ? [...(source[key] as unknown[])] : source[key]) : defaultFor(child)
      : repair(child, source[key]);
  }
  return out;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function parseOutput(output: unknown): BroadcastOutput {
  if (output !== "stream" && output !== "led") throw new BroadcastError("output must be stream or led");
  return output;
}

// ---- Public API -------------------------------------------------------------

export function defaultLayers<O extends BroadcastOutput>(output: O): LayersFor<O> {
  return defaultFor(SPECS[output]) as LayersFor<O>;
}

export function createInitialState(): BroadcastState {
  return {
    stream: { program: defaultLayers("stream"), preview: defaultLayers("stream") },
    led: { program: defaultLayers("led"), preview: defaultLayers("led") },
  };
}

export function withDefaults(value: unknown): BroadcastState {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const bus = <O extends BroadcastOutput>(output: O): OutputBus<LayersFor<O>> => {
    const raw = typeof source[output] === "object" && source[output] !== null ? (source[output] as Record<string, unknown>) : {};
    return { program: repair(SPECS[output], raw.program) as LayersFor<O>, preview: repair(SPECS[output], raw.preview) as LayersFor<O> };
  };
  return { stream: bus("stream"), led: bus("led") };
}

export function mergeLayers<O extends BroadcastOutput>(output: O, base: LayersFor<O>, patch: Patch<LayersFor<O>>): LayersFor<O> {
  return merge(SPECS[parseOutput(output)], base as Record<string, unknown>, patch) as LayersFor<O>;
}

export function setPreview<O extends BroadcastOutput>(state: BroadcastState, output: O, patch: Patch<LayersFor<O>>): BroadcastState {
  const o = parseOutput(output);
  const next = copy(state);
  (next[o] as OutputBus<unknown>).preview = mergeLayers(o, state[o].preview as LayersFor<typeof o>, patch as Patch<LayersFor<typeof o>>);
  return next;
}

export function cutProgram<O extends BroadcastOutput>(state: BroadcastState, output: O, patch: Patch<LayersFor<O>>): BroadcastState {
  const o = parseOutput(output);
  const next = copy(state);
  (next[o] as OutputBus<unknown>).program = mergeLayers(o, state[o].program as LayersFor<typeof o>, patch as Patch<LayersFor<typeof o>>);
  return next;
}

export function take(state: BroadcastState, output: BroadcastOutput): BroadcastState {
  const o = parseOutput(output);
  const next = copy(state);
  (next[o] as OutputBus<unknown>).program = copy(state[o].preview);
  return next;
}

export function revertPreview(state: BroadcastState, output: BroadcastOutput): BroadcastState {
  const o = parseOutput(output);
  const next = copy(state);
  (next[o] as OutputBus<unknown>).preview = copy(state[o].program);
  return next;
}

export function layersEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
```

**Step 5: Run the tests to verify they pass**

Run the same command as Step 3. Expected: all 8 tests pass. Then `npm run typecheck` (expected: clean).

**Step 6: Commit**

```bash
git add package.json bundles/rashinban/src/broadcast
git commit -m "feat(broadcast): add preview/program bus reducer"
```

---

## Task 2: Move visibility out of the content replicants

Removes `BanPickState.visible`, the `playerCards` replicant, and `CasterSlot.enabled`, and registers the `broadcast` replicant and messages. Dashboard and graphics files that break here are rewritten in later tasks; this task only needs `npm test` green and `npm run typecheck` green for the non-browser code, so temporarily expect typecheck errors in `src/dashboard/` and `src/graphics/` until Tasks 5 to 10 (list them in the commit message).

**Files:**
- Modify: `bundles/rashinban/src/types/replicants.ts`
- Modify: `bundles/rashinban/src/banpick/rules.ts:33,69`
- Modify: `bundles/rashinban/src/casters/casters.ts`
- Modify: `bundles/rashinban/src/sheet/types.ts:25-28` (delete `PlayerCardsState`)

**Step 1: Write the failing test for casters**

Append to a new file `bundles/rashinban/src/casters/tests/casters.test.ts` (add the glob `"bundles/rashinban/src/casters/tests/**/*.test.ts"` to the test script in `package.json`):

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { withDefaults, withSheetDefaults } from "../casters.ts";

test("withDefaults keeps names and drops the old enabled flag", () => {
  const state = withDefaults({ slots: [{ name: "A", enabled: true } as any, undefined as any] });
  assert.deepEqual(state, { slots: [{ name: "A" }, { name: "" }] });
});

test("withSheetDefaults fills empty slots from sheet order", () => {
  const state = withSheetDefaults({ slots: [{ name: "" }, { name: "Z" }] }, [{ role: "r", name: "A", twitter: "" }, { role: "r", name: "B", twitter: "" }]);
  assert.deepEqual(state, { slots: [{ name: "A" }, { name: "Z" }] });
});
```

**Step 2: Run it to verify it fails**

Expected: FAIL (deepEqual sees `enabled`).

**Step 3: Implement**

`casters.ts`: change `CasterSlot` to `{ name: string }`, `EMPTY_SLOT = { name: "" }`, delete `enabled` from `withDefaults` (return `{ name: ... }`) and from `withSheetDefaults` (`return fallback ? { name: fallback.name } : { ...slot }`). Update the file header comment: on-air state now lives in the broadcast bus.

`banpick/rules.ts`: delete the `visible: boolean;` field (line 33) and the `visible: false,` default (line 69).

`sheet/types.ts`: delete the `PlayerCardsState` interface.

`types/replicants.ts`:
- Add `import type { BroadcastState } from "../broadcast/state.ts";` and remove the `PlayerCardsState` import (keep `SheetConfig, SheetStatus`).
- In `REPLICANTS` delete `playerCards: "playerCards",` and add `broadcast: "broadcast",`.
- In `ReplicantMap` delete the `playerCards` line and add `[REPLICANTS.broadcast]: BroadcastState;`.
- Delete `setVisible` from `BANPICK_MESSAGES` and delete the whole `PLAYERCARDS_MESSAGES` block.
- Change the `CASTERS_MESSAGES` comment to `/** Caster cards. { slot: 0 | 1, name: string } */`.
- Add:

```ts
/** Broadcast buses. output is "stream" | "led". */
export const BROADCAST_MESSAGES = {
  /** { output, patch: Patch<Layers> } — edit preview. */
  setPreview: "broadcast:setPreview",
  /** { output } — program = preview. */
  take: "broadcast:take",
  /** { output } — preview = program. */
  revertPreview: "broadcast:revertPreview",
} as const;
```

**Step 4: Run tests**

`npm test` expected: all pass (rules tests never used `visible`). `npm run typecheck` will list errors only in `src/extension/{banpick,casters,playercards}.ts`, `src/dashboard/{banpick-control,casters-control,player-cards-control}.ts`, and `src/graphics/{banpick-*,casters,player-cards}.ts`. Anything else must be fixed now.

**Step 5: Commit**

```bash
git add -A bundles/rashinban/src package.json
git commit -m "refactor: move on-air visibility out of content replicants

Typecheck is red in extension/dashboard/graphics entries until the
broadcast extension, layers, and switcher land."
```

---

## Task 3: Broadcast extension and Companion routes

**Files:**
- Create: `bundles/rashinban/src/extension/broadcast.ts`
- Create: `bundles/rashinban/src/broadcast/tests/register.test.ts`
- Modify: `bundles/rashinban/src/extension/banpick.ts`
- Modify: `bundles/rashinban/src/extension/casters.ts`
- Delete: `bundles/rashinban/src/extension/playercards.ts`
- Modify: `bundles/rashinban/src/extension/index.ts`

**Step 1: Write the failing tests**

`bundles/rashinban/src/broadcast/tests/register.test.ts` (the fake NodeCG mirrors `config/tests/register.test.ts` without the ownership proxy):

```ts
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import type NodeCG from "@nodecg/types";
import { registerBroadcast } from "../../extension/broadcast.ts";
import { BROADCAST_MESSAGES, REPLICANTS } from "../../types/replicants.ts";

type Handler = (data: unknown, ack?: (error: unknown, value?: unknown) => void) => void;
function fakeNodecg() {
  const replicants = new Map<string, EventEmitter & { value: any }>();
  const listeners = new Map<string, Handler>();
  const http = express();
  const nodecg = {
    Replicant(name: string, options: any = {}) {
      let rep = replicants.get(name);
      if (rep) return rep;
      let stored = options.defaultValue;
      rep = Object.assign(new EventEmitter(), {}) as EventEmitter & { value: any };
      Object.defineProperty(rep, "value", { get: () => stored, set(next) { stored = next; rep!.emit("change", next); } });
      replicants.set(name, rep);
      return rep;
    },
    listenFor(name: string, handler: Handler) { listeners.set(name, handler); },
    Router: express.Router,
    mount(route: string, router: express.Router) { http.use(route, router); },
    log: { info() {}, warn() {}, error() {} },
  } as unknown as NodeCG.ServerAPI;
  function message(name: string, data?: unknown) {
    let response = { error: undefined as unknown, value: undefined as unknown };
    listeners.get(name)?.(data, (error, value) => { response = { error, value }; });
    return response;
  }
  return { nodecg, replicants, message, http };
}
function app() {
  const fake = fakeNodecg();
  const router = express.Router();
  registerBroadcast(fake.nodecg, router);
  fake.nodecg.mount("/rashinban", router);
  const state = () => fake.replicants.get(REPLICANTS.broadcast)!.value;
  return { ...fake, state };
}

test("setPreview, take and revert go through the reducer and ack the new state", () => {
  const a = app();
  const edited = a.message(BROADCAST_MESSAGES.setPreview, { output: "stream", patch: { banpick: { visible: true } } });
  assert.equal(edited.error, null);
  assert.equal(a.state().stream.preview.banpick.visible, true);
  assert.equal(a.state().stream.program.banpick.visible, false);
  assert.equal(a.message(BROADCAST_MESSAGES.take, { output: "stream" }).error, null);
  assert.equal(a.state().stream.program.banpick.visible, true);
  a.message(BROADCAST_MESSAGES.setPreview, { output: "stream", patch: { banpick: { visible: false } } });
  assert.equal(a.message(BROADCAST_MESSAGES.revertPreview, { output: "stream" }).error, null);
  assert.equal(a.state().stream.preview.banpick.visible, true);
});

test("invalid payloads are rejected via the ack and leave state unchanged", () => {
  const a = app();
  const before = JSON.stringify(a.state());
  assert.ok(a.message(BROADCAST_MESSAGES.setPreview, { output: "stream", patch: { nope: 1 } }).error instanceof Error);
  assert.ok(a.message(BROADCAST_MESSAGES.take, { output: "radio" }).error instanceof Error);
  assert.ok(a.message(BROADCAST_MESSAGES.setPreview, "junk").error instanceof Error);
  assert.equal(JSON.stringify(a.state()), before);
});

test("Companion routes cut the stream program directly and take/revert per output", async () => {
  const a = app();
  const server = a.http.listen(0);
  const port = (server.address() as AddressInfo).port;
  const post = async (path: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/rashinban${path}`, { method: "POST" });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await post("/banpick/toggle")).body.banpick.visible, true);
    assert.equal(a.state().stream.program.banpick.visible, true);
    assert.equal(a.state().stream.preview.banpick.visible, false);
    assert.equal((await post("/playercards/show")).body.playerCards.visible, true);
    assert.equal((await post("/playercards/flip")).body.playerCards.page, "stats");
    assert.deepEqual((await post("/casters/2/show")).body.casters.slots, [false, true]);
    assert.deepEqual((await post("/casters/2/toggle")).body.casters.slots, [false, false]);
    a.message(BROADCAST_MESSAGES.setPreview, { output: "led", patch: { presenter: { visible: true } } });
    assert.equal((await post("/broadcast/led/take")).body.presenter.visible, true);
    assert.equal(a.state().led.program.presenter.visible, true);
    assert.equal((await post("/broadcast/led/revert")).status, 200);
    assert.equal((await post("/broadcast/radio/take")).status, 400);
  } finally {
    server.close();
  }
});
```

**Step 2: Run to verify failure**

Expected: FAIL, cannot find `../../extension/broadcast.ts`.

**Step 3: Implement the extension**

`bundles/rashinban/src/extension/broadcast.ts`:

```ts
// Broadcast buses: preview/program per output, TAKE and revert, plus the
// Companion routes that used to live on the content replicants. Companion
// has no preview, so its routes cut program directly.
import type NodeCG from "@nodecg/types";
import type { Request, Response } from "express";

import {
  BROADCAST_OUTPUTS,
  BroadcastError,
  createInitialState,
  cutProgram,
  revertPreview,
  setPreview,
  take,
  withDefaults,
  type BroadcastOutput,
  type BroadcastState,
} from "../broadcast/state.ts";
import { BROADCAST_MESSAGES, REPLICANTS } from "../types/replicants.ts";

type Ack = NodeCG.Acknowledgement | undefined;

export function registerBroadcast(nodecg: NodeCG.ServerAPI, router: ReturnType<NodeCG.ServerAPI["Router"]>) {
  const rep = nodecg.Replicant<BroadcastState>(REPLICANTS.broadcast, { defaultValue: createInitialState() });
  rep.value = withDefaults(rep.value);
  const current = () => withDefaults(rep.value);

  function mutate(ack: Ack, fn: (state: BroadcastState) => BroadcastState): BroadcastState | null {
    try {
      rep.value = fn(current());
      if (ack && !ack.handled) ack(null, rep.value);
      return rep.value;
    } catch (error) {
      if (!(error instanceof BroadcastError)) throw error;
      nodecg.log.warn(`broadcast: rejected: ${error.message}`);
      if (ack && !ack.handled) ack(error);
      return null;
    }
  }
  const record = (data: unknown): Record<string, unknown> => {
    if (typeof data !== "object" || data === null) throw new BroadcastError("payload must be an object");
    return data as Record<string, unknown>;
  };
  const output = (value: unknown): BroadcastOutput => {
    if (!BROADCAST_OUTPUTS.includes(value as BroadcastOutput)) throw new BroadcastError("output must be stream or led");
    return value as BroadcastOutput;
  };

  nodecg.listenFor(BROADCAST_MESSAGES.setPreview, (data: unknown, ack) =>
    mutate(ack, (s) => { const body = record(data); return setPreview(s, output(body.output), body.patch as never); }));
  nodecg.listenFor(BROADCAST_MESSAGES.take, (data: unknown, ack) =>
    mutate(ack, (s) => take(s, output(record(data).output))));
  nodecg.listenFor(BROADCAST_MESSAGES.revertPreview, (data: unknown, ack) =>
    mutate(ack, (s) => revertPreview(s, output(record(data).output))));

  // ---- Companion (Generic HTTP) ---------------------------------------------
  function respond(res: Response, out: BroadcastOutput, fn: (state: BroadcastState) => BroadcastState) {
    try {
      rep.value = fn(current());
      res.json(rep.value[out].program);
    } catch (error) {
      if (!(error instanceof BroadcastError)) throw error;
      res.status(400).json({ error: error.message });
    }
  }
  const outputParam = (req: Request, res: Response): BroadcastOutput | null => {
    const value = req.params.output;
    if (BROADCAST_OUTPUTS.includes(value as BroadcastOutput)) return value as BroadcastOutput;
    res.status(400).json({ error: "output must be stream or led" });
    return null;
  };
  router.post("/broadcast/:output/take", (req, res) => { const out = outputParam(req, res); if (out) respond(res, out, (s) => take(s, out)); });
  router.post("/broadcast/:output/revert", (req, res) => { const out = outputParam(req, res); if (out) respond(res, out, (s) => revertPreview(s, out)); });

  const stream = () => current().stream.program;
  const cut = (res: Response, patch: Parameters<typeof cutProgram<"stream">>[2]) => respond(res, "stream", (s) => cutProgram(s, "stream", patch));
  router.post("/banpick/show", (_req, res) => cut(res, { banpick: { visible: true } }));
  router.post("/banpick/hide", (_req, res) => cut(res, { banpick: { visible: false } }));
  router.post("/banpick/toggle", (_req, res) => cut(res, { banpick: { visible: !stream().banpick.visible } }));
  router.post("/playercards/show", (_req, res) => cut(res, { playerCards: { visible: true } }));
  router.post("/playercards/hide", (_req, res) => cut(res, { playerCards: { visible: false } }));
  router.post("/playercards/toggle", (_req, res) => cut(res, { playerCards: { visible: !stream().playerCards.visible } }));
  router.post("/playercards/profile", (_req, res) => cut(res, { playerCards: { page: "profile" } }));
  router.post("/playercards/stats", (_req, res) => cut(res, { playerCards: { page: "stats" } }));
  router.post("/playercards/flip", (_req, res) => cut(res, { playerCards: { page: stream().playerCards.page === "stats" ? "profile" : "stats" } }));
  for (const index of [0, 1] as const) {
    const slots = (value: boolean): [boolean, boolean] => { const next = [...stream().casters.slots] as [boolean, boolean]; next[index] = value; return next; };
    router.post(`/casters/${index + 1}/show`, (_req, res) => cut(res, { casters: { slots: slots(true) } }));
    router.post(`/casters/${index + 1}/hide`, (_req, res) => cut(res, { casters: { slots: slots(false) } }));
    router.post(`/casters/${index + 1}/toggle`, (_req, res) => cut(res, { casters: { slots: slots(!stream().casters.slots[index]) } }));
  }
}
```

If `Parameters<typeof cutProgram<"stream">>` does not typecheck, replace the `cut` parameter type with `Patch<StreamLayers>` imported from `../broadcast/state.ts`.

`extension/banpick.ts`: delete the `setVisible` listener, the `/banpick/show|hide|toggle` routes, and `visible` from `respond` (`res.json({ step: ..., complete: ... })`). Keep `/banpick/undo` and `/banpick/reset`.

`extension/casters.ts`: `CasterSlotEdit` becomes `{ slot: number; name?: string }`; `setSlot` writes only `name`; delete the Companion loop at the bottom.

Delete `extension/playercards.ts`. In `extension/index.ts` remove its import and call, add `import { registerBroadcast } from "./broadcast";` and call `registerBroadcast(nodecg, router);` right after `const router = nodecg.Router();`.

**Step 4: Run tests and typecheck**

`npm test` expected: all pass including the 3 new tests. `npm run typecheck`: only dashboard/graphics errors remain.

**Step 5: Commit**

```bash
git add -A bundles/rashinban/src/extension bundles/rashinban/src/broadcast
git commit -m "feat(broadcast): extension messages and Companion routes"
```

---

## Task 4: Channel helper, lower-third text, switcher model (pure, tested)

**Files:**
- Create: `bundles/rashinban/src/broadcast/channel.ts`
- Create: `bundles/rashinban/src/broadcast/lower-third.ts`
- Create: `bundles/rashinban/src/broadcast/switcher-model.ts`
- Create: `bundles/rashinban/src/broadcast/tests/channel.test.ts`
- Create: `bundles/rashinban/src/broadcast/tests/lower-third.test.ts`
- Create: `bundles/rashinban/src/broadcast/tests/switcher-model.test.ts`

**Step 1: Tests**

`channel.test.ts`:
```ts
import assert from "node:assert/strict";
import test from "node:test";
import { channelFromSearch } from "../channel.ts";
test("only ?channel=preview selects preview", () => {
  for (const s of ["", "?channel=program", "?channel=Preview", "?role=preview"]) assert.equal(channelFromSearch(s), "program");
  assert.equal(channelFromSearch("?channel=preview&role=preview"), "preview");
});
```

`lower-third.test.ts`:
```ts
import assert from "node:assert/strict";
import test from "node:test";
import { lowerThirdText } from "../lower-third.ts";
const match = { label: "Winners Final", left: { name: "Alice", handle: "alice" }, right: { name: "Bob", handle: "" } };
test("match mode names both players and uses the match label", () => {
  assert.deepEqual(lowerThirdText({ visible: true, mode: "match", title: "x", subtitle: "y" }, match), { title: "Alice vs Bob", subtitle: "Winners Final" });
});
test("match mode without a match falls back to placeholders", () => {
  assert.deepEqual(lowerThirdText({ visible: true, mode: "match", title: "", subtitle: "" }, null), { title: "TBD vs TBD", subtitle: "" });
});
test("text mode passes operator text through", () => {
  assert.deepEqual(lowerThirdText({ visible: true, mode: "text", title: "Break", subtitle: "Back in 10" }, match), { title: "Break", subtitle: "Back in 10" });
});
```

`switcher-model.test.ts`:
```ts
import assert from "node:assert/strict";
import test from "node:test";
import { controlRows, patchAt, rowDirty, valueAt } from "../switcher-model.ts";
import { createInitialState, setPreview } from "../state.ts";
test("patchAt builds a nested patch and valueAt reads one", () => {
  assert.deepEqual(patchAt(["lowerThird", "title"], "Hi"), { lowerThird: { title: "Hi" } });
  assert.equal(valueAt({ a: { b: 2 } }, ["a", "b"]), 2);
  assert.equal(valueAt({ a: { b: 2 } }, ["a", "zzz"]), undefined);
});
test("caster slot toggles patch the whole pair", () => {
  assert.deepEqual(patchAt(["casters", "slots", "1"], true, [false, false]), { casters: { slots: [false, true] } });
});
test("rowDirty is true when any control in the row differs between preview and program", () => {
  const s = setPreview(createInitialState(), "stream", { playerCards: { page: "stats" } });
  const rows = controlRows("stream");
  const cards = rows.find((r) => r.id === "playerCards")!;
  const banpick = rows.find((r) => r.id === "banpick")!;
  assert.equal(rowDirty(cards, s.stream.preview, s.stream.program), true);
  assert.equal(rowDirty(banpick, s.stream.preview, s.stream.program), false);
});
test("led rows expose presenter visibility and no lower third", () => {
  const ids = controlRows("led").map((r) => r.id);
  assert.deepEqual(ids, ["presenter", "playerCards", "banpick"]);
});
```

**Step 2: Run to verify failure** (module not found).

**Step 3: Implement**

`channel.ts`:
```ts
export type Channel = "program" | "preview";
/** Pages render program unless opened with ?channel=preview (switcher monitors). */
export function channelFromSearch(search: string): Channel {
  return new URLSearchParams(search).get("channel") === "preview" ? "preview" : "program";
}
```

`lower-third.ts`:
```ts
import type { LowerThirdLayer } from "./state.ts";
export type LowerThirdMatch = { label: string; left: { name: string; handle: string }; right: { name: string; handle: string } } | null;
const name = (side: { name: string } | undefined) => side?.name?.trim() || "TBD";
export function lowerThirdText(layer: LowerThirdLayer, match: LowerThirdMatch): { title: string; subtitle: string } {
  if (layer.mode === "text") return { title: layer.title, subtitle: layer.subtitle };
  return { title: `${name(match?.left)} vs ${name(match?.right)}`, subtitle: match?.label ?? "" };
}
```

`switcher-model.ts`:
```ts
// Declarative description of the switcher's layer strip, shared by both
// outputs. The panel renders rows from this; tests check the data logic.
import type { BroadcastOutput } from "./state.ts";

export type Control =
  | { kind: "toggle"; path: string[]; label: string }
  | { kind: "select"; path: string[]; label: string; options: [string, string][] }
  | { kind: "text"; path: string[]; label: string };
export type Row = { id: string; title: string; controls: Control[] };

const PAGE: Control = { kind: "select", path: ["playerCards", "page"], label: "Page", options: [["profile", "Profile"], ["stats", "Stats"]] };
const CARDS: Row = { id: "playerCards", title: "Player cards", controls: [{ kind: "toggle", path: ["playerCards", "visible"], label: "Visible" }, PAGE] };
const BANPICK: Row = { id: "banpick", title: "Ban & Pick", controls: [{ kind: "toggle", path: ["banpick", "visible"], label: "Visible" }] };

const STREAM_ROWS: Row[] = [
  CARDS,
  { id: "lowerThird", title: "Lower third", controls: [
    { kind: "toggle", path: ["lowerThird", "visible"], label: "Visible" },
    { kind: "select", path: ["lowerThird", "mode"], label: "Mode", options: [["match", "Current match"], ["text", "Free text"]] },
    { kind: "text", path: ["lowerThird", "title"], label: "Title" },
    { kind: "text", path: ["lowerThird", "subtitle"], label: "Subtitle" },
  ] },
  { id: "casters", title: "Casters", controls: [
    { kind: "toggle", path: ["casters", "titleBar"], label: "Title bar + banner" },
    { kind: "toggle", path: ["casters", "slots", "0"], label: "Left card" },
    { kind: "toggle", path: ["casters", "slots", "1"], label: "Right card" },
  ] },
  BANPICK,
];
const LED_ROWS: Row[] = [
  { id: "presenter", title: "Presenter", controls: [{ kind: "toggle", path: ["presenter", "visible"], label: "Visible" }] },
  CARDS,
  BANPICK,
];
export function controlRows(output: BroadcastOutput): Row[] { return output === "stream" ? STREAM_ROWS : LED_ROWS; }

export function valueAt(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) { if (typeof cur !== "object" || cur === null) return undefined; cur = (cur as Record<string, unknown>)[key]; }
  return cur;
}

/**
 * Nested patch for one control. Array leaves (caster slots) cannot be patched
 * by index, so the caller passes the current pair and gets a full pair back.
 */
export function patchAt(path: string[], value: unknown, currentPair?: readonly unknown[]): Record<string, unknown> {
  const keys = [...path];
  let leaf: unknown = value;
  const last = keys[keys.length - 1]!;
  if (currentPair && /^\d+$/.test(last)) { const pair = [...currentPair]; pair[Number(last)] = value; leaf = pair; keys.pop(); }
  return keys.reduceRight<unknown>((acc, key) => ({ [key]: acc }), leaf) as Record<string, unknown>;
}

export function rowDirty(row: Row, preview: unknown, program: unknown): boolean {
  return row.controls.some((c) => JSON.stringify(valueAt(preview, c.path)) !== JSON.stringify(valueAt(program, c.path)));
}
```

**Step 4: Run tests** (expected pass) and `npm run typecheck`.

**Step 5: Commit**

```bash
git add bundles/rashinban/src/broadcast
git commit -m "feat(broadcast): channel, lower-third text and switcher model helpers"
```

---

## Task 5: Layer modules and shared info stylesheet

Markup and CSS move from the old pages. Do this task before deleting them (Task 7) so you can copy from the working tree.

**Files:**
- Create: `bundles/rashinban/graphics/info.css`
- Create: `bundles/rashinban/src/graphics/broadcast/bind.ts`
- Create: `bundles/rashinban/src/graphics/layers/player-cards.ts`
- Create: `bundles/rashinban/src/graphics/layers/banpick.ts`
- Create: `bundles/rashinban/src/graphics/layers/casters.ts`
- Create: `bundles/rashinban/src/graphics/layers/lower-third.ts`

No unit tests here beyond the pure helpers from Task 4; the DOM glue is verified in Task 6 by loading the pages.

**Step 1: `bind.ts`** (browser-only; uses the `nodecg` global)

```ts
import { withDefaults, type BroadcastOutput, type BroadcastState, type LayersFor } from "../../broadcast/state.ts";
import type { Channel } from "../../broadcast/channel.ts";
import { REPLICANTS } from "../../types/replicants.ts";

/** Calls apply with this output's layers for the page's channel whenever the bus changes. */
export function bindLayers<O extends BroadcastOutput>(output: O, channel: Channel, apply: (layers: LayersFor<O>) => void): void {
  nodecg.Replicant<BroadcastState>(REPLICANTS.broadcast).on("change", (value) => {
    apply(withDefaults(value)[output][channel] as LayersFor<O>);
  });
}
```

**Step 2: `info.css`**

Create `bundles/rashinban/graphics/info.css` with, in order:

1. A page block:
```css
html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; color: #fff; }
.layer { position: absolute; inset: 0; pointer-events: none; }
.layer[hidden] { display: none; }
```
2. The whole `<style>` body of `graphics/player-cards.html` (from `:root {` to the end), with these edits: delete its `html, body` rule; rename `.card` to `.pcard` everywhere (selectors and keep the `#card-1` / `#card-2` ids); move the `--p1`, `--p2`, `--heading`, `--body` variables from `:root` into a `:root` block at the top of the file (they are shared), and keep `--card-w` with the cards.
3. The whole `<style>` body of `graphics/casters.html` with these edits: delete its `html, body` rule; prefix every selector with `#casters ` (`#casters .topbar`, `#casters .mark`, ...); rename `.card` to `.caster` (`#casters .caster`, `#caster-1`, `#caster-2` stay); put `--red`, `--red-dark`, `--topbar-h`, `--banner-h`, `--card-w`, `--card-top`, `--jp` on `#casters` instead of `:root` (`--card-w` would otherwise clash with the player cards).
4. The whole `<style>` body of `graphics/banpick-stream.html` with these edits: delete its `html, body` rule; delete `--accent` from the `:root` block (each page sets it); prefix every selector with `#banpick ` where it is not already under `#banpick` (`.player`, `.bp-*`, `header`, `footer`).
5. New lower-third rules:
```css
#lower-third { position: absolute; left: 110px; bottom: 90px; display: flex; flex-direction: column; gap: 6px; opacity: 0; transform: translateY(20px); transition: opacity .35s ease, transform .45s cubic-bezier(.22,1,.36,1); }
#lower-third.visible { opacity: 1; transform: none; }
#lower-third .lt-title { padding: 10px 28px; font-family: var(--heading); font-size: 56px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; background: var(--p1); border-left: 10px solid #fff; }
#lower-third .lt-subtitle { align-self: flex-start; padding: 6px 20px; font-family: var(--heading); font-size: 26px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; background: #151b26ee; }
#lower-third .lt-subtitle:empty { display: none; }
```

**Step 3: `layers/player-cards.ts`**

Move the logic from `src/graphics/player-cards.ts`. Shape:

```ts
import type { ResolvedMatch, ResolvedSide } from "../../match/state.ts";
import type { PlayerCardsLayer } from "../../broadcast/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";

const FLAG_URL = (code: string) => `assets/images/flags/${code.toLowerCase()}.png`;

function cardMarkup(id: string): string {
  // Exactly the <div class="card" id="card-N"> ... </div> block from
  // graphics/player-cards.html, with class="pcard" and id=${id}.
  return `...`;
}
const TEMPLATE = `<div id="cards" data-page="profile">${cardMarkup("card-1")}<div id="round"></div>${cardMarkup("card-2")}</div>`;

export function mountPlayerCards(host: HTMLElement) {
  host.innerHTML = TEMPLATE;
  const root = host.querySelector<HTMLElement>("#cards")!;
  const roundEl = host.querySelector<HTMLElement>("#round")!;
  let match: ResolvedMatch | undefined;
  let layer: PlayerCardsLayer = { visible: false, page: "profile" };
  // text(), flag(), renderCard() copied verbatim from src/graphics/player-cards.ts
  function render() { /* as before, but reads `layer` instead of `cards` and uses host.querySelector for card-1/card-2 */ }
  nodecg.Replicant<ResolvedMatch>(REPLICANTS.matchResolved).on("change", (v) => { match = v; render(); });
  return { apply(next: PlayerCardsLayer) { layer = next; render(); } };
}
```

Important: `render()` previously returned early when `match` was undefined, which also skipped the visibility toggle. Keep that early return only for the card contents; always apply `root.classList.toggle("visible", layer.visible)` and `root.dataset.page = layer.page` first.

**Step 4: `layers/banpick.ts`**

```ts
import { createInitialState, type BanPickState } from "../../banpick/rules.ts";
import type { ToggleLayer } from "../../broadcast/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { playerName, renderBoard, renderGames, stepText } from "../banpick/board.ts";

const TEMPLATE = `<div id="banpick"> ...the header/board/footer markup from graphics/banpick-stream.html body... </div>`;

export function mountBanpick(host: HTMLElement) {
  host.innerHTML = TEMPLATE;
  const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
  const root = q("#banpick"), board = q("#board"), games = q("#games"), nameA = q("#name-a"), nameB = q("#name-b"), step = q("#step");
  let visible = false;
  nodecg.Replicant<BanPickState>(REPLICANTS.banPick).on("change", (raw) => {
    const state = raw ?? createInitialState();
    nameA.textContent = playerName(state, "A"); nameB.textContent = playerName(state, "B");
    const view = renderBoard(board, state);
    step.textContent = stepText(state, view);
    root.dataset.turn = view.step?.player ?? "";
    root.classList.toggle("complete", view.complete);
    renderGames(games, view);
  });
  return { apply(layer: ToggleLayer) { visible = layer.visible; root.classList.toggle("visible", visible); } };
}
```

**Step 5: `layers/casters.ts`**

Move `src/graphics/casters.ts`. Template is the `#stage` contents from `graphics/casters.html` wrapped in `<div id="casters">`, with `class="caster"` on the two cards and `hidden` on both. `apply(layer: CastersLayer)` stores the layer and re-renders:

```ts
function render() {
  for (const el of host.querySelectorAll<HTMLElement>(".topbar, .mark, .banner")) el.hidden = !layer.titleBar;
  for (const [index, card] of cardEls.entries()) {
    const caster = findCaster(casters, state.slots[index]!.name);
    card.hidden = !layer.slots[index] || !caster;
    if (!caster) continue;
    // role/name/kana/handle fill as before
  }
}
```
with `let layer: CastersLayer = { titleBar: true, slots: [false, false] }` and the two replicant subscriptions as before.

**Step 6: `layers/lower-third.ts`**

```ts
import type { LowerThirdLayer } from "../../broadcast/state.ts";
import { lowerThirdText } from "../../broadcast/lower-third.ts";
import type { ResolvedMatch } from "../../match/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";

const TEMPLATE = `<div id="lower-third"><div class="lt-title"></div><div class="lt-subtitle"></div></div>`;

export function mountLowerThird(host: HTMLElement) {
  host.innerHTML = TEMPLATE;
  const root = host.querySelector<HTMLElement>("#lower-third")!;
  const title = root.querySelector<HTMLElement>(".lt-title")!;
  const subtitle = root.querySelector<HTMLElement>(".lt-subtitle")!;
  let match: ResolvedMatch | undefined;
  let layer: LowerThirdLayer = { visible: false, mode: "match", title: "", subtitle: "" };
  function render() {
    const text = lowerThirdText(layer, match ? { label: match.label, left: match.left, right: match.right } : null);
    title.textContent = text.title; subtitle.textContent = text.subtitle;
    root.classList.toggle("visible", layer.visible);
  }
  nodecg.Replicant<ResolvedMatch>(REPLICANTS.matchResolved).on("change", (v) => { match = v; render(); });
  return { apply(next: LowerThirdLayer) { layer = next; render(); } };
}
```

**Step 7: Verify**

`npm run typecheck` (errors only in the old entries that Task 7 deletes and the old dashboard panels). `npm run build` must succeed.

**Step 8: Commit**

```bash
git add bundles/rashinban/graphics/info.css bundles/rashinban/src/graphics/broadcast bundles/rashinban/src/graphics/layers
git commit -m "feat(graphics): layer modules and shared info stylesheet"
```

---

## Task 6: Info pages

**Files:**
- Create: `bundles/rashinban/graphics/info-stream.html`
- Create: `bundles/rashinban/graphics/info-led.html`
- Create: `bundles/rashinban/src/graphics/info-stream.ts`
- Create: `bundles/rashinban/src/graphics/info-led.ts`

**Step 1: `info-stream.html`**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>RASHINBAN 2026 — Info (Stream)</title>
    <link rel="stylesheet" href="https://use.typekit.net/ljs6bhu.css" />
    <link rel="stylesheet" href="assets/fonts/fonts.css" />
    <link rel="stylesheet" href="info.css" />
    <style>
      :root { --accent: #c2185b; }
      body { background: transparent; }
    </style>
  </head>
  <body data-output="stream">
    <div class="layer" id="layer-casters"></div>
    <div class="layer" id="layer-banpick"></div>
    <div class="layer" id="layer-cards"></div>
    <div class="layer" id="layer-lower-third"></div>
    <script src="info-stream.js"></script>
  </body>
</html>
```

`info-led.html`: same with title `Info (LED)`, `--accent: #00bcd4`, `body { background: #000; }`, `data-output="led"`, only `layer-banpick` and `layer-cards`, script `info-led.js`.

**Step 2: entries**

`src/graphics/info-stream.ts`:
```ts
import { channelFromSearch } from "../broadcast/channel.ts";
import { bindLayers } from "./broadcast/bind.ts";
import { mountBanpick } from "./layers/banpick.ts";
import { mountCasters } from "./layers/casters.ts";
import { mountLowerThird } from "./layers/lower-third.ts";
import { mountPlayerCards } from "./layers/player-cards.ts";

const channel = channelFromSearch(location.search);
document.body.dataset.channel = channel;
const el = (id: string) => document.getElementById(id)!;
const casters = mountCasters(el("layer-casters"));
const banpick = mountBanpick(el("layer-banpick"));
const cards = mountPlayerCards(el("layer-cards"));
const lowerThird = mountLowerThird(el("layer-lower-third"));
bindLayers("stream", channel, (layers) => {
  casters.apply(layers.casters);
  banpick.apply(layers.banpick);
  cards.apply(layers.playerCards);
  lowerThird.apply(layers.lowerThird);
});
```
`info-led.ts`: same with banpick and cards only, `bindLayers("led", ...)`.

**Step 3: Verify in a browser**

`npm run build`, then `npm run dev`. Open `http://localhost:9090/bundles/rashinban/graphics/info-stream.html?channel=preview` and from the dashboard... the switcher does not exist yet, so use the NodeCG dashboard's built-in replicant editing is unavailable; instead run from a Node REPL against the HTTP routes:

```bash
curl -X POST http://localhost:9090/rashinban/banpick/toggle
curl -X POST http://localhost:9090/rashinban/playercards/show
curl -X POST http://localhost:9090/rashinban/casters/1/show
```
Expected: the program page (`info-stream.html` without `?channel`) shows the banpick board, then the cards, then the left caster card; the `?channel=preview` page stays empty. Stop NodeCG.

**Step 4: Commit**

```bash
git add bundles/rashinban/graphics/info-*.html bundles/rashinban/src/graphics/info-*.ts
git commit -m "feat(graphics): info-stream and info-led pages composed from layers"
```

---

## Task 7: Delete old pages and panels, update manifest

**Files:**
- Delete: `bundles/rashinban/graphics/{banpick-stream,banpick-led,player-cards,casters}.html`
- Delete: `bundles/rashinban/src/graphics/{banpick-stream,banpick-led,player-cards,casters}.ts`
- Delete: `bundles/rashinban/dashboard/player-cards-control.html`, `bundles/rashinban/src/dashboard/player-cards-control.ts`
- Modify: `bundles/rashinban/package.json`
- Modify: `bundles/rashinban/src/dashboard/banpick-control.ts`, `bundles/rashinban/dashboard/banpick-control.html`
- Modify: `bundles/rashinban/src/dashboard/casters-control.ts`, `bundles/rashinban/dashboard/casters-control.html`

**Step 1: Delete files**

```bash
git rm bundles/rashinban/graphics/banpick-stream.html bundles/rashinban/graphics/banpick-led.html bundles/rashinban/graphics/player-cards.html bundles/rashinban/graphics/casters.html
git rm bundles/rashinban/src/graphics/banpick-stream.ts bundles/rashinban/src/graphics/banpick-led.ts bundles/rashinban/src/graphics/player-cards.ts bundles/rashinban/src/graphics/casters.ts
git rm bundles/rashinban/dashboard/player-cards-control.html bundles/rashinban/src/dashboard/player-cards-control.ts
rm -f bundles/rashinban/graphics/{banpick-stream,banpick-led,player-cards,casters}.js* bundles/rashinban/dashboard/player-cards-control.js*
```

**Step 2: Manifest** (`bundles/rashinban/package.json`)

`graphics` becomes, in order: `presenter-audio.html`, `presenter.html`, `presenter-led.html` (1920x1080, created in Task 8), `info-stream.html`, `info-led.html`, `banpick-player.html` (1280x800), `brackets-finals.html`.

`dashboardPanels` becomes:
```json
{ "name": "switcher-stream", "workspace": "stream", "title": "Stream switcher", "file": "switcher-stream.html", "fullbleed": true },
{ "name": "switcher-led", "workspace": "led", "title": "LED switcher", "file": "switcher-led.html", "fullbleed": true },
{ "name": "current-match", "workspace": "shared", "title": "Current Match", "file": "current-match.html", "width": 6, "headerColor": "#256549" },
{ "name": "banpick-control", "workspace": "shared", "title": "Ban & Pick", "file": "banpick-control.html", "width": 4, "headerColor": "#1565c0" },
{ "name": "casters-control", "workspace": "shared", "title": "Casters", "file": "casters-control.html", "width": 3, "headerColor": "#ad1457" },
{ "name": "bracket-control", "workspace": "shared", "title": "Bracket", "file": "bracket-control.html", "width": 3, "headerColor": "#b71c1c" },
```
followed by the unchanged `presenter-control`, `startgg-control`, `sheet-control` entries (workspace `config`). The switcher HTML files are created in Task 9; NodeCG refuses to start until they exist, so do not start NodeCG between this task and Task 9.

**Step 3: Ban & Pick panel**

`banpick-control.html`: delete the `<button id="visible">Show overlay</button>` line; change the hint paragraph to add: `Overlay visibility is on the Stream / LED switcher tabs.`
`banpick-control.ts`: delete `visibleBtn` (declaration, the two lines in `render()`, and its listener).

**Step 4: Casters panel**

`casters-control.html`: delete both `<button id="slot-N-enabled">` lines; rename the `Visible` heading to `Selected` and add a paragraph `Card visibility is on the Stream switcher tab.`
`casters-control.ts`: delete the `enabled` click handler and the button rendering; `send(slot, { name })` only; the `live` preview lists both selected names (`caster.name` plus handle) regardless of visibility; drop `withDefaults` import if unused.

**Step 5: Verify**

`npm run typecheck`: remaining errors must be only in `src/graphics/presenter.ts` or none. `npm test` green. Do not run `npm start`.

**Step 6: Commit**

```bash
git add -A bundles/rashinban
git commit -m "refactor: remove per-overlay pages and panels; regroup dashboard workspaces"
```

---

## Task 8: LED presenter and the `led` client role

**Files:**
- Modify: `bundles/rashinban/src/presenter/clock.ts:3`
- Modify: `bundles/rashinban/src/graphics/presenter/client.ts`
- Modify: `bundles/rashinban/src/extension/presenter/register.ts:114`
- Modify: `bundles/rashinban/src/graphics/presenter.ts`
- Modify: `bundles/rashinban/src/presenter/tests/client.test.ts`
- Create: `bundles/rashinban/graphics/presenter-led.html`
- Create: `bundles/rashinban/graphics/presenter-led.css`
- Modify: `bundles/rashinban/dashboard/presenter-control.html` (launch link)

**Step 1: Failing test** (append to `client.test.ts`; widen the `client()` helper's role parameter to `'preview' | 'program' | 'led'`)

```ts
test('?role=led opts into the led role', () => {
  assert.equal(clientRole('?role=led'), 'led');
  assert.equal(clientRole('?role=LED'), 'preview');
});
test('led plays video cues on its own clock but never owns program, audio, or effect completion', async () => {
  const c = client('led'); await c.value.start();
  const t = timeline();
  c.value.updateClients({ clients: [], program: { clientId: 'other', expiresAtMs: 6000 } }); c.value.updateTimeline(t);
  assert.equal(c.value.ownsProgram(), false);
  assert.equal(c.value.playsVideo(), true);
  assert.equal(c.value.audioLease('embedded'), null);
  c.value.pollCues(); // bootstrap drains anything already due
  c.advance(90); // now 1290 -> 'five' at 1300 is still ahead
  c.advance(20);
  const due = c.value.pollCues();
  assert.deepEqual(due.map(cue => cue.id), ['five']);
  const sent = c.sent.length;
  assert.equal(await c.value.effectCompletion(t)(), false);
  assert.equal(c.sent.length, sent, 'led never reports effect-ended');
  c.value.dispose();
});
```

Check the clock arithmetic against the existing "preview has no effective callbacks" test and adjust the `advance` values so the `five` cue (atMs 1300) becomes due after bootstrap; the assertion that matters is that `due` contains `five` for the led role while the existing preview test keeps returning nothing.

**Step 2: Run to verify failure** (`playsVideo` undefined; `clientRole('?role=led')` returns preview).

**Step 3: Implement**

`clock.ts`: `export type ClientRole = 'program' | 'preview' | 'audio' | 'led';`

`client.ts`:
- `clientRole`: `const role = new URLSearchParams(search).get('role'); return role === 'program' ? 'program' : role === 'led' ? 'led' : 'preview';`
- Add after `ownsProgram`: 
  ```ts
  /** Program plays celebrations as the lease owner; an LED client plays them too, silently, on a fresh clock. */
  function playsVideo() { return ownsProgram() || (!disposed && deps.role === 'led' && deps.monotonicNow() - lastSync < 30000); }
  ```
- In `pollCues`, replace `const owns = ownsProgram();` with `const owns = playsVideo();` (the `adopt` bootstrap logic stays as is; `ownsProgram()` still runs inside `playsVideo`).
- Export `playsVideo` in the returned object.

`register.ts` line 114: `!['program', 'preview', 'audio', 'led'].includes(value.role as string)`.

`presenter.ts`:
- `reconcileVideo`: pass `client.playsVideo()` instead of `client.ownsProgram()` to `videoPlayer.update`, and `options.muted || role === 'led'` for the muted argument.
- In the cue loop, `videoPlayer.play(asset, timing.generation, ..., options.muted || role === 'led', options.effectsGain)`.
- LED visibility: after `document.body.dataset.role = role;` add
  ```ts
  if (document.body.dataset.output === 'led') {
    bindLayers('led', channelFromSearch(location.search), layers => { document.body.classList.toggle('blanked', !layers.presenter.visible); });
  }
  ```
  with imports `import { bindLayers } from './broadcast/bind.ts'; import { channelFromSearch } from '../broadcast/channel.ts';`.

`presenter-led.html`: copy `presenter.html`, change the title to `RASHINBAN 2026 — Presenter (LED)`, the stylesheet to `presenter-led.css`, and the body tag to `<body data-output="led" data-layout="dual" data-source="chroma" data-phase="waiting-game">`. Keep every element id (the script writes to all of them); delete the two `.camera` divs.

`presenter-led.css`:
```css
@import url('presenter.css');
/* LED wall: only the top 1920x576 is physically shown. Names and HP sit in a
   top band because the players on stage can cover the lower part. */
body { background: #000; }
body.blanked > * { visibility: hidden; }
.backdrop { inset: auto; top: 0; left: 0; width: 1920px; height: 576px; }
.celebration-video { height: 576px; }
.camera, footer { display: none !important; }
/* Row 1: identities and match info (y 0-52). */
.competitor { bottom: auto; top: 8px; width: 560px; }
.competitor.left { left: 24px; } .competitor.right { right: 24px; }
.wins { top: 4px; width: 48px; height: 48px; font-size: 34px; border-bottom-width: 3px; }
.left .wins { left: 660px; } .right .wins { right: 660px; }
.match-info { top: 0; left: 720px; width: 480px; height: 52px; grid-template-columns: 90px 90px 1fr; gap: 8px; padding: 5px 16px; border-radius: 0 0 14px 14px; }
.match-info .mode-info { width: 150px; }
.match-info small, .damage small { font-size: 11px; }
.match-info b { font-size: 22px; margin-top: 0; }
/* Row 2: damage and HP (y 52-100). */
.damage { top: 52px; width: 90px; }
.damage.left { left: 24px; } .damage.right { right: 24px; }
.damage small { display: none; }
.damage b { font-size: 30px; line-height: 44px; }
.health { bottom: auto; top: 52px; width: 600px; height: 44px; border-width: 3px; border-radius: 10px; }
.health.left { left: 120px; } .health.right { right: 120px; }
.health b { font-size: 30px; line-height: 36px; }
/* Stage: two wide POV windows (y 104-564). */
.player-window { top: 104px; width: 930px; height: 460px; }
.player-window.left { left: 16px; } .player-window.right { right: 16px; }
.shared-view, #transition, #preview-area, #waiting-area, #summary-area { top: 104px; left: 16px; width: 1888px; height: 460px; }
#timer { top: 488px; left: 878px; height: 80px; line-height: 70px; font-size: 36px; }
#results-map { top: 104px; left: 460px; width: 1000px; height: 460px; }
.result { top: 300px; width: 420px; } .result.left { left: 20px; } .result.right { right: 20px; }
#tie-range-label { top: 120px; }
#review-banner { top: 108px; }
#preview-map { bottom: 18px; }
/* Lock layouts keep the same band. */
body[data-lock="left"] .player-window.left, body[data-lock="right"] .player-window.right { top: 104px; width: 460px; height: 460px; }
body[data-lock="left"] .player-window.right, body[data-lock="right"] .player-window.left { top: 104px; width: 1400px; height: 460px; }
body[data-layout="shared"][data-lock="left"] .shared-view { top: 104px; left: 504px; width: 1400px; height: 460px; }
body[data-layout="shared"][data-lock="right"] .shared-view { top: 104px; left: 16px; width: 1400px; height: 460px; }
body[data-layout="shared"][data-lock="none"] .player-window { top: 104px; height: 460px; }
body[data-layout="shared"] #timer, body[data-lock="left"] #timer, body[data-lock="right"] #timer { top: 488px; }
```
These are starting values; tune visually in Step 5.

`presenter-control.html`: add `<a href="/bundles/rashinban/graphics/presenter-led.html?role=led" target="_blank" rel="noopener">LED graphic</a>` to the launch links nav.

**Step 4: Run tests and typecheck**

`npm test` green (including the two new tests), `npm run typecheck` clean, `npm run build` clean.

**Step 5: Visual check**

`npm run dev` is blocked until Task 9 creates the switcher pages. Temporarily that is fine: open the file through esbuild output only after Task 9. Note it in the commit and do the visual pass in Task 10.

**Step 6: Commit**

```bash
git add -A bundles/rashinban
git commit -m "feat(presenter): LED layout and silent led client role"
```

---

## Task 9: Switcher panels

**Files:**
- Create: `bundles/rashinban/dashboard/switcher.css`
- Create: `bundles/rashinban/dashboard/switcher-stream.html`
- Create: `bundles/rashinban/dashboard/switcher-led.html`
- Create: `bundles/rashinban/src/dashboard/switcher.ts`

**Step 1: HTML**

`switcher-stream.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Stream switcher</title><link rel="stylesheet" href="switcher.css" /></head>
  <body data-output="stream">
    <main class="switcher">
      <section class="monitors">
        <div class="monitor" data-channel="preview"><h3>PREVIEW</h3><div class="screen"><iframe class="presenter" title="Presenter preview"></iframe><iframe class="info" title="Info preview"></iframe></div></div>
        <div class="monitor" data-channel="program"><h3>PROGRAM</h3><div class="screen"><iframe class="presenter" title="Presenter program"></iframe><iframe class="info" title="Info program"></iframe></div></div>
      </section>
      <section class="strip" id="strip"></section>
      <footer class="actions">
        <label class="check"><input type="checkbox" id="presenter-monitors" /> Presenter monitors</label>
        <span id="error"></span>
        <button id="revert">Revert preview</button>
        <button id="take">TAKE</button>
      </footer>
    </main>
    <script src="switcher.js"></script>
  </body>
</html>
```
`switcher-led.html`: identical with title `LED switcher` and `data-output="led"`.

`switcher.css`:
```css
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #141a22; color: #edf1f8; font: 14px "Segoe UI", sans-serif; }
.switcher { display: grid; grid-template-rows: auto 1fr auto; gap: 14px; height: 100%; padding: 14px; }
.monitors { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.monitor h3 { margin: 0 0 6px; font-size: 13px; letter-spacing: .15em; color: #9bacc5; }
.monitor[data-channel="program"] h3 { color: #ff6b6b; }
.screen { position: relative; aspect-ratio: 16 / 9; background: #000; border: 2px solid #2c3950; overflow: hidden; }
.monitor[data-channel="program"] .screen { border-color: #c62828; }
.screen iframe { position: absolute; top: 0; left: 0; width: 1920px; height: 1080px; border: 0; pointer-events: none; transform-origin: top left; transform: scale(var(--scale, .25)); }
.strip { display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.row { display: grid; grid-template-columns: 160px 1fr; align-items: center; gap: 12px; padding: 8px 12px; background: #1b2333; border-left: 4px solid transparent; border-radius: 4px; }
.row.dirty { border-left-color: #ffcf78; background: #262d3a; }
.row h4 { margin: 0; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
.controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.controls label { display: flex; align-items: center; gap: 6px; color: #bbc8dd; }
input[type="text"], select { color: #f5f7fc; background: #2c3950; border: 1px solid #52637d; border-radius: 4px; padding: 6px 8px; font: inherit; min-width: 160px; }
button { color: #f5f7fc; background: #2c3950; border: 1px solid #52637d; border-radius: 4px; padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer; }
button.toggle.on { background: #2e7d32; border-color: #43a047; }
.actions { display: flex; align-items: center; gap: 14px; }
.actions #error { flex: 1; color: #ff9eaa; }
#take { padding: 14px 48px; font-size: 20px; letter-spacing: .2em; background: #c62828; border-color: #ef5350; }
#take:disabled { opacity: .4; }
```

**Step 2: `src/dashboard/switcher.ts`**

```ts
import { withDefaults, layersEqual, type BroadcastOutput, type BroadcastState } from "../broadcast/state.ts";
import { controlRows, patchAt, rowDirty, valueAt, type Control, type Row } from "../broadcast/switcher-model.ts";
import { BROADCAST_MESSAGES, REPLICANTS } from "../types/replicants.ts";

const output = (document.body.dataset.output === "led" ? "led" : "stream") as BroadcastOutput;
const rep = nodecg.Replicant<BroadcastState>(REPLICANTS.broadcast);
const el = (id: string) => document.getElementById(id)!;
const strip = el("strip");
const rows = controlRows(output);
let state = withDefaults(undefined);

async function send(name: string, body: unknown) {
  try { await nodecg.sendMessage(name, body); el("error").textContent = ""; }
  catch (error) { el("error").textContent = (error as Error).message; }
}
const layers = () => state[output];
function edit(control: Control, value: unknown) {
  const pair = control.path[1] === "slots" ? (valueAt(layers().preview, control.path.slice(0, 2)) as unknown[]) : undefined;
  void send(BROADCAST_MESSAGES.setPreview, { output, patch: patchAt(control.path, value, pair) });
}

// ---- Strip -------------------------------------------------------------------
const widgets = new Map<Control, HTMLElement>();
function buildRow(row: Row): HTMLElement {
  const section = document.createElement("div"); section.className = "row"; section.dataset.row = row.id;
  const title = document.createElement("h4"); title.textContent = row.title;
  const controls = document.createElement("div"); controls.className = "controls";
  for (const control of row.controls) {
    if (control.kind === "toggle") {
      const button = document.createElement("button"); button.className = "toggle"; button.textContent = control.label;
      button.onclick = () => edit(control, !(valueAt(layers().preview, control.path) as boolean));
      widgets.set(control, button); controls.append(button);
    } else {
      const label = document.createElement("label"); label.textContent = control.label;
      const input = control.kind === "select" ? document.createElement("select") : document.createElement("input");
      if (control.kind === "select") for (const [value, text] of control.options) (input as HTMLSelectElement).add(new Option(text, value));
      else (input as HTMLInputElement).type = "text";
      input.onchange = () => edit(control, input.value);
      widgets.set(control, input); label.append(input); controls.append(label);
    }
  }
  section.append(title, controls);
  return section;
}
strip.replaceChildren(...rows.map(buildRow));

function render() {
  const { preview, program } = layers();
  for (const row of rows) {
    strip.querySelector<HTMLElement>(`[data-row="${row.id}"]`)!.classList.toggle("dirty", rowDirty(row, preview, program));
    for (const control of row.controls) {
      const widget = widgets.get(control)!;
      const value = valueAt(preview, control.path);
      if (control.kind === "toggle") widget.classList.toggle("on", value === true);
      else if (document.activeElement !== widget) (widget as HTMLInputElement).value = String(value ?? "");
    }
  }
  (el("take") as HTMLButtonElement).disabled = layersEqual(preview, program);
}
rep.on("change", (value) => { state = withDefaults(value); render(); });

// ---- Actions -----------------------------------------------------------------
el("take").onclick = () => void send(BROADCAST_MESSAGES.take, { output });
el("revert").onclick = () => void send(BROADCAST_MESSAGES.revertPreview, { output });
document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
  if (event.key === " " || event.key === "Enter") { event.preventDefault(); el("take").click(); }
});

// ---- Monitors ----------------------------------------------------------------
const presenterPage = output === "led" ? "presenter-led.html" : "presenter.html";
const presenterRole = output === "led" ? "led" : "preview";
const STORAGE_KEY = `rashinban.switcher.${output}.presenterMonitors`;
const monitorsBox = el("presenter-monitors") as HTMLInputElement;
function applyMonitors() {
  for (const monitor of document.querySelectorAll<HTMLElement>(".monitor")) {
    const channel = monitor.dataset.channel!;
    monitor.querySelector<HTMLIFrameElement>("iframe.info")!.src = `/bundles/rashinban/graphics/info-${output}.html?channel=${channel}`;
    const presenter = monitor.querySelector<HTMLIFrameElement>("iframe.presenter")!;
    // Preview-role on the stream so the monitor never takes the program lease;
    // led-role on the LED so the monitor shows exactly what the wall shows.
    const src = `/bundles/rashinban/graphics/${presenterPage}?role=${output === "led" ? presenterRole : "preview"}&channel=${channel}`;
    if (monitorsBox.checked) { if (presenter.src !== location.origin + src) presenter.src = src; presenter.hidden = false; }
    else { presenter.removeAttribute("src"); presenter.hidden = true; }
  }
}
try { monitorsBox.checked = localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* storage unavailable */ }
monitorsBox.onchange = () => { try { localStorage.setItem(STORAGE_KEY, monitorsBox.checked ? "1" : "0"); } catch { /* ignore */ } applyMonitors(); };
applyMonitors();
function fitMonitors() {
  for (const screen of document.querySelectorAll<HTMLElement>(".screen")) screen.style.setProperty("--scale", String(screen.clientWidth / 1920));
}
new ResizeObserver(fitMonitors).observe(document.body);
fitMonitors();
```

Note on the LED presenter monitor: an `led`-role iframe plays celebration video silently, which is what the operator wants to see. It registers as a presenter client; the Duels Presenter panel lists it like any other.

**Step 3: Verify**

`npm run typecheck`, `npm run build`, then `npm run dev`. On `http://localhost:9090/` confirm the tabs: Stream, LED, Shared, Config. On Stream: toggle Player cards visible, the row turns dirty, TAKE enables; the preview monitor shows cards, the program monitor does not; press TAKE and the program monitor shows them; Revert preview after another change restores it. Repeat on LED with Presenter visible (enable Presenter monitors first). Stop NodeCG.

**Step 4: Commit**

```bash
git add bundles/rashinban/dashboard/switcher* bundles/rashinban/src/dashboard/switcher.ts
git commit -m "feat(dashboard): preview/program switcher panels per output"
```

---

## Task 10: Visual pass on the LED presenter

**Files:** `bundles/rashinban/graphics/presenter-led.css` (tune only).

**Step 1:** `npm run dev`. In the Config tab, Duels Presenter, set Input mode to Replay with the `Presenter showcase` fixture and apply. Open `http://localhost:9090/bundles/rashinban/graphics/presenter-led.html?role=led` in a 1920 wide window.

**Step 2:** Check, through a full replay, that everything the stream presenter shows during live, results, 5K, summary and aborted phases is inside y < 576, nothing overlaps unreadably, and the bottom 504px stays black except during blanking. Adjust `presenter-led.css` values until it does. Check `data-lock` layouts by watching a round where one player locks early.

**Step 3:** Confirm no audio from the LED page in either audio mode, and that the Duels Presenter panel lists it with role `led` without taking the program lease.

**Step 4:** Commit: `git commit -am "style(presenter): tune LED band and stage geometry"`.

---

## Task 11: Documentation

**Files:**
- Create: `docs/broadcast.md`
- Modify: `README.md:22-47`, `docs/presenter/obs.md:8-13`, `docs/presenter/setup.md` (source list), `docs/presenter/media.md:23` (mention the LED page is always silent)

**Step 1: `docs/broadcast.md`**

Document: the four pages and their URLs with `?channel=`; the bus model (preview/program, TAKE, Revert); the workspaces and who uses them; the layer list per output; the Companion routes table:

| Route | Effect |
| --- | --- |
| `POST /rashinban/broadcast/stream/take`, `.../led/take` | program = preview |
| `POST /rashinban/broadcast/stream/revert`, `.../led/revert` | preview = program |
| `POST /rashinban/banpick/show|hide|toggle` | stream program banpick |
| `POST /rashinban/playercards/show|hide|toggle|profile|stats|flip` | stream program player cards |
| `POST /rashinban/casters/1|2/show|hide|toggle` | stream program caster cards |

and the LED presenter notes (band geometry, `?role=led`, silent, `presenter.visible` blanking).

**Step 2: README** Replace the Dashboard bullet list with Stream / LED / Shared / Config descriptions and replace the overlay bullets for banpick-stream/led, player cards and casters with one bullet pointing at `graphics/info-stream.html`, `graphics/info-led.html` and `docs/broadcast.md`.

**Step 3: obs.md** Add rows for `presenter-led.html?role=led`, `info-stream.html`, `info-led.html` to the source table and a sentence that the LED wall shows the top 1920x576 of the LED presenter.

**Step 4:** Commit: `git add docs README.md && git commit -m "docs: broadcast switcher, info pages and LED presenter"`.

---

## Task 12: Final verification

1. `npm test` (all green), `npm run typecheck` (clean), `npm run build` (clean).
2. `git status` clean apart from ignored build output.
3. Use superpowers:verification-before-completion, then superpowers:finishing-a-development-branch to merge or open the PR for `feat/broadcast-switcher`.
