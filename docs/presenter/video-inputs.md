# Player video inputs in OBS

**Video input** is the third presenter presentation, alongside Rendered and
Chroma. It uses two independent video feeds, captured directly or through the relay, and
draws their complete player feeds inside the presenter. No player-feed chroma
key is needed. Player cameras can use the same relay, or the existing external camera slots
and regional keying described in [OBS composition](obs.md).

## Direct input setup

After updating the code, rebuild and restart NodeCG, then reload the dashboard
and presenter sources so the server and graphics both recognize the new mode.

1. Connect both player screen feeds to the OBS computer. Each must appear as a
   separate browser-compatible video input. Release them from any other OBS
   capture sources or applications if the driver allows only one consumer.
2. Launch OBS with `--enable-media-stream`, for example by adding that argument
   to its shortcut. This flag grants media access to OBS browser content, so use
   trusted Browser Source URLs. The presenter requests video only, never audio.
3. Load the program Browser Source at **1920 × 1080, 60 fps**, using
   `http://localhost:9090/bundles/rashinban/graphics/presenter.html?role=program`
   when NodeCG is local. A remote NodeCG installation needs a trusted **HTTPS**
   URL (including its WebSocket connection); plain HTTP on a LAN/Tailscale
   hostname or IP does not enable browser capture. Devices belong to the OBS
   computer even when NodeCG runs elsewhere.
4. In the presenter dashboard, select **Video input · capture devices** under
   **Player views** and save the presentation settings.
5. Right-click the active program Browser Source → **Interact**, click inside
   the page and press **F8**. Click **Find inputs / allow video**, select the
   left and right devices, and click **Apply inputs**. Check both live previews.
   Device choices use expanded, scrollable lists: click a row or use the arrow
   keys. They do not open native dropdown popups, which OBS may not display.
6. Close setup with its button or **F8** before going on air. The setup panel
   is part of the output while open. There is no permanent setup button on the
   broadcast image. `&videoSetup=1` opens setup on every reload for off-air setup.

If F8 does nothing, refresh the Browser Source after updating the presenter,
then click inside its Interact preview before pressing F8. Windows OBS can send
`key: "F8"` with an empty `code`; the presenter handles both forms and ignores
key repeat. `&videoSetup=1` also opens setup without keyboard input.

**Find inputs / allow video** lists available device IDs before opening any
camera. It only probes the default camera for permission when the browser has
not exposed selectable inputs, and retries the list even if that probe fails.
A busy or inactive default camera therefore does not block other exposed
devices. A **Device discovery failed** message concerns finding inputs; an error
beneath a player preview concerns opening that player's selected device.
`NotReadableError` or `AbortError` can indicate a driver, connection or device-use
problem; the message does not prove another application owns every input.

Input assignments persist in the OBS browser's local storage for that origin.
They are separate from Chrome and the dashboard and are not stored on NodeCG.
Changing the URL origin, clearing OBS browser storage, or changing device IDs
may require reselecting inputs. An unavailable saved device never falls back to
the default webcam. The same device cannot be assigned to both players.

**Swap feeds** swaps the saved physical input assignments. Use it when changing
which input belongs on each side; Current Match player swaps do not identify or
automatically reassign physical capture cables. **Reconnect** retries selected
devices after disconnects or permission errors. Transient device failures retry
automatically after 0.5, 1.5, 3 and 5 seconds, then stop. A browser device-change
event retries a failed input when its saved device is available again, without
restarting the healthy input. Permission denials require **Reconnect** after
fixing access. Refreshing the device list does not silently change assignments;
swapping also preserves unavailable saved devices.

For the stream, only the current program owner acquires devices. The LED
program output captures independently, without taking the stream's ownership
or playing audio. Preview and standby stream graphics do not capture, including
through the permission button. Legacy LED preview URLs (`?channel=preview`) and
explicit `?role=preview` pages also do not capture. Select the intended stream
program in the dashboard if its setup reports inactive. Keep **Shutdown source
when not visible** and **Refresh browser when scene becomes active** disabled,
and reuse the same Browser Source across scenes. Stream capture stops on
ownership loss (including an expired lease or stale server clock). Both outputs
release inputs when leaving Video input mode or closing/reloading the page.
Pending retries are cancelled too.

