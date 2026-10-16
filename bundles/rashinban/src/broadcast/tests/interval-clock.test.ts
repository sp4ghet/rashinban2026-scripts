import assert from "node:assert/strict";
import test from "node:test";
import { createIntervalClock } from "../../interval/clock.ts";

test("interval clock estimates server time using monotonic request midpoint, without client wall time", async () => {
  let elapsed = 5000;
  const clock = createIntervalClock({ monotonicNow: () => elapsed, sample: async () => { elapsed += 20; return 1000010; } });
  assert.equal(clock.now(), null);
  await clock.sync();
  assert.equal(clock.now(), 1000020);
  elapsed += 9000;
  assert.equal(clock.now(), 1009020);
});

test("invalid, slow, and failed clock samples retain the last good server estimate", async () => {
  let elapsed = 0, sample: unknown = 1000;
  const clock = createIntervalClock({ monotonicNow: () => elapsed, sample: async () => {
    if (sample instanceof Error) throw sample;
    if (sample === "slow") { elapsed += 2000; return 100000; }
    return sample;
  } });
  await clock.sync();
  sample = NaN; elapsed = 100; await clock.sync();
  assert.equal(clock.now(), 1100);
  sample = new Error("offline"); elapsed = 200; await clock.sync();
  assert.equal(clock.now(), 1200);
  sample = "slow"; await clock.sync();
  assert.equal(clock.now(), 3200);
});
