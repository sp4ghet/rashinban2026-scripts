import type NodeCG from "@nodecg/types";
import { registerMatch } from './match';

import { registerBanPick } from "./banpick";
import { registerBracket } from "./bracket";
import { registerCasters } from "./casters";
import { registerStartgg } from "./startgg";
import { registerSheet } from "./sheet";
import { registerPlayerCards } from "./playercards";

import { registerPresenter } from './presenter/register.ts';
import { initializeConfiguration } from './config/register.ts';
import { registerSharedAssets } from './config/assets.ts';

export = (nodecg: NodeCG.ServerAPI) => {
  const { store, roots } = initializeConfiguration(nodecg);
  registerSharedAssets(nodecg, roots);
  registerPresenter(nodecg, undefined, store);

  // HTTP endpoints for Bitfocus Companion (Generic HTTP module).
  // Mounted at http://<host>:9090/rashinban/...
  const router = nodecg.Router();

  registerBanPick(nodecg, router);
  registerStartgg(nodecg, router, store);
  registerBracket(nodecg, router);
  registerSheet(nodecg, router, store);
  registerCasters(nodecg, router);
  registerMatch(nodecg);
  registerPlayerCards(nodecg, router);

  nodecg.mount("/rashinban", router);

  nodecg.log.info(
    "rashinban extension loaded; Companion endpoints mounted at /rashinban",
  );
};