The LED presenter follows the same Player views setting, including Video input.
Open the always-on `presenter-led.html` source in OBS and use
**Interact / F8** during off-air setup to assign the LED's left and right
inputs. Its assignments start empty and are saved separately from the stream's
assignments, even at the same URL origin. Reload both Browser Sources after
updating. The LED keeps its 1920 × 576 layout, comparison maps on locked sides,
frozen celebration frames and silent celebrations. Select or blank the LED
output in OBS/ATEM while keeping its browser source running to keep capture
warm. Leave Video input mode or close the source to release the LED's inputs.
An expired server clock also releases them.

## Share inputs through the WebRTC relay

Use the relay when the stream and LED need the same physical player inputs.
One capture page opens each input once and sends both raw player feeds to each
presenter. Each presenter still applies its own layouts, locked-player maps and
frame freezes. Media travels directly over WebRTC; NodeCG handles connection
setup and ownership only. No additional hardware or npm packages are required.

After building and restarting NodeCG, open these URLs on the same NodeCG server:

| Purpose | Local URL |
| --- | --- |
| Capture owner | `http://localhost:9090/bundles/rashinban/graphics/presenter-capture.html?relay=main` |
| Stream Browser Source | `http://localhost:9090/bundles/rashinban/graphics/presenter.html?role=program&videoRelay=main` |
| LED Browser Source | `http://localhost:9090/bundles/rashinban/graphics/presenter-led.html?videoRelay=main` |

1. Open the capture page in Chrome on the computer connected to the capture
   card. Click **Start relay**, then **Find inputs / allow video** if needed.
   Select left/right devices and **Apply inputs**. Check both previews. A new
   relay starts with empty assignments; its saved assignments are separate
   from the stream and LED's direct-capture assignments.
2. Set the dashboard's Player views to **Video input**. Load the two receiver
   URLs in OBS with the existing output dimensions. Select the intended stream
   program owner; the LED presenter stays on and is selected in OBS/ATEM.
3. Keep the capture page open and the capture computer awake. Avoid browser
   memory/energy-saving suspension for this page. Receiver **Interact → F8**
   shows relay status; inputs are configured on the capture page. Receiver
   **Reconnect** retries its subscription without reopening hardware.
4. Click **Stop relay** to release the physical inputs. Reloading the capture
   page also releases them and requires **Start relay** again. Reloading either
   presenter, leaving Video input mode, or closing a receiver leaves the owner
   and the other output running.

The capture browser needs localhost or trusted HTTPS and camera permission.
A capture page inside OBS instead needs its media-stream launch flag described
above. Relay-only receiver pages never request camera access or silently fall
back to physical devices. They ignore their saved direct input assignments.
Removing `videoRelay` from a presenter URL restores direct input operation.

The room name must match in all three URLs: 1–64 letters, digits, underscores
or hyphens. Keep a single room for the physical input pair. The broker allows
one publisher per room; a second Start reports busy and waits until that room
is free. Different room names do not protect the same hardware from contention.
Direct OBS capture sources or other applications can still hold the device.

The capture owner renews a six-second lease and releases inputs before its local
deadline if signaling stops. Presenters clear disconnected feeds and reconnect
when the owner returns. Lost connection-setup messages retry after 12 seconds.
A frozen browser or sleeping OS cannot execute that release logic: close a
stuck capture page before starting a replacement. The lease is not a device
lock enforced by the capture driver.

The default relay uses local WebRTC connections with no public STUN/TURN
service. Start with all three pages on the same computer. A venue LAN can work
when the browsers can reach each other, but firewall/routing compatibility
needs testing. All pages must use the same NodeCG instance; a remote capture
computer needs its own reachable trusted HTTPS URL, not the OBS computer's
`localhost`.

WebRTC encodes the feeds independently for each viewer. Resolution, frame rate,
compression and delay can adapt to CPU/GPU and network load. This is not an
uncompressed or frame-synchronized distribution path. Check text/map clarity,
sustained two-feed performance and the stream/LED delay with the actual machines.
The existing video/telemetry frame-freeze boundary remains in each receiver;
the relay does not compensate for a player feed arriving ahead of telemetry.

