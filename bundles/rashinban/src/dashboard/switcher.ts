// Switcher panel: one per output (body[data-output]). Edits go to the
// output's preview bus; TAKE copies preview to program and SWAP exchanges them. The monitors are
// the real graphics pages opened on the preview/program channel.
import { MAX_TEXT, withDefaults, layersEqual, type BroadcastOutput, type BroadcastState } from "../broadcast/state.ts";
import { controlRows, monitorUrls, patchAt, rowDirty, valueAt, type Control, type Row, type EnglishScene } from "../broadcast/switcher-model.ts";
import { bindMatch } from "../graphics/broadcast/match.ts";
import { findCaster, type Caster } from "../casters/casters.ts";
import { BROADCAST_MESSAGES, REPLICANTS } from "../types/replicants.ts";
import { mountIntervalTimer } from "./components/interval-timer.ts";
import { recoverMonitor } from "./components/monitor-recovery.ts";
import { mountMonitorResize } from "./components/monitor-resize.ts";

const output: BroadcastOutput = document.body.dataset.output === "en" ? "en" : document.body.dataset.output === "led" ? "led" : "stream";
const rep = nodecg.Replicant<BroadcastState>(REPLICANTS.broadcast);
const el = (id: string) => document.getElementById(id)!;
const strip = el("strip");
const rows = controlRows(output);
let state = withDefaults(undefined);
let casters: Caster[] = [];

async function send(name: string, body: unknown) {
  try {
    await nodecg.sendMessage(name, body);
    el("error").textContent = "";
  } catch (error) {
    el("error").textContent = (error as Error).message;
  }
}
const layers = () => state[output];
// Companion can still set one caster independently; clicking an active pair hides both.
const toggleOn = (value: unknown) => Array.isArray(value) ? value.some(v => v === true) : value === true;
function edit(control: Control, value: unknown) {
  const patch = patchAt(control.path, value, layers().preview);
  void send(BROADCAST_MESSAGES.setPreview, { output, patch });
}
/** Drop focus after a mouse click so Space/Enter go to TAKE, not the button. */
function blurAfterMouse(event: MouseEvent) {
  if (event.detail) (event.currentTarget as HTMLElement).blur();
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
      button.onclick = (event) => {
        edit(control, !toggleOn(valueAt(layers().preview, control.path)));
        blurAfterMouse(event);
      };
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
        text.maxLength = MAX_TEXT;
        input = text;
      }
      input.onchange = () => edit(control, input.value);
      // Reconcile after keyboard selection/revert while this widget had focus.
      input.onblur = () => render();
      widgets.set(control, input);
      label.append(input);
      controls.append(label);
    }
  }
  section.append(title, controls);
  if (output !== "led" && row.id === "interval") {
    mountIntervalTimer(controls, message => { el("error").textContent = message; }, output === "en");
  }
  return section;
}
strip.replaceChildren(...rows.map(buildRow));

const playerControl = rows.flatMap(row => row.controls).find(control =>
  control.kind === "select" && control.path[0] === "playerCards" && control.path[1] === "player");
if (playerControl) {
  const select = widgets.get(playerControl) as HTMLSelectElement;
  bindMatch(match => {
    // Update labels in place so a match refresh never changes the selected side.
    for (const option of select.options) {
      const side = option.value === "left" ? "left" : "right";
      option.textContent = `${side === "left" ? "P1" : "P2"} ${match?.[side].name || "TBD"}`;
    }
  }, output === "en");
}

