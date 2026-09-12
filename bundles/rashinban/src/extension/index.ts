import type NodeCG from "@nodecg/types";
import { registerMatch } from './match';

import { registerBanPick } from "./banpick";
import { registerStartgg } from "./startgg";
import { registerSheet } from "./sheet";
import { registerPlayerCards } from "./playercards";

import { registerPresenter } from './presenter/register.ts';
import { initializeConfiguration } from './config/register.ts';

export = (nodecg: NodeCG.ServerAPI) => {
  const { store } = initializeConfiguration(nodecg);
  registerPresenter(nodecg, undefined, store);

  // HTTP endpoints for Bitfocus Companion (Generic HTTP module).
  // Mounted at http://<host>:9090/rashinban/...
  const router = nodecg.Router();

  registerBanPick(nodecg, router);
  registerStartgg(nodecg, router, store);
  registerSheet(nodecg, router, store);
  registerMatch(nodecg);
  registerPlayerCards(nodecg, router);

  nodecg.mount("/rashinban", router);

  nodecg.log.info(
    "rashinban extension loaded; Companion endpoints mounted at /rashinban",
  );
};
