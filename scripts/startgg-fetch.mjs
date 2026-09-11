// Fetch start.gg GraphQL data into docs/startgg/samples/ for fixtures and
// debugging. Reads STARTGG_TOKEN from .env (run via `npm run startgg:fetch`).
//
//   node --env-file=.env scripts/startgg-fetch.mjs event <event-slug> [outfile]
//   node --env-file=.env scripts/startgg-fetch.mjs phase-group <phaseGroupId> [outfile]
//   node --env-file=.env scripts/startgg-fetch.mjs stream-queue <tournament-slug> [outfile]
//
// Output: { fetchedAt, kind, variables, data } with sets fully paged.
import { writeFileSync } from "node:fs";
import path from "node:path";

const ENDPOINT = "https://api.start.gg/gql/alpha";
const token = process.env.STARTGG_TOKEN?.trim();
if (!token) {
  console.error("STARTGG_TOKEN is not set (copy .env.example to .env)");
  process.exit(1);
}

const SET_FIELDS = `
  id identifier round fullRoundText state winnerId displayScore totalGames
  startedAt completedAt wPlacement lPlacement hasPlaceholder
  stream { streamName streamSource }
  slots {
    id slotIndex prereqType prereqId prereqPlacement
    entrant { id name initialSeedNum participants { id gamerTag prefix } }
    seed { id seedNum }
    standing { placement stats { score { value } } }
  }`;

const QUERIES = {
  event: `query Event($slug: String!) {
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
  }`,
  phaseGroup: `query PhaseGroup($id: ID!, $page: Int!) {
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
  }`,
  streamQueue: `query StreamQueue($slug: String!) {
    tournament(slug: $slug) {
      id name
      streamQueue {
        stream { id streamName streamSource }
        sets { ${SET_FIELDS} phaseGroup { id displayIdentifier } }
      }
    }
  }`,
};

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 1));
  console.error(`complexity ${json.extensions?.queryComplexity ?? "?"}`);
  return json.data;
}

const [kind, arg, outArg] = process.argv.slice(2);
let data;
let variables;
switch (kind) {
  case "event":
    variables = { slug: arg };
    data = await gql(QUERIES.event, variables);
    break;
  case "phase-group": {
    variables = { id: arg };
    data = await gql(QUERIES.phaseGroup, { id: arg, page: 1 });
    const totalPages = data.phaseGroup?.sets?.pageInfo?.totalPages ?? 1;
    for (let page = 2; page <= totalPages; page++) {
      const more = await gql(QUERIES.phaseGroup, { id: arg, page });
      data.phaseGroup.sets.nodes.push(...more.phaseGroup.sets.nodes);
    }
    break;
  }
  case "stream-queue":
    variables = { slug: arg };
    data = await gql(QUERIES.streamQueue, variables);
    break;
  default:
    console.error("usage: startgg-fetch.mjs <event|phase-group|stream-queue> <arg> [outfile]");
    process.exit(1);
}

const outfile = outArg ?? path.join("docs/startgg/samples", `${kind}-${String(arg).replace(/[^\w.-]+/g, "_")}.json`);
writeFileSync(outfile, JSON.stringify({ fetchedAt: new Date().toISOString(), kind, variables, data }, null, 2) + "\n");
console.log(`wrote ${outfile}`);
