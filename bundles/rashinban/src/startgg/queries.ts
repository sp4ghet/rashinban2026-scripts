// GraphQL documents for the start.gg poller. Keep in sync with
// scripts/startgg-fetch.mjs, which records the same shapes as fixtures.

export const STARTGG_ENDPOINT = "https://api.start.gg/gql/alpha";
export const ENTRANTS_QUERY = `query Entrants($slug: String!, $page: Int!) {
  event(slug: $slug) { entrants(query: {page: $page, perPage: 50}) {
    pageInfo { totalPages }
    nodes { id name initialSeedNum participants { id gamerTag prefix } }
  } }
}`;

export const SET_FIELDS = `
  id identifier round fullRoundText state winnerId displayScore totalGames
  startedAt completedAt wPlacement lPlacement hasPlaceholder
  stream { streamName streamSource }
  slots {
    id slotIndex prereqType prereqId prereqPlacement
    entrant { id name initialSeedNum participants { id gamerTag prefix } }
    seed { id seedNum }
    standing { placement stats { score { value } } }
  }`;

export const EVENT_QUERY = `query Event($slug: String!) {
  event(slug: $slug) {
    id name slug numEntrants state startAt
    tournament { id name slug }
    phases {
      id name bracketType groupCount numSeeds phaseOrder state isExhibition
      phaseGroups(query: { perPage: 64 }) {
        pageInfo { total }
        nodes { id displayIdentifier bracketType numRounds state }
      }
    }
  }
}`;

export const PHASE_GROUP_QUERY = `query PhaseGroup($id: ID!, $page: Int!) {
  phaseGroup(id: $id) {
    id displayIdentifier bracketType state numRounds
    phase { id name phaseOrder bracketType groupCount numSeeds }
    progressionsOut { id originPlacement }
    seeds(query: { perPage: 64 }) {
      nodes {
        id seedNum placement isBye
        entrant { id name }
        progressionSource { id originPlacement originPhaseGroup { id displayIdentifier } originPhase { id name } }
      }
    }
    sets(page: $page, perPage: 20, sortType: ROUND) {
      pageInfo { total totalPages }
      nodes { ${SET_FIELDS} }
    }
  }
}`;

export const STREAM_QUEUE_QUERY = `query StreamQueue($slug: String!) {
  tournament(slug: $slug) {
    id name
    streamQueue {
      stream { id streamName streamSource }
      sets { ${SET_FIELDS} phaseGroup { id displayIdentifier } }
    }
  }
}`;

/** "tournament/foo/event/bar" -> "foo" */
export function tournamentSlugFromEvent(eventSlug: string): string {
  const m = /^tournament\/([^/]+)/.exec(eventSlug.trim());
  return m?.[1] ?? "";
}

/** Accepts a full start.gg URL or a slug and returns "tournament/<t>/event/<e>". */
export function normalizeEventSlug(input: string): string {
  const s = input.trim().replace(/^https?:\/\/(www\.)?start\.gg\//, "");
  const m = /^tournament\/([^/]+)\/events?\/([^/?#]+)/.exec(s);
  return m ? `tournament/${m[1]}/event/${m[2]}` : s;
}
