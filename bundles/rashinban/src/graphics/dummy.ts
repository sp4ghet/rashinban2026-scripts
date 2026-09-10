import { REPLICANTS } from "../types/replicants";

const lowerThirdVisible = nodecg.Replicant<boolean>(
  REPLICANTS.lowerThirdVisible,
);
const round = nodecg.Replicant<number>(REPLICANTS.round);

const lowerThirdEl = document.getElementById("lower-third")!;
const roundEl = document.getElementById("round")!;

lowerThirdVisible.on("change", (newValue) => {
  lowerThirdEl.classList.toggle("visible", Boolean(newValue));
});

round.on("change", (newValue) => {
  roundEl.textContent = `ROUND ${newValue ?? 1}`;
});
