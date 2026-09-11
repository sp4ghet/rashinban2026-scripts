(() => {
  window.__rbAutoDuel?.stop();
  const state = { running: true, log: [], pending: null, attempts: new Set(), startedAt: new Date().toISOString() };
  function context() {
    const el = document.querySelector('#__next');
    const root = el?.[Object.keys(el).find(k => k.startsWith('__reactContainer'))];
    const seen = new Set(); let result;
    function visit(f) {
      if (!f || result || seen.has(f)) return;
      seen.add(f);
      for (let d = f.dependencies?.firstContext; d; d = d.next) {
        const p = d.memoizedValue;
        if (p?.gameState?.gameId && typeof p.onGuess === 'function') { result = p; break; }
      }
      visit(f.child); visit(f.sibling);
    }
    visit(root); if (!result) visit(root?.alternate);
    return result;
  }
  function record(entry) { state.log.push({at: new Date().toISOString(), ...entry}); if (state.log.length > 100) state.log.shift(); }
  async function tick() {
    if (!state.running || state.busy) return;
    const p = context(), g = p?.gameState, r = p?.currentRound;
    if (!g || g.context?.id !== '5bcebcb8-6514-4fff-8dbb-662607ee14e7' || g.options?.isRated !== false || g.status !== 'Ongoing' || g.isPaused || !r?.startTime || r.hasProcessedRoundTimeout || p.currentPlayerHasGuessed || p.isGuessing) return;
    const key = g.gameId + ':' + r.roundNumber;
    if (state.pending?.key === key) {
      state.busy = true;
      state.pending = null;
      try { await p.onGuess(); record({event:'guess-submitted', gameId:g.gameId, round:r.roundNumber}); }
      catch(e) { record({event:'error', message:String(e),round:r.roundNumber}); }
      finally {state.busy=false;}
      return;
    }
    if (state.attempts.has(key) || Date.now() < r.startTime + (p.playerTeam?.name === 'blue' ? 12000 : 20000)) return;
    const isBlue = p.playerTeam?.name === 'blue';
    const offset = r.roundNumber % 3 === 0 ? 2 : (isBlue ? 0.8 : 6);
    const pin = {lat:Math.max(-85,Math.min(85,r.panorama.lat + offset)),lng:r.panorama.lng};
    state.attempts.add(key);state.busy=true;
    try { await p.onPlacedPin(pin); state.pending={key};record({event:'pin-placed',gameId:g.gameId,round:r.roundNumber,pin}); }
    catch(e) {record({event:'error',message:String(e),round:r.roundNumber});}
    finally {state.busy=false;}
  }
  const timer = setInterval(() => tick().catch(e=>record({event:'error',message:String(e)})),500);
  state.stop = () => {state.running=false;clearInterval(timer);};
  state.status = () => ({running:state.running,startedAt:state.startedAt,log:state.log,pending:state.pending});
  window.__rbAutoDuel = state;
  return {installed:true,stop:'window.__rbAutoDuel.stop()',behavior:'Blue guesses at 12s; Red at 20s; every third round is a tie; private party only.'};
})()