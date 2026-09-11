# Isolated guest test players

Two Chrome browser contexts were created through CDP on port 9223, each with its own cookie/storage partition. Their guest names are **Presenter Bot Blue** and **Presenter Bot Red**. Ordinary tabs in a single normal profile would share cookies; these contexts do not. Both joined the existing private party through its guest form.

The host's existing two players were swapped to the bench, not removed from the party. The bots occupy the two Duels slots; the host remains game master. The existing auto-start-round setting was already enabled and was retained.

[auto-duel.js](samples/automation/auto-duel.js) is installed in both guest pages. It uses the current React Duels context's normal pin and guess callbacks, so the client submits its usual requests. It is restricted to the named private party and unrated games. Blue places a synthetic guess after 12 seconds and Red after 20 seconds, submitting on a later polling tick. It uses known test-round coordinates with unequal latitude offsets, except every third round uses equal offsets to exercise ties. This is presentation test data, not a geography-solving agent.

The loop continues across rounds and future games once those games are opened in these same pages, but does not start another match after a game finishes. A completed game's Continue screen can remain open when the host creates another game: click Continue and then Rejoin game in each bot session to enter it. It skips paused/finished rounds and already-guessed players. A full page reload removes the loop; rerun the script if needed. Closing the isolated windows ends their sessions.

In each bot tab's console:

```js
window.__rbAutoDuel.status() // recent pin/guess events
window.__rbAutoDuel.stop()   // stop that bot
```

Verification: the server accepted both automated round-2 guesses in game `6aa3d402b7185e2412ca1d8b`. Blue scored 4766, Red 3489; x1.5 produced 1916 damage, reducing Red to 4084 HP. Round 1 expired before installation was complete. The bot script remains enabled for subsequent rounds.

Implementation limitation: context discovery uses GeoGuessr's current React internals, so a client update can require adjusting it. Only one attempt per bot/game/round is made; errors are recorded rather than blindly resubmitted. No cookies or guest credentials are stored in these files.
