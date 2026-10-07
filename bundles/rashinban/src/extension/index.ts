import type NodeCG from "@nodecg/types";
import { registerMatch } from './match';

import { registerBanPick } from "./banpick";
import { registerBroadcast } from "./broadcast";
import { registerBracket } from "./bracket";
import { registerCasters } from "./casters";
import { registerStartgg } from "./startgg";
import { registerSheet } from "./sheet";

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

  registerBroadcast(nodecg, router);
  registerBanPick(nodecg, router);
  registerStartgg(nodecg, router, store);
  registerBracket(nodecg, router);
  registerSheet(nodecg, router, store);
  registerCasters(nodecg, router);
  registerMatch(nodecg);

  nodecg.mount("/rashinban", router);

  nodecg.log.info(
    "rashinban extension loaded; Companion endpoints mounted at /rashinban",
  );
};
