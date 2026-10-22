import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { registerSheet } from "../../extension/sheet.ts";
import { DEFAULT_SHEET_CONFIG } from "../../config/schema.ts";

test("English sheet failure retains the last profiles and does not prevent Japanese updates", async t => {
  const reps = new Map<string, any>(), handlers = new Map<string, Function>();
  const fake = {
    Replicant(name: string, options: any = {}) {
      if (!reps.has(name)) reps.set(name, Object.assign(new EventEmitter(), { value: options.defaultValue }));
      return reps.get(name);
    },
    listenFor(name: string, fn: Function) { handlers.set(name, fn); },
    log: { warn() {} },
  };
  let failEnglish = false, jpName = "Original";
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const gid = new URL(String(url)).searchParams.get("gid");
    if (gid === DEFAULT_SHEET_CONFIG.playersEnGid && failEnglish) return new Response("failed", { status: 503 });
    if (gid === DEFAULT_SHEET_CONFIG.castersGid || gid === DEFAULT_SHEET_CONFIG.castersEnGid)
      return new Response("role,name,twitter\nCASTER,Caster,handle");
    return new Response("geoguessr_player_uid,name,startgg_tag\n6375a42d001fcb9df8d226d9," + (gid === "0" ? jpName : "English name") + ",tag");
  });
  registerSheet(fake as any, { post() {} } as any);
  const refresh = () => new Promise<unknown>(resolve => handlers.get("sheet:refresh")!(undefined, (error: unknown) => resolve(error)));
  assert.equal(await refresh(), null);
  assert.equal(reps.get("playersEn")?.value[0].name, "English name");
  assert.equal(reps.get("castersEn")?.value[0].name, "Caster");
  failEnglish = true; jpName = "Updated original";
  assert.ok(await refresh() instanceof Error);
  assert.equal(reps.get("players").value[0].name, "Updated original");
  assert.equal(reps.get("playersEn").value[0].name, "English name");
  assert.match(reps.get("sheetStatus").value.lastError, /players_en/);
});
