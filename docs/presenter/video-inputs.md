# Player video inputs in OBS

**Video input** is the third presenter presentation, alongside Rendered and
Chroma. It captures two independent video devices on the OBS computer and
draws their complete player feeds inside the presenter. No player-feed chroma
key is needed. Player cameras still use the existing camera slots and regional
keying described in [OBS composition](obs.md).

## Setup

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
devices after disconnects or permission errors. Refreshing the device list
does not silently change assignments.

Only the current program owner acquires devices. Preview and standby graphics
do not capture, including through the permission button. Select the intended
program in the dashboard if setup reports inactive. Keep **Shutdown source
when not visible** and **Refresh browser when scene becomes active** disabled,
and reuse the same Browser Source across scenes. Capture stops on ownership
loss, leaving Video input mode, or closing/reloading the page.

The LED presenter uses rendered player views when Video input is selected for
the stream. It does not open capture devices or expose capture setup; broadcast
bus blanking and silent LED celebrations continue to work independently.

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
- The presenter retains the last permitted video frame when it observes both
  guesses or settled round data. Celebrations reuse those pixels, without
  sampling later video. Locked-player maps also remain during celebrations.
  Other non-live scenes hide player video. First-round and next-round previews
  show the rendered panorama, empty world map and existing label/countdown.
- A disconnected, missing or denied device shows a neutral placeholder in its
  player window. Detailed messages and reconnect controls stay in local setup.

Freezing follows received game state; capture video and GeoGuessr telemetry are
separate clocks. Check their relative latency with real feeds, especially at
round completion. This mode does not buffer video to compensate for a feed that
reveals native results before the presenter receives the corresponding event.

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
permission failures, unavailable devices and preview isolation. Physical card
drivers, sustained two-feed performance, HDMI signal loss/recovery and video /
telemetry / audio latency remain hardware acceptance checks.