### Player cameras through the same relay

The capture page also has optional **Left player camera** and **Right player
camera** inputs. Assign each camera once alongside the gameplay inputs and
click **Apply inputs**. A physical device cannot occupy more than one slot.
Existing saved two-input selections load with both cameras unassigned.

Use the capture page's **Stream with player cameras** link, or add
`&relayCameras=1` to the stream's `videoRelay` URL:

`http://localhost:9090/bundles/rashinban/graphics/presenter.html?role=program&videoRelay=main&relayCameras=1`

The relayed cameras fill the existing stream camera boxes, preserve aspect ratio
with a centered crop, and remain silent. They stay live during gameplay freezes,
results, waiting scenes, and Rendered/Chroma modes. For cameras with rendered
gameplay, leave both gameplay inputs unassigned and select Rendered in the
dashboard; the camera subscription does not depend on Video input mode.

Program ownership loss or an expired server clock releases camera subscriptions.
Stopping the capture owner clears both camera videos; restarting it reconnects
automatically. Missing/unassigned camera feeds show a neutral placeholder,
without falling back to a webcam or an OBS capture source.

**Swap players** on the capture page swaps gameplay and camera assignments
together. Match/series player swaps do not change the physical assignments.
Device choices stay local to the capture browser and named room.

Existing stream URLs without `relayCameras=1` retain their external-camera key
regions. The capture page includes a **Stream with external cameras** link for
that composition. The LED layout has no camera boxes and declines the camera
tracks. Neither gameplay-only stream nor LED receivers require camera encoding
or transport after WebRTC negotiation.

Remove regional camera chroma-key filters for the relayed-camera composition;
the browser now draws real camera pixels in those boxes. Full-screen celebration
videos still cover the camera layer. Keep camera audio routed separately.

## DeckLink compatibility

The relay avoids two presenter pages independently opening the same input.
The capture page still requires each HDMI channel to be exposed as a usable
browser video device by the installed driver.

