import { layersEqual, withDefaults, type BroadcastState, type CastersLayer, type Patch } from "../broadcast/state.ts";
import { monitorUrls } from "../broadcast/switcher-model.ts";
import { BROADCAST_MESSAGES, REPLICANTS } from "../types/replicants.ts";

const outputSelect = document.querySelector<HTMLSelectElement>("#output")!;
const frame = document.querySelector<HTMLIFrameElement>("#preview")!;
const screen = document.querySelector<HTMLElement>(".screen")!;
const take = document.querySelector<HTMLButtonElement>("#take")!;
const revert = document.querySelector<HTMLButtonElement>("#revert")!;
const error = document.querySelector<HTMLElement>("#error")!;
const output = () => outputSelect.value === "en" ? "en" : "stream";
let state = withDefaults(undefined);
let pending = 0;
let queue = Promise.resolve();

function send(name: string, data: unknown) {
  pending++;
  render();
  queue = queue.then(async () => {
    try { await nodecg.sendMessage(name, data); error.textContent = ""; }
    catch (cause) { error.textContent = (cause as Error).message; }
    finally { pending--; render(); }
  });
}
function edit(casters: Patch<CastersLayer>) {
  send(BROADCAST_MESSAGES.setPreview, { output: output(), patch: { casters } });
}

const inputs: { side: keyof CastersLayer["positions"]; axis: "x" | "y"; slider: HTMLInputElement; exact: HTMLInputElement }[] = [];
for (const side of ["left", "right", "center"] as const) {
  const group = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = `${side[0]!.toUpperCase()}${side.slice(1)} card`;
  group.append(legend);
  for (const axis of ["x", "y"] as const) {
    const row = document.createElement("div"); row.className = "axis";
    const label = document.createElement("label"); label.textContent = axis.toUpperCase();
    const slider = document.createElement("input"); slider.type = "range"; slider.id = `${side}-${axis}`;
    label.htmlFor = slider.id;
    const exact = document.createElement("input"); exact.type = "number"; exact.id = `${side}-${axis}-number`;
    for (const input of [slider, exact]) {
      const limit = axis === "x" ? 1920 : 1080;
      input.min = String(-limit); input.max = String(limit); input.step = "1"; input.value = "0"; input.required = true;
      input.setAttribute("aria-label", `${side} card ${axis.toUpperCase()} offset${input === slider ? " slider" : " pixels"}`);
      input.oninput = () => {
        if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) return;
        slider.value = exact.value = input.value;
        edit({ positions: { [side]: { [axis]: input.valueAsNumber } } });
      };
      input.onblur = render;
    }
    row.append(label, slider, exact); group.append(row);
    inputs.push({ side, axis, slider, exact });
  }
  const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "Reset position";
  reset.id = `${side}-reset`;
  reset.onclick = () => edit({ positions: { [side]: { x: 0, y: 0 } } });
  group.append(reset); document.querySelector("#positions")!.append(group);
}

function render() {
  const bus = state[output()];
  for (const { side, axis, slider, exact } of inputs) {
    // Preserve the current drag/draft while queued updates arrive.
    if (pending || document.activeElement === slider || document.activeElement === exact) continue;
    slider.value = exact.value = String(bus.preview.casters.positions[side][axis]);
  }
  take.disabled = revert.disabled = pending > 0 || layersEqual(bus.preview, bus.program);
}
outputSelect.onchange = () => {
  frame.src = monitorUrls(output(), "preview", "casters").info;
  render();
};
take.onclick = () => send(BROADCAST_MESSAGES.take, { output: output() });
revert.onclick = () => send(BROADCAST_MESSAGES.revertPreview, { output: output() });
nodecg.Replicant<BroadcastState>(REPLICANTS.broadcast).on("change", value => { state = withDefaults(value); render(); });
frame.src = monitorUrls(output(), "preview", "casters").info;
new ResizeObserver(() => screen.style.setProperty("--scale", String(screen.clientWidth / 1920))).observe(screen);
render();
