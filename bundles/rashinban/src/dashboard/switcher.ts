// Switcher panel: one per output (body[data-output]). Edits go to the
// output's preview bus; TAKE copies preview to program. The monitors are
// the real graphics pages opened on the preview/program channel.
import { withDefaults, layersEqual, type BroadcastOutput, type BroadcastState } from "../broadcast/state.ts";
import { controlRows, patchAt, rowDirty, valueAt, type Control, type Row } from "../broadcast/switcher-model.ts";
import { BROADCAST_MESSAGES, REPLICANTS } from "../types/replicants.ts";

const output: BroadcastOutput = document.body.dataset.output === "led" ? "led" : "stream";
const rep = nodecg.Replicant<BroadcastState>(REPLICANTS.broadcast);
const el = (id: string) => document.getElementById(id)!;
const strip = el("strip");
const rows = controlRows(output);
let state = withDefaults(undefined);

async function send(name: string, body: unknown) {
  try {
    await nodecg.sendMessage(name, body);
    el("error").textContent = "";
  } catch (error) {
    el("error").textContent = (error as Error).message;
  }
}
const layers = () => state[output];
function edit(control: Control, value: unknown) {
  void send(BROADCAST_MESSAGES.setPreview, { output, patch: patchAt(control.path, value, layers().preview) });
}

// ---- Strip -------------------------------------------------------------------
type Widget = HTMLButtonElement | HTMLInputElement | HTMLSelectElement;
const widgets = new Map<Control, Widget>();
function buildRow(row: Row): HTMLElement {
  const section = document.createElement("div");
  section.className = "row";
  section.dataset.row = row.id;
  const title = document.createElement("h4");
  title.textContent = row.title;
  const controls = document.createElement("div");
  controls.className = "controls";
  for (const control of row.controls) {
    if (control.kind === "toggle") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toggle";
      button.textContent = control.label;
      button.onclick = () => edit(control, !(valueAt(layers().preview, control.path) as boolean));
      widgets.set(control, button);
      controls.append(button);
    } else {
      const label = document.createElement("label");
      label.textContent = control.label;
      let input: HTMLInputElement | HTMLSelectElement;
      if (control.kind === "select") {
        const select = document.createElement("select");
        for (const [value, text] of control.options) select.add(new Option(text, value));
        input = select;
      } else {
        const text = document.createElement("input");
        text.type = "text";
        text.maxLength = 120;
        input = text;
      }
      input.onchange = () => edit(control, input.value);
      widgets.set(control, input);
      label.append(input);
      controls.append(label);
    }
  }
  section.append(title, controls);
  return section;
}
strip.replaceChildren(...rows.map(buildRow));

function render() {
  const { preview, program } = layers();
  for (const row of rows) {
    strip.querySelector<HTMLElement>(`[data-row="${row.id}"]`)!.classList.toggle("dirty", rowDirty(row, preview, program));
    for (const control of row.controls) {
      const widget = widgets.get(control)!;
      const value = valueAt(preview, control.path);
      if (control.kind === "toggle") widget.classList.toggle("on", value === true);
      else if (document.activeElement !== widget) widget.value = String(value ?? "");
    }
  }
  (el("take") as HTMLButtonElement).disabled = layersEqual(preview, program);
}
rep.on("change", (value) => {
  state = withDefaults(value);
  render();
});

// ---- Actions -----------------------------------------------------------------
el("take").onclick = () => void send(BROADCAST_MESSAGES.take, { output });
el("revert").onclick = () => void send(BROADCAST_MESSAGES.revertPreview, { output });
document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    el("take").click();
  }
});

// ---- Monitors ----------------------------------------------------------------
// Stream monitors open the presenter as a silent preview client so they never
// take the program lease; LED monitors open presenter-led.html, which implies
// the led role and shows exactly what the wall shows (muted video included).
const STORAGE_KEY = `rashinban.switcher.${output}.presenterMonitors`;
const monitorsBox = el("presenter-monitors") as HTMLInputElement;
function presenterUrl(channel: string) {
  return output === "led"
    ? `/bundles/rashinban/graphics/presenter-led.html?channel=${channel}`
    : `/bundles/rashinban/graphics/presenter.html?role=preview&channel=${channel}`;
}
function applyMonitors() {
  for (const monitor of document.querySelectorAll<HTMLElement>(".monitor")) {
    const channel = monitor.dataset.channel!;
    // The info monitor is cheap, so it is always loaded.
    const info = monitor.querySelector<HTMLIFrameElement>("iframe.info")!;
    const infoSrc = `/bundles/rashinban/graphics/info-${output}.html?channel=${channel}`;
    if (!info.src.endsWith(infoSrc)) info.src = infoSrc;
    const presenter = monitor.querySelector<HTMLIFrameElement>("iframe.presenter")!;
    if (monitorsBox.checked) {
      const src = presenterUrl(channel);
      if (!presenter.src.endsWith(src)) presenter.src = src;
      presenter.hidden = false;
    } else {
      presenter.removeAttribute("src");
      presenter.hidden = true;
    }
  }
}
try {
  monitorsBox.checked = localStorage.getItem(STORAGE_KEY) === "1";
} catch {
  /* storage unavailable */
}
monitorsBox.onchange = () => {
  try {
    localStorage.setItem(STORAGE_KEY, monitorsBox.checked ? "1" : "0");
  } catch {
    /* ignore */
  }
  applyMonitors();
};
applyMonitors();
function fitMonitors() {
  for (const screen of document.querySelectorAll<HTMLElement>(".screen")) {
    screen.style.setProperty("--scale", String(screen.clientWidth / 1920));
  }
}
new ResizeObserver(fitMonitors).observe(document.body);
fitMonitors();