Blackmagic's developer support identifies an input already enabled by another
application as a common cause of `IDeckLinkInput.EnableVideoInput` failure:
[DeckLink input access guidance](https://forum.blackmagicdesign.com/viewtopic.php?f=12&t=187750).
Multiple HDMI channels let you capture multiple player PCs; they do not by
themselves promise multiple consumers of each channel.

DeckLink provides Windows WDM/DirectShow support, but verify that the exact card,
Desktop Video driver and capture browser expose **each required HDMI channel**
in **Find inputs / allow video**, and can actually open it at the desired format.
Working as an OBS Blackmagic Device source alone does not verify browser capture.
See [Blackmagic's software interfaces](https://www.blackmagicdesign.com/products/decklink/software/).
A native DeckLink SDK-to-WebRTC bridge is outside this implementation.
Rehearse simultaneous stream/LED operation, source reloads and HDMI signal
loss/recovery before using the hardware on air.


## Presentation

- MOVE, NM and NMPZ each show two complete feeds, including the native player
  map and UI. Aspect ratio is preserved with letterboxing where necessary.
- Equal windows are 922 × 519. One player's lock replaces that feed with the
  rendered view's 574 × 574 comparison map and enlarges the other feed to
  1270 × 714 at y=144 over 350 ms, matching the rendered layout in either
  lock direction. The comparison map shows submitted
  guesses and the opponent's current pin, without revealing the answer.
  Both locks restore equal windows containing comparison maps; the next live
  round restores both video feeds.
- Google renders locked-player maps, round-preview panoramas and the results
  map. Active players continue to use their captured screen, including its
  native minimap. The Google browser key is needed for these rendered scenes.
- The presenter retains the last permitted video frame when the synchronized
  round countdown reaches zero, or it observes both guesses or settled round
  data. Celebrations reuse those pixels, without sampling later video. A muted
  input keeps its held frame until the signal returns. Locked-player maps also
  remain during celebrations.
  Other non-live scenes hide player video. First-round and next-round previews
  show the rendered panorama, empty world map and existing label/countdown.
- A disconnected, missing or denied device shows a neutral placeholder in its
  player window. Detailed messages and reconnect controls stay in local setup.

Freezing follows the known deadline and received game state; capture video and
GeoGuessr telemetry are separate clocks. Check their relative latency with real
feeds, especially at round completion. This mode does not buffer video to
compensate for a feed that reveals native results before the known deadline or
before the presenter receives the corresponding event.

Apply chroma key only to remaining camera regions. A whole-source chroma key
would also remove matching colors from the captured gameplay. Existing audio
routing and any measured render delay still need validation with the new cards.

## Verification

After `npm run build`, run:

```powershell
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-presenter-video.mjs
```

The script uses a separate Chrome profile, the real built presenter, simulated
NodeCG state and two Chromium fake video devices. It does not contact live
NodeCG or open physical cameras. Evidence is saved under
`artifacts/presenter-validation/video-inputs/`.

Set `PRESENTER_VIDEO_TEST_MAPS_KEY` to a browser Maps key to also verify live
Google map surfaces and round-preview panorama loading. Without a key, the
script checks scene/layout transitions and capture behavior; renderer unit
tests cover the map and panorama selection logic.

For OBS validation, copy an OBS installation into
`artifacts/presenter-validation/video-inputs/obs-portable/`, then set
`OBS_VIDEO_TEST_PATH` to that copy's `bin/64bit/obs64.exe` and run the same script.
It creates a dedicated portable configuration and scene, launches a second OBS
with fake devices, and closes only that test process. The script rejects OBS
paths outside its validation directory. It does not edit the running production
OBS configuration. Fake-device launch flags are for this test only; never add
them to the broadcast OBS shortcut.

The local acceptance used OBS **32.2.2 / Chromium 127.0.6533.120**, with two
simultaneous simulated inputs. It covers frame updates, all three movement
modes, both resize directions, F8 setup, frozen celebration pixels, mode
switching, assignment swapping/persistence, ownership changes, disconnects,
permission failures, unavailable devices and preview isolation. The browser
script also verifies LED video selection, independent saved assignments,
capture without stream ownership, LED lock geometry, frame freezing, mode
switching, always-on LED behavior despite legacy bus visibility settings, and
legacy LED preview-URL capture isolation. It also checks
hidden setup playback, 30 fps input sampling at 60 Hz, automatic recovery,
timeout freezing, mute retention, idle canvas work and unavailable-device swaps.
Physical card drivers, sustained two-feed performance, HDMI signal loss/recovery and video /
telemetry / audio latency remain hardware acceptance checks.


### Relay verification

After building, run:

```powershell
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-presenter-relay.mjs
```

This starts an isolated HTTP signaling fixture using the actual relay broker,
the built capture/stream/LED pages and real Chromium WebRTC connections. It
uses simulated NodeCG state and two encodable fake camera feeds, never the
running NodeCG server or physical inputs. The second default Chromium fake
camera is a depth stream, so this fixture uses the first and third cameras.

The harness checks simultaneous left/right delivery, zero receiver camera
calls, publisher exclusion, receiver reload/mode changes, swaps, a missing
input, publisher stop/restart, signaling interruption, lost offer and answer
acknowledgements, frozen stream frames with live LED video, preview isolation,
and visible connection status. Reports and screenshots are saved under
`artifacts/presenter-validation/relay/`. Unit tests cover the broker's role/
room boundaries, bounded queues, lease expiry and delayed acknowledgements.

DeckLink, OBS's WebRTC implementation, venue LAN connectivity, long-duration
performance, source signal-loss behavior, and measured audio/video/telemetry
latency remain production rehearsal checks. Browser fake-camera acceptance
does not establish any of those hardware results.

Run the four-feed camera acceptance with:

```powershell
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-presenter-relay.mjs --cameras
```

It adds two simulated player cameras to the existing gameplay feeds and checks
camera identity, silent playback, existing camera geometry, duplicate-input
rejection, live reactions during gameplay freezes, rendered/chroma and camera-only
operation, swaps, missing-camera recovery, ownership loss, publisher shutdown,
and preview isolation. Camera reports/screenshots are under
`artifacts/presenter-validation/relay-cameras/`.
