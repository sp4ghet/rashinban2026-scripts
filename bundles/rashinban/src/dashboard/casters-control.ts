// Casters panel: pick who is on each card and toggle each card on air.
import { findCaster, withDefaults, type Caster, type CastersState } from "../casters/casters";
import { CASTERS_MESSAGES, REPLICANTS } from "../types/replicants";

const casters = nodecg.Replicant<Caster[]>(REPLICANTS.casters);
const state = nodecg.Replicant<CastersState>(REPLICANTS.castersState);

const el = (id: string) => document.getElementById(id)!;
const SLOTS = [0, 1] as const;

async function send(slot: number, value: { name?: string; enabled?: boolean }) {
  try {
    await nodecg.sendMessage(CASTERS_MESSAGES.setSlot, { slot, ...value });
    el("error").textContent = "";
  } catch (error) {
    el("error").textContent = (error as Error).message;
  }
}

for (const slot of SLOTS) {
  const select = el(`slot-${slot}-name`) as HTMLSelectElement;
  select.onchange = () => void send(slot, { name: select.value });
  el(`slot-${slot}-enabled`).onclick = () => {
    const current = withDefaults(state.value ?? undefined);
    void send(slot, { enabled: !current.slots[slot]!.enabled });
  };
}

function render() {
  const current = withDefaults(state.value ?? undefined);
  const list = casters.value ?? [];

  for (const slot of SLOTS) {
    const { name, enabled } = current.slots[slot]!;
    const select = el(`slot-${slot}-name`) as HTMLSelectElement;
    // Rebuilding wholesale is fine: the list is a handful of rows.
    const options = ['<option value="">— none —</option>'];
    for (const caster of list) {
      const label = caster.role ? `${caster.name} (${caster.role})` : caster.name;
      const selected = caster.name === name ? " selected" : "";
      options.push(`<option value="${caster.name}"${selected}>${label}</option>`);
    }
    // Keep a stale selection visible rather than silently switching to "none".
    if (name && !findCaster(list, name)) {
      options.push(`<option value="${name}" selected>${name} (not in sheet)</option>`);
    }
    if (document.activeElement !== select) select.innerHTML = options.join("");

    const button = el(`slot-${slot}-enabled`);
    button.textContent = enabled ? "Visible" : "Hidden";
    button.classList.toggle("active", enabled);
  }

  const live = SLOTS.map((slot) => {
    const { name, enabled } = current.slots[slot]!;
    const caster = findCaster(list, name);
    if (!enabled || !caster) return null;
    return caster.twitter ? `${caster.name} @${caster.twitter}` : caster.name;
  }).filter(Boolean);

  el("preview").textContent = live.length
    ? live.join("\n")
    : list.length
      ? "No cards visible"
      : "No casters in the sheet (check Config → Google Sheets)";
}

casters.on("change", render);
state.on("change", render);
