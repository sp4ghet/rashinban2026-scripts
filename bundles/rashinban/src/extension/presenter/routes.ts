import type NodeCG from '@nodecg/types';
import express from 'express';

export type PresenterAction = 'view/chroma' | 'view/rendered' | 'mute' | 'unmute' | 'reconnect' | 'series' | 'settings' | 'program/transfer' | 'media';
export const PRESENTER_ACTIONS: PresenterAction[] = ['view/chroma', 'view/rendered', 'mute', 'unmute', 'reconnect', 'series', 'settings', 'program/transfer', 'media'];

export function mountPresenterRoutes(nodecg: NodeCG.ServerAPI, control: (action: PresenterAction, body: unknown, expectedRevision?: string) => unknown): void {
  const router = nodecg.Router();
  router.use(express.json({ limit: '32kb' }));
  for (const action of PRESENTER_ACTIONS) {
    router.post(`/${action}`, (req, res) => {
      try {
        const revision = req.get('x-rashinban-config-revision');
        res.json(control(action, req.body, revision || undefined));
      }
      catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid presenter request' }); }
    });
  }
  // Keep parser errors out of NodeCG logs and HTTP stack-trace responses.
  router.use(((error, _req, res, _next) => {
    res.status(400).json({ error: 'Invalid presenter request' });
  }) as express.ErrorRequestHandler);
  nodecg.mount('/rashinban/presenter', router);
}
