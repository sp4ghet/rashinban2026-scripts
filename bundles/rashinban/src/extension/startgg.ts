// start.gg poller: fetches the configured event's phases, every phase group's
// seeds and sets, and the tournament stream queue, then publishes the
// normalized bracket as a replicant. The token comes from STARTGG_TOKEN
// (loaded from .env by ./env.ts) and never leaves the server.
import type NodeCG from "@nodecg/types";

import { normalizeEvent } from "../startgg/normalize";
import {
  EVENT_QUERY,
  PHASE_GROUP_QUERY,
  STARTGG_ENDPOINT,
  STREAM_QUEUE_QUERY,
  normalizeEventSlug,
  tournamentSlugFromEvent,
} from "../startgg/queries";
import type {
  RawEvent,
  RawPhaseGroup,
  RawStreamQueueEntry,
  StartggBracket,
  StartggConfig,
  StartggStatus,
} from "../startgg/types";
import { REPLICANTS, STARTGG_MESSAGES } from "../types/replicants";

const DEFAULT_CONFIG: StartggConfig = {
  enabled: false,
  eventSlug: "tournament/rashinban-2026/event/rashinban-2026",
  tournamentSlug: "",
  pollIntervalMs: 30_000,
};

const MIN_POLL_MS = 10_000;

export function registerStartgg(nodecg: NodeCG.ServerAPI, router: ReturnType<NodeCG.ServerAPI["Router"]>) {
  const config = nodecg.Replicant<StartggConfig>(REPLICANTS.startggConfig, { defaultValue: DEFAULT_CONFIG });
  const bracket = nodecg.Replicant<StartggBracket | null>(REPLICANTS.startggBracket, { defaultValue: null });
  const status = nodecg.Replicant<StartggStatus>(REPLICANTS.startggStatus, {
    defaultValue: {
      polling: false,
      lastFetchAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastComplexity: null,
      requestsLastMinute: 0,
      tokenPresent: false,
    },
    persistent: false,
  });

  const token = () => process.env.STARTGG_TOKEN?.trim() ?? "";
  const requestTimes: number[] = [];
  const patchStatus = (patch: Partial<StartggStatus>) => {
    const now = Date.now();
    while (requestTimes.length && requestTimes[0]! < now - 60_000) requestTimes.shift();
    status.value = { ...status.value!, ...patch, requestsLastMinute: requestTimes.length, tokenPresent: Boolean(token()) };
  };

  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const t = token();
    if (!t) throw new Error("STARTGG_TOKEN is not set (copy .env.example to .env and restart)");
    requestTimes.push(Date.now());
    const res = await fetch(STARTGG_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) throw new Error("start.gg rate limit hit (HTTP 429)");
    if (!res.ok) throw new Error(`start.gg HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[]; extensions?: { queryComplexity?: number } };
    if (json.extensions?.queryComplexity !== undefined) patchStatus({ lastComplexity: json.extensions.queryComplexity });
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    if (!json.data) throw new Error("start.gg returned no data");
    return json.data;
  }

  async function fetchGroup(id: number): Promise<RawPhaseGroup> {
    const first = await gql<{ phaseGroup: RawPhaseGroup | null }>(PHASE_GROUP_QUERY, { id, page: 1 });
    const group = first.phaseGroup;
    if (!group) throw new Error(`phase group ${id} not found`);
    const totalPages = group.sets?.pageInfo?.totalPages ?? 1;
    for (let page = 2; page <= totalPages; page++) {
      const more = await gql<{ phaseGroup: RawPhaseGroup | null }>(PHASE_GROUP_QUERY, { id, page });
      group.sets!.nodes.push(...(more.phaseGroup?.sets?.nodes ?? []));
    }
    return group;
  }

  async function fetchAll(cfg: StartggConfig): Promise<StartggBracket> {
    const eventSlug = normalizeEventSlug(cfg.eventSlug);
    if (!eventSlug) throw new Error("eventSlug is empty");
    const { event } = await gql<{ event: RawEvent | null }>(EVENT_QUERY, { slug: eventSlug });
    if (!event) throw new Error(`event not found: ${eventSlug}`);
    const groupIds = event.phases.flatMap((p) => (p.phaseGroups?.nodes ?? []).map((g) => g.id));
    const groups: RawPhaseGroup[] = [];
    for (const id of groupIds) groups.push(await fetchGroup(id));
    const tournamentSlug = cfg.tournamentSlug.trim() || tournamentSlugFromEvent(eventSlug);
    let queue: RawStreamQueueEntry[] | null = null;
    if (tournamentSlug) {
      const q = await gql<{ tournament: { streamQueue: RawStreamQueueEntry[] | null } | null }>(STREAM_QUEUE_QUERY, {
        slug: tournamentSlug,
      });
      queue = q.tournament?.streamQueue ?? null;
    }
    return normalizeEvent(event, groups, queue, Date.now());
  }

  let inFlight: Promise<boolean> | null = null;
  function refresh(): Promise<boolean> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const cfg = config.value ?? DEFAULT_CONFIG;
      patchStatus({ lastFetchAt: Date.now() });
      try {
        bracket.value = await fetchAll(cfg);
        patchStatus({ lastSuccessAt: Date.now(), lastError: null });
        return true;
      } catch (err) {
        const message = (err as Error).message;
        nodecg.log.warn(`startgg: ${message}`);
        patchStatus({ lastError: message });
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  let timer: NodeJS.Timeout | null = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    const cfg = config.value ?? DEFAULT_CONFIG;
    if (!cfg.enabled) {
      patchStatus({ polling: false });
      return;
    }
    patchStatus({ polling: true });
    timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, Math.max(MIN_POLL_MS, cfg.pollIntervalMs));
  }

  config.on("change", (next, prev) => {
    if (!next) return;
    const changed = !prev || next.enabled !== prev.enabled || next.eventSlug !== prev.eventSlug || next.pollIntervalMs !== prev.pollIntervalMs;
    if (!changed) return;
    if (next.enabled) {
      patchStatus({ polling: true });
      void refresh().then(schedule);
    } else {
      schedule();
    }
  });

  nodecg.listenFor(STARTGG_MESSAGES.refresh, async (_data, ack) => {
    const ok = await refresh();
    if (ack && !ack.handled) ok ? ack(null, status.value) : ack(new Error(status.value?.lastError ?? "refresh failed"));
  });

  nodecg.listenFor(STARTGG_MESSAGES.setConfig, (data: Partial<StartggConfig>, ack) => {
    const cur = config.value ?? DEFAULT_CONFIG;
    config.value = {
      enabled: typeof data?.enabled === "boolean" ? data.enabled : cur.enabled,
      eventSlug: typeof data?.eventSlug === "string" ? normalizeEventSlug(data.eventSlug) : cur.eventSlug,
      tournamentSlug: typeof data?.tournamentSlug === "string" ? data.tournamentSlug.trim() : cur.tournamentSlug,
      pollIntervalMs:
        typeof data?.pollIntervalMs === "number" && Number.isFinite(data.pollIntervalMs)
          ? Math.max(MIN_POLL_MS, Math.round(data.pollIntervalMs))
          : cur.pollIntervalMs,
    };
    if (ack && !ack.handled) ack(null, config.value);
  });

  router.post("/startgg/refresh", async (_req, res) => {
    const ok = await refresh();
    res.status(ok ? 200 : 502).json(status.value);
  });

  patchStatus({});
  schedule();
  nodecg.log.info(`startgg: ${token() ? "token loaded" : "no STARTGG_TOKEN"}; polling ${config.value?.enabled ? "enabled" : "disabled"}`);
}
