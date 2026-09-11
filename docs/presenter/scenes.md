# Preview, results and final presentation

The presenter remains a passive output: start, continue, pause and abort controls
stay in GeoGuessr. `projectScene` selects the visible scene using the authoritative
game/timeline and shared presentation clock. Its `previewRound` is separate from
the server's current round and never starts a round or rewrites history/HP.

The server connection enriches spectator snapshots with a read-only
`GET https://gs2.geoguessr.com/<node>/<game>/game-master` at bootstrap and round,
result and reconnect boundaries. It reuses the server-side account cookie.
Future panoramas survive spectator snapshots that omit them; stale responses
cannot replace current round, HP or history. Denied or unavailable master access
leaves the spectator connection running and keeps settled results on screen
when the next panorama is unknown. New games, rollback and cancellation clear
inapplicable future knowledge.

An unstarted current round shows a full-width starting panorama and small empty
world map. A scheduled server start shows 3, 2, 1 against its actual timestamp,
then ordinary live play. Chroma mode uses a full-width key rectangle and hides
Google imagery. Camera windows remain visible in every scene.

After a round resolves, the 5K video first covers the frozen game view. Its shared
reveal boundary switches the background to the results map while the video is
still playing, so its transparent opening shows the score animation. The results
map is prepared invisibly beforehand; answers remain hidden until that boundary.
The displayed timeline round stays on the outgoing result through scoring/HP
completion even when a newer server round arrives. At `holdAtMs`, after the
celebration has cleared, a known next-round panorama becomes
the preview in **both automatic and manual games**. This is the requested custom
presentation policy: it differs from GeoGuessr's manual Continue button. It sends
no control request and waits for the host/server start. If privileged future
round metadata is absent, settled results stay visible. A knockout, round limit or finished
game prevents another preview even if extra panoramas are available.

The preview suppresses the old answer, score animation and result multiplier,
while retaining settled HP. Exact known panorama metadata may be prepared in a
hidden persistent slot during the outgoing result scene. It never invents future
locations or puts an answer pin on the preview map. Game, round and mapping
identities guard panorama reuse; hidden/chroma surfaces remain invisible.

After final scoring, the winner follows `winnerTeamId`, not HP comparison. Draws
are neutral; aborted games say GAME CANCELLED. The post-game panel shows only
the winner and remains until a new game replaces the state. There is no match
breakdown, six-second expiry, automatic lobby navigation, or avatar animation.
The series header and camera windows remain visible.

A paused/review game shows a banner and suppresses the running countdown without
inventing a new start time. A valid existing preview can remain during review;
results do not automatically advance while paused. Missing state uses a waiting
slate and clears retained frames. A new game clears the prior scene selection.

Behavior reference: `docs/geoguessr/game-master-flow.md` in the main checkout and
its captured manual/automatic game-master states. The custom automatic preview
and winner hold above are intentional broadcast adaptations.
The isolated browser QA can call `projectScene` and `paintScene` from
`src/graphics/presenter/scene.ts` without writing Replicants.
