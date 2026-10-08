// Switcher panel: one per output (body[data-output]). Edits go to the
// output's preview bus; TAKE copies preview to program. The monitors are
// the real graphics pages opened on the preview/program channel.
import { MAX_TEXT, withDefaults, layersEqual, type BroadcastOutput, type BroadcastState } from "../broadcast/state.ts";
import { controlRows, monitorUrls, patchAt, rowDirty, valueAt, type Control, type Row } from "../broadcast/switcher-model.ts";
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
        edit(control, !(valueAt(layers().preview, control.path) as boolean));
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
      if (control.kind === "toggle") {
        widget.classList.toggle("on", value === true);
        widget.setAttribute("aria-pressed", String(value === true));
      } else if (document.activeElement !== widget) {
        widget.value = String(value ?? "");
      }
    }
  }
  (el("take") as HTMLButtonElement).disabled = layersEqual(preview, program);
}
render();
rep.on("change", (value) => {
  state = withDefaults(value);
  render();
});

// ---- Actions -----------------------------------------------------------------
el("take").onclick = (event) => {
  void send(BROADCAST_MESSAGES.take, { output });
  blurAfterMouse(event);
};
el("revert").onclick = (event) => {
  void send(BROADCAST_MESSAGES.revertPreview, { output });
  blurAfterMouse(event);
};
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  if (target && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    el("take").click();
  }
});

// ---- Monitors ----------------------------------------------------------------
// URLs (and the role each presenter client gets) live in monitorUrls().
const STORAGE_KEY = `rashinban.switcher.${output}.presenterMonitors`;
const monitorsBox = el("presenter-monitors") as HTMLInputElement;
function applyMonitors() {
  for (const monitor of document.querySelectorAll<HTMLElement>(".monitor")) {
    const channel = monitor.dataset.channel === "program" ? "program" : "preview";
    const urls = monitorUrls(output, channel);
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
applyMonitors();
function fitMonitors() {
  for (const screen of document.querySelectorAll<HTMLElement>(".screen")) {
    screen.style.setProperty("--scale", String(screen.clientWidth / 1920));
  }
}
new ResizeObserver(fitMonitors).observe(document.body);
fitMonitors();
