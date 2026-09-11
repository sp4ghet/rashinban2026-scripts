import type { PlayerProfile } from "../sheet/players.ts";

export function geoUid(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const uid = /^[a-f\d]{24}$/i.test(text)
    ? text
    : /^https:\/\/(?:www\.)?geoguessr\.com\/user\/([a-f\d]{24})\/?(?:[?#].*)?$/i.exec(
        text,
      )?.[1];
  if (!uid)
    throw new Error(
      "Enter a 24-character GeoGuessr UID or a GeoGuessr profile URL.",
    );
  return uid.toLowerCase();
}

export function playerLabel(
  name: string,
  uid: string | null | undefined,
): string {
  return `${name || "Unnamed player"} (${uid || "UID missing"})`;
}

export type Identity = {
  uid?: string | null;
  entrantId?: number | null;
  tag?: string;
  name?: string;
};
export function matchProfile(
  profiles: PlayerProfile[],
  identity: Identity,
): {
  profile: PlayerProfile | null;
  status: "matched" | "missing" | "ambiguous";
} {
  const norm = (value: string) =>
    value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const unique = (found: PlayerProfile[]) => ({
    profile: found.length === 1 ? found[0] : null,
    status:
      found.length > 1
        ? ("ambiguous" as const)
        : found.length === 1
          ? ("matched" as const)
          : ("missing" as const),
  });
  if (identity.uid)
    return unique(
      profiles.filter((p) => p.geoguessrPlayerUid === identity.uid),
    );
  if (identity.entrantId != null) {
    const found = profiles.filter(
      (p) => p.startggEntrantId === identity.entrantId,
    );
    if (found.length) return unique(found);
  }
  for (const key of [identity.tag, identity.name]) {
    if (!key?.trim()) continue;
    const found = profiles.filter(
      (p) => norm(p.startggTag) === norm(key) || norm(p.name) === norm(key),
    );
    if (found.length) return unique(found);
  }
  return unique([]);
}
