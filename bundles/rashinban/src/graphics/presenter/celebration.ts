import type { RenderFrame } from './renderer.ts';

// Keep the last actual game view under an alpha celebration. Never synthesize
// a live frame from a results snapshot, which may already contain answer data.
export function createCelebrationUnderlay() {
  let retained: RenderFrame | null = null;
  let identity = '';
  const key = (frame: RenderFrame) => JSON.stringify([
    frame.state.gameId, frame.displayedRound === undefined ? frame.state.round : frame.displayedRound, frame.state.mode, frame.source,
    frame.playerIds?.left ?? null, frame.playerIds?.right ?? null,
  ]);
  return {
    render(frame: RenderFrame, celebrating: boolean): RenderFrame {
      const currentRound = frame.displayedRound === undefined || frame.displayedRound === frame.state.round;
      if (frame.projection.phase === 'live' && currentRound) {
        // Replicants are JSON data wrapped in Proxies, which structuredClone rejects.
        retained = JSON.parse(JSON.stringify(frame)) as RenderFrame;
        identity = key(frame);
      } else if (celebrating && frame.projection.phase === 'results-transition' && frame.projection.answer === null
        && retained && identity === key(frame)
        && frame.state.rounds.some(round => round.number === retained!.state.round)) {
        return { ...retained, frozen: true, ...(frame.preparedResults ? { preparedResults: frame.preparedResults } : {}) };
      } else {
        retained = null;
        identity = '';
      }
      return frame;
    },
    reset() { retained = null; identity = ''; },
  };
}
