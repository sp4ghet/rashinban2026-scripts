import type NodeCG from "@nodecg/types";
import { registerMatch } from './match';

import { registerBanPick } from "./banpick";
import { registerBracket } from "./bracket";
import { loadLocalEnv } from "./env";
import { registerStartgg } from "./startgg";
import { registerSheet } from "./sheet";
import { registerPlayerCards } from "./playercards";

import { registerPresenter } from './presenter/register.ts';

export = (nodecg: NodeCG.ServerAPI) => {
  loadLocalEnv(nodecg);
  registerPresenter(nodecg);

  // HTTP endpoints for Bitfocus Companion (Generic HTTP module).
  // Mounted at http://<host>:9090/rashinban/...
  const router = nodecg.Router();

  registerBanPick(nodecg, router);
  registerStartgg(nodecg, router);
  registerBracket(nodecg, router);
  registerSheet(nodecg, router);
  registerMatch(nodecg);
  registerPlayerCards(nodecg, router);

  nodecg.mount("/rashinban", router);

  nodecg.log.info(
    "rashinban extension loaded; Companion endpoints mounted at /rashinban",
  );
};
