import { localizeMatch, type ResolvedMatch } from "../../match/state.ts";
import type { PlayerProfile } from "../../sheet/players.ts";
import { REPLICANTS } from "../../types/replicants.ts";

/** Keep all language variants attached to the authoritative shared match. */
export function bindMatch(apply: (match: ResolvedMatch | null) => void, english = false, next = false): void {
  let match: ResolvedMatch | null = null, profiles: PlayerProfile[] = [];
  const render = () => apply(english ? localizeMatch(match, profiles) : match);
  nodecg.Replicant<ResolvedMatch | null>(next ? REPLICANTS.nextMatchResolved : REPLICANTS.matchResolved)
    .on("change", value => { match = value ?? null; render(); });
  if (english) nodecg.Replicant<PlayerProfile[]>(REPLICANTS.playersEn)
    .on("change", value => { profiles = value ?? []; render(); });
}
