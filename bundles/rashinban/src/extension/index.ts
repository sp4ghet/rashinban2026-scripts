import type NodeCG from "@nodecg/types";

import { REPLICANTS } from "../types/replicants";

export = (nodecg: NodeCG.ServerAPI) => {
  const lowerThirdVisible = nodecg.Replicant<boolean>(
    REPLICANTS.lowerThirdVisible,
    { defaultValue: false },
  );
  const round = nodecg.Replicant<number>(REPLICANTS.round, {
    defaultValue: 1,
  });

  // HTTP endpoints for Bitfocus Companion (Generic HTTP module).
  // Mounted at http://<host>:9090/rashinban/...
  const router = nodecg.Router();

  router.post("/lower-third/toggle", (_req, res) => {
    lowerThirdVisible.value = !lowerThirdVisible.value;
    res.json({ lowerThirdVisible: lowerThirdVisible.value });
  });

  router.post("/lower-third/show", (_req, res) => {
    lowerThirdVisible.value = true;
    res.json({ lowerThirdVisible: lowerThirdVisible.value });
  });

  router.post("/lower-third/hide", (_req, res) => {
    lowerThirdVisible.value = false;
    res.json({ lowerThirdVisible: lowerThirdVisible.value });
  });

  router.post("/round/increment", (_req, res) => {
    round.value = (round.value ?? 1) + 1;
    res.json({ round: round.value });
  });

  router.post("/round/decrement", (_req, res) => {
    round.value = Math.max(1, (round.value ?? 1) - 1);
    res.json({ round: round.value });
  });

  nodecg.mount("/rashinban", router);

  nodecg.log.info(
    "rashinban extension loaded; Companion endpoints mounted at /rashinban",
  );
};