function render() {
  const { preview, program } = layers();
  for (const row of rows) {
    strip.querySelector<HTMLElement>(`[data-row="${row.id}"]`)!.classList.toggle("dirty", rowDirty(row, preview, program));
    for (const control of row.controls) {
      const widget = widgets.get(control)!;
      const value = valueAt(preview, control.path);
      if (row.id === "lowerThird") {
        const mode = valueAt(preview, ["lowerThird", "mode"]);
        const container = control.kind === "toggle" ? widget : widget.parentElement!;
        container.hidden = control.path[1] === "comingUp" ? mode !== "match"
          : control.kind === "text" && mode !== "text";
      }
      if (control.kind === "select" && control.path[0] === "casters" && document.activeElement !== widget) {
        const select = widget as HTMLSelectElement;
        const selected = findCaster(casters, String(value ?? ""));
        const options = [new Option(casters.length ? "— none —" : "— no casters in sheet —", "")];
        for (const caster of casters) {
          options.push(new Option(caster.role ? `${caster.name} (${caster.role})` : caster.name,
            caster === selected ? String(value) : caster.name));
        }
        if (value && !selected) options.push(new Option(`${value} (not in sheet)`, String(value)));
        select.replaceChildren(...options);
      }
      if (control.kind === "toggle") {
        widget.classList.toggle("on", toggleOn(value));
        widget.setAttribute("aria-pressed", String(toggleOn(value)));
      } else if (document.activeElement !== widget) {
        widget.value = String(value ?? "");
      }
    }
  }
  (el("take") as HTMLButtonElement).disabled = layersEqual(preview, program);
  const swap = document.getElementById("swap") as HTMLButtonElement | null;
  if (swap) swap.disabled = layersEqual(preview, program);
}
render();
rep.on("change", (value) => {
  state = withDefaults(value);
  render();
});
if (output !== "led") {
  nodecg.Replicant<Caster[]>(output === "en" ? REPLICANTS.castersEn : REPLICANTS.casters).on("change", value => {
    casters = value ?? [];
    render();
  });
}

// ---- Actions -----------------------------------------------------------------
el("take").onclick = (event) => {
  void send(BROADCAST_MESSAGES.take, { output });
  blurAfterMouse(event);
};
el("revert").onclick = (event) => {
  void send(BROADCAST_MESSAGES.revertPreview, { output });
  blurAfterMouse(event);
};
for (const [id, message] of [["swap", BROADCAST_MESSAGES.swap], ["clear-preview", BROADCAST_MESSAGES.clearPreview]] as const) {
  const button = document.getElementById(id);
  if (button) button.onclick = (event) => {
    void send(message, { output });
    blurAfterMouse(event);
  };
}
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  if (target && ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY"].includes(target.tagName)) return;
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    el("take").click();
  }
});

// ---- Monitors ----------------------------------------------------------------
// URLs (and the role each presenter client gets) live in monitorUrls().
const STORAGE_KEY = `rashinban.switcher.${output}.presenterMonitors`;
const monitorsBox = el("presenter-monitors") as HTMLInputElement;
const monitorScene = document.getElementById("monitor-scene") as HTMLSelectElement | null;
if (monitorScene) monitorScene.onchange = applyMonitors;
function applyMonitors() {
  for (const monitor of document.querySelectorAll<HTMLElement>(".monitor")) {
    const channel = monitor.dataset.channel === "program" ? "program" : "preview";
    const urls = monitorUrls(output, channel, monitorScene?.value as EnglishScene | undefined);
    // The info monitor is cheap, so it is always loaded.
    const info = monitor.querySelector<HTMLIFrameElement>("iframe.info")!;
    if (!info.src.endsWith(urls.info)) info.src = urls.info;
    const presenter = monitor.querySelector<HTMLIFrameElement>("iframe.presenter")!;
    if (monitorsBox.checked) {
      if (!presenter.src.endsWith(urls.presenter)) presenter.src = urls.presenter;
      presenter.hidden = false;
    } else {
      // about:blank (not a removed src) tears down the page and its Maps instances.
      presenter.src = "about:blank";
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
for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe.info")) recoverMonitor(frame);
applyMonitors();
if (output !== "led") mountMonitorResize(document.querySelector<HTMLElement>(".monitors")!, output);
function fitMonitors() {
  for (const screen of document.querySelectorAll<HTMLElement>(".screen")) {
    screen.style.setProperty("--scale", String(Math.min(screen.clientWidth / 1920, screen.clientHeight / 1080)));
  }
}
const monitorObserver = new ResizeObserver(fitMonitors);
for (const screen of document.querySelectorAll<HTMLElement>(".screen")) monitorObserver.observe(screen);
fitMonitors();
