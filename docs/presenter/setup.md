# Presenter connection setup

The presenter extension reads GeoGuessr spectator state with the signed-in account's `_ncfa` cookie. It only observes the party and duel; start rounds and perform all game-control actions in GeoGuessr.

## Public NodeCG config

Copy `cfg/rashinban.example.json` to `cfg/rashinban.json`, then set:

- `partyId` to the broadcast party ID, or leave it `null` to use the signed-in account's active party.
- `clientVersion` to the current GeoGuessr web client version. The checked-in value matches the protocol capture and may need updating when GeoGuessr changes its client.
- `cookieFile` to the secret file path, resolved from the NodeCG working directory.

`cfg/rashinban.json` is injected into dashboard and graphic pages by NodeCG. It is ignored by Git and must contain only these public settings. Never add the cookie to this file.

## Server-only credential

Create `.secrets/geoguessr.json` in the repository root with this shape:

```json
{
  "cookie": ""
}
```

Paste only the `_ncfa` cookie value between the quotes. The `.secrets/` directory is ignored by Git, and the extension process reads this file directly. Keep the file local to the NodeCG host and restrict access to the account running NodeCG.

As an alternative, set the `GEOGUESSR_NCFA` environment variable for the NodeCG process. That variable takes precedence over `cookieFile`.

Restart NodeCG after changing either config. Authentication failures stop discovery without retrying; update the secret and restart or reconnect after the cookie expires. Network and game-server interruptions retry with bounded backoff while the extension continues polling the party for lobby changes.
