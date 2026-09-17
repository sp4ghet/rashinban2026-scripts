// DAY2 bracket data for graphics/brackets-finals.html. Publishes the 11 match
// rows from the live start.gg bracket (already polled by ./startgg.ts) or, for
// testing, a recorded phase-group sample file run through the same mapping.
import { readFile } from "node:fs/promises";
import path from "node:path";

import type NodeCG from "@nodecg/types";

import {
  DEFAULT_BRACKET_CONFIG,
  finalsGroupId,
  fromPhaseGroupSample,
  fromStartgg,
  withDefaults,
  type BracketConfig,
  type BracketFinals,
} from "../bracket/finals";
import type { StartggBracket } from "../startgg/types";
import { BRACKET_MESSAGES, REPLICANTS } from "../types/replicants";

/** Re-read a sample this often, so hand edits to the file show up. */
const SAMPLE_POLL_MS = 5_000;

function parseConfig(data: Partial<BracketConfig> | undefined, cur: BracketConfig): BracketConfig {
  const next = { ...cur };
  if (data?.source !== undefined) {
    if (data.source !== "startgg" && data.source !== "sample") throw new Error("source must be startgg or sample");
    next.source = data.source;
  }
  if (data?.groupId !== undefined) {
    if (data.groupId !== null && !(Number.isInteger(data.groupId) && data.groupId > 0)) {
      throw new Error("groupId must be a start.gg phase group id, or empty for auto");
    }
    next.groupId = data.groupId;
  }
  if (data?.samplePath !== undefined) {
    if (typeof data.samplePath !== "string" || !data.samplePath.trim()) throw new Error("Sample path is empty");
    next.samplePath = data.samplePath.trim();
  }
  return next;
}

export function registerBracket(nodecg: NodeCG.ServerAPI, router: ReturnType<NodeCG.ServerAPI["Router"]>) {
  const config = nodecg.Replicant<BracketConfig>(REPLICANTS.bracketConfig, { defaultValue: DEFAULT_BRACKET_CONFIG });
  const finals = nodecg.Replicant<BracketFinals>(REPLICANTS.bracketFinals, {
    defaultValue: { source: DEFAULT_BRACKET_CONFIG.source, groupId: null, rows: [], updatedAt: null, error: null },
    persistent: false,
  });
  const startgg = nodecg.Replicant<StartggBracket | null>(REPLICANTS.startggBracket);
  const current = () => withDefaults(config.value);

  async function update() {
    const cfg = current();
    try {
      if (cfg.source === "sample") {
        const json = JSON.parse(await readFile(path.resolve(process.cwd(), cfg.samplePath), "utf8")) as unknown;
        const { groupId, rows } = fromPhaseGroupSample(json);
        finals.value = { source: "sample", groupId, rows, updatedAt: Date.now(), error: null };
      } else {
        const bracket = startgg.value;
        if (!bracket) throw new Error("No start.gg data yet: enable polling in the start.gg panel");
        const groupId = cfg.groupId ?? finalsGroupId(bracket);
        if (groupId === null) throw new Error("No DAY2 phase group in the start.gg event");
        finals.value = { source: "startgg", groupId, rows: fromStartgg(bracket, groupId), updatedAt: Date.now(), error: null };
      }
    } catch (err) {
      // Keep the last good rows on screen; report the problem in the dashboard.
      const cur = finals.value!;
      finals.value = { ...cur, source: cfg.source, rows: cur.source === cfg.source ? cur.rows : [], error: (err as Error).message };
    }
  }

  startgg.on("change", () => {
    if (current().source === "startgg") void update();
  });
  config.on("change", () => void update());
  setInterval(() => {
    if (current().source === "sample") void update();
  }, SAMPLE_POLL_MS);

  nodecg.listenFor(BRACKET_MESSAGES.setConfig, (data: Partial<BracketConfig>, ack) => {
    try {
      config.value = parseConfig(data, current());
      if (ack && !ack.handled) ack(null, config.value);
    } catch (err) {
      if (ack && !ack.handled) ack(err as Error);
    }
  });
  nodecg.listenFor(BRACKET_MESSAGES.refresh, async (_data, ack) => {
    await update();
    if (ack && !ack.handled) ack(null, finals.value);
  });
  router.post("/bracket/refresh", async (_req, res) => {
    await update();
    res.status(finals.value?.error ? 502 : 200).json(finals.value);
  });
}
