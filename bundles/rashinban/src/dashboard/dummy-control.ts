import { REPLICANTS } from "../types/replicants";

const lowerThirdVisible = nodecg.Replicant<boolean>(
  REPLICANTS.lowerThirdVisible,
);
const round = nodecg.Replicant<number>(REPLICANTS.round);

const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;
const roundValueEl = document.getElementById("round-value")!;
const incrementBtn = document.getElementById("increment") as HTMLButtonElement;
const decrementBtn = document.getElementById("decrement") as HTMLButtonElement;

toggleBtn.addEventListener("click", () => {
  lowerThirdVisible.value = !lowerThirdVisible.value;
});

incrementBtn.addEventListener("click", () => {
  round.value = (round.value ?? 1) + 1;
});

decrementBtn.addEventListener("click", () => {
  round.value = Math.max(1, (round.value ?? 1) - 1);
});

lowerThirdVisible.on("change", (newValue) => {
  const visible = Boolean(newValue);
  toggleBtn.textContent = visible ? "Hide Lower Third" : "Show Lower Third";
  toggleBtn.classList.toggle("active", visible);
});

round.on("change", (newValue) => {
  roundValueEl.textContent = String(newValue ?? 1);
});
