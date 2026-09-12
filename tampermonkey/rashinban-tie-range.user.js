// ==UserScript==
// @name         RASHINBAN Player Tie-Range
// @namespace    rashinban2026
// @version      0.1.3
// @description  Player HP and multipliers for RASHINBAN's Full / Half tie-range rules. Set the same mode as the presenter before joining a duel.
// @match        https://www.geoguessr.com/*
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==
"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // tampermonkey/src/tie-range-player-view-model.ts
  function pair(values, order) {
    return [values[order[0]], values[order[1]]];
  }
  function resultIsDisclosed(round, currentRoundNumber, nativeResultVisible) {
    return nativeResultVisible || currentRoundNumber > round.round;
  }
  function terminalLabel(view, order) {
    const terminal = view.output?.terminal;
    if (!terminal || terminal.isDraw || terminal.winnerTeamId === null) return "Draw";
    if (view.localTeamId !== null) return terminal.winnerTeamId === view.localTeamId ? "You win" : "You lose";
    const winningIndex = view.output?.teamIds.indexOf(terminal.winnerTeamId) ?? -1;
    if (winningIndex < 0) return "Duel ended";
    return `${order.indexOf(winningIndex) === 0 ? "Blue" : "Red"} wins`;
  }
  function diagnosticText(view) {
    if (view.diagnostic && view.diagnostic.code !== "source-ended") return view.diagnostic.message;
    if (view.message) return view.message;
    if (view.status === "reconnecting") return "Reconnecting";
    if (view.status === "stale") return "HP may be out of date";
    if (view.status === "auth-error") return "Sign in to refresh custom HP";
    if (view.status === "unavailable") return "Custom HP unavailable";
    return null;
  }
  function playerRoundIdentity(context, round) {
    const startTime = context.roundStarts.find((start2) => start2.round === round)?.startTime;
    return startTime === void 0 ? null : JSON.stringify([context.gameId, round, startTime]);
  }
  function playerDisclosureMustReset(previous, next) {
    if (previous.gameId !== next.gameId || next.status === "inactive" || next.status === "off") return true;
    if (previous.context === null) return false;
    if (next.context === null) return true;
    if (next.context.currentRoundNumber < previous.context.currentRoundNumber || next.context.input.rounds.length < previous.context.input.rounds.length || next.context.roundStarts.length < previous.context.roundStarts.length) return true;
    return previous.context.roundStarts.some((previousStart) => {
      const nextStart = next.context?.roundStarts.find((start2) => start2.round === previousStart.round);
      return nextStart !== void 0 && nextStart.startTime !== previousStart.startTime;
    });
  }
  function modeLabel(mode2) {
    if (mode2 === "full") return "Full tie-range";
    if (mode2 === "half") return "Half tie-range";
    return "Off";
  }
  function derivePlayerTieRangeDisplay(view, nativeResultVisible, revealedRoundIdentity = null) {
    const mode2 = view.capturedMode ?? view.configuredMode;
    const accountIsNotAPlayer = view.status === "unavailable" && view.message === "Current account is not a player in this duel";
    if (mode2 === "off" || view.context === null || view.output === null || accountIsNotAPlayer) {
      const diagnostic3 = diagnosticText(view);
      return {
        showHud: false,
        showDiagnostic: mode2 !== "off" && view.status !== "inactive" && view.status !== "waiting" && view.status !== "loading" && diagnostic3 !== null,
        suppressNative: false,
        mode: mode2,
        modeLabel: modeLabel(view.configuredMode),
        appliesToNextDuel: view.appliesToNextDuel,
        teams: null,
        result: null,
        terminal: null,
        diagnostic: diagnostic3
      };
    }
    const { context, output } = view;
    const localIndex = view.localTeamId === null ? -1 : output.teamIds.indexOf(view.localTeamId);
    const order = localIndex === 1 ? [1, 0] : [0, 1];
    const latest = output.rounds.at(-1) ?? null;
    const latestIdentity = latest ? playerRoundIdentity(context, latest.round) : null;
    const retainedDisclosure = latestIdentity !== null && latestIdentity === revealedRoundIdentity;
    const disclosed = latest === null || view.status === "ended" || retainedDisclosure || resultIsDisclosed(latest, context.currentRoundNumber, nativeResultVisible);
    const health = latest && !disclosed ? latest.healthBefore : output.currentHealth;
    const multipliers = latest && !disclosed ? latest.multiplierTenths : output.currentMultiplierTenths;
    const labels = localIndex >= 0 ? ["You", "Opponent"] : ["Blue", "Red"];
    const orderedHealth = pair(health, order);
    const orderedMaximum = pair(output.initialHealth, order);
    const orderedMultipliers = pair(multipliers, order);
    const teams = order.map((index, position) => ({
      teamId: output.teamIds[index],
      label: labels[position],
      side: index === 0 ? "blue" : "red",
      health: orderedHealth[position],
      maximumHealth: orderedMaximum[position],
      multiplierTenths: orderedMultipliers[position]
    }));
    const result = latest && nativeResultVisible ? {
      round: latest.round,
      scores: pair(latest.scores, order),
      damageDealt: pair(latest.damageDealt, order),
      usedMultiplierTenths: pair(latest.multiplierTenths, order),
      nextMultiplierTenths: pair(latest.nextMultiplierTenths, order),
      band: latest.band,
      withinBand: latest.withinBand
    } : null;
    let terminal = null;
    const terminalIdentity = output.terminal ? playerRoundIdentity(context, output.terminal.round) : null;
    if (output.terminal && (view.status === "ended" || terminalIdentity !== null && terminalIdentity === revealedRoundIdentity || context.currentRoundNumber > output.terminal.round || nativeResultVisible && latest?.round === output.terminal.round)) {
      terminal = {
        headline: terminalLabel(view, order),
        detail: "Custom duel finished \u2014 wait for the host",
        round: output.terminal.round
      };
    } else if (view.status === "ended") {
      terminal = {
        headline: "Duel ended",
        detail: "No custom winner was determined",
        round: null
      };
    }
    const diagnostic2 = diagnosticText(view);
    return {
      showHud: true,
      showDiagnostic: diagnostic2 !== null,
      suppressNative: true,
      mode: mode2,
      modeLabel: modeLabel(mode2),
      appliesToNextDuel: view.appliesToNextDuel,
      teams,
      result,
      terminal,
      diagnostic: diagnostic2
    };
  }

  // bundles/rashinban/src/presenter/tie-range-geometry.ts
  var EARTH_RADIUS_M = 6371e3;
  var HALF_CIRCUMFERENCE_M = Math.PI * EARTH_RADIUS_M;
  function tieScoreRadius(threshold, maxErrorDistance) {
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 5e3 || !Number.isFinite(maxErrorDistance) || maxErrorDistance <= 0) return null;
    return Math.max(25, -(maxErrorDistance / 10) * Math.log((threshold - 0.5) / 5e3));
  }

  // tampermonkey/src/tie-range-player-map.ts
  function object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  }
  function decodePlayerMapRounds(raw, context) {
    const source = object(raw);
    if (!source || source.gameId !== context.gameId || source.version !== context.sourceVersion || !Array.isArray(source.rounds) || !Array.isArray(source.teams)) return [];
    const scale = source.options?.map?.maxErrorDistance;
    return context.input.rounds.flatMap((settled) => {
      const round = source.rounds.find((value) => value?.roundNumber === settled.round);
      const start2 = context.roundStarts.find((value) => value.round === settled.round)?.startTime;
      const answer = round?.panorama;
      if (!start2 || round?.startTime !== start2 || !Number.isFinite(answer?.lat) || Math.abs(answer.lat) > 90 || !Number.isFinite(answer?.lng) || Math.abs(answer.lng) > 180) return [];
      const results = context.teamIds.map((id) => source.teams.find((team) => team?.id === id)?.roundResults?.find((result) => result?.roundNumber === settled.round));
      if (results.some((result, i) => result?.score !== settled.scores[i])) return [];
      const distances = results.map((result) => {
        const distance = result?.bestGuess?.distance;
        return Number.isFinite(distance) && distance >= 0 ? distance : null;
      });
      return [{
        round: settled.round,
        identity: JSON.stringify([context.gameId, settled.round, start2]),
        answer: { lat: answer.lat, lng: answer.lng },
        distances,
        maxErrorDistance: Number.isFinite(scale) && scale > 0 ? scale : null
      }];
    });
  }
  function playerCircleRadii(round, scores, band) {
    if (scores.includes(5e3)) {
      const radius = round.maxErrorDistance === null ? null : tieScoreRadius(5e3, round.maxErrorDistance);
      return radius !== null && radius < Math.PI * 6371e3 ? [radius] : [];
    }
    const index = scores[0] === scores[1] ? (round.distances[0] ?? Infinity) <= (round.distances[1] ?? Infinity) ? 0 : 1 : scores[0] > scores[1] ? 0 : 1;
    const inner = round.distances[index];
    const outer = round.maxErrorDistance === null ? null : tieScoreRadius(Math.max(...scores) - band, round.maxErrorDistance);
    return [inner, outer].filter((radius) => radius !== null && radius < Math.PI * 6371e3);
  }
  function findPlayerResultMap(root) {
    const candidates = [root, ...root.querySelectorAll("*")];
    const checked = /* @__PURE__ */ new Set();
    const inspect = (value, depth) => {
      if (!value || typeof value !== "object" || checked.has(value) || depth > 4) return null;
      checked.add(value);
      if (typeof value.getDiv === "function" && typeof value.getProjection === "function") {
        try {
          if (root.contains(value.getDiv())) return value;
        } catch {
          return null;
        }
      }
      for (const key of ["map", "current", "value", "memoizedState", "state", "next"]) {
        const found = inspect(value[key], depth + 1);
        if (found) return found;
      }
      if (Array.isArray(value)) for (const item of value.slice(0, 100)) {
        const found = inspect(item, depth + 1);
        if (found) return found;
      }
      return null;
    };
    for (const element of candidates) {
      const key = Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
      if (!key) continue;
      let fiber = element[key];
      for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
        const found = inspect(fiber.memoizedProps, 0) ?? inspect(fiber.memoizedState, 0) ?? inspect(fiber.stateNode, 0);
        if (found) return found;
      }
    }
    return null;
  }
  function createPlayerMapOverlay(getPage) {
    let circles = [];
    let currentMap = null;
    let currentKey = null;
    function clear() {
      for (const circle of circles) {
        try {
          circle.setMap(null);
        } catch {
        }
      }
      circles = [];
      currentMap = null;
      currentKey = null;
    }
    return {
      update(view, resultRound) {
        if (resultRound === null || !view.context || view.capturedMode === "off") {
          clear();
          return;
        }
        const geometry = view.mapRounds?.find((round) => round.round === resultRound);
        const result = view.output?.rounds.find((round) => round.round === resultRound);
        if (!geometry || !result || geometry.identity !== playerRoundIdentity(view.context, resultRound)) {
          clear();
          return;
        }
        const page = getPage();
        const Circle = page.google?.maps?.Circle;
        const root = Array.from(page.document.querySelectorAll('[class*="duels_root__"] [class*="round-score_root__"]')).find((element) => Number(element.querySelector('[class*="round-score_roundNumber__"]')?.textContent?.match(/\d+/)?.[0]) === resultRound);
        const answerMarker = root?.querySelector('[class*="result-map_correctLocation__"], [data-qa="correct-location"]');
        if (!Circle || !root || !answerMarker || answerMarker.getClientRects().length === 0) {
          clear();
          return;
        }
        for (let element = answerMarker; element; element = element.parentElement) {
          const style = page.getComputedStyle(element);
          if (style.display === "none" || Number.parseFloat(style.opacity) === 0 || element === answerMarker && style.visibility === "hidden") {
            clear();
            return;
          }
        }
        const map = currentMap && root.contains(currentMap.getDiv()) ? currentMap : findPlayerResultMap(root);
        if (!map) {
          clear();
          return;
        }
        const radii = playerCircleRadii(geometry, result.scores, result.band);
        const key = JSON.stringify([geometry.identity, radii, result.scores]);
        if (map === currentMap && key === currentKey) return;
        clear();
        const bestIndex = result.scores[0] === result.scores[1] ? (geometry.distances[0] ?? Infinity) <= (geometry.distances[1] ?? Infinity) ? 0 : 1 : result.scores[0] > result.scores[1] ? 0 : 1;
        const color = result.scores.includes(5e3) ? "#ffd55a" : bestIndex === 0 ? "#458af2" : "#f05060";
        try {
          radii.forEach((radius, index) => circles.push(new Circle({
            map,
            center: geometry.answer,
            radius,
            strokeColor: color,
            strokeOpacity: index === 0 ? 1 : 0.7,
            strokeWeight: 2,
            fillOpacity: 0,
            clickable: false,
            zIndex: 2
          })));
        } catch {
          clear();
          return;
        }
        currentMap = map;
        currentKey = key;
      },
      dispose: clear
    };
  }

  // bundles/rashinban/src/presenter/tie-range-core.ts
  function tieRangeBand(bestScore, mode2) {
    if (mode2 === "off") return 0;
    return Math.floor((5e3 - bestScore) / (mode2 === "full" ? 1 : 2));
  }
  function roundHalfEven(difference, multiplierTenths) {
    const scaled = difference * multiplierTenths;
    const integer2 = Math.floor(scaled / 10);
    const remainder = scaled % 10;
    return integer2 + (remainder > 5 || remainder === 5 && integer2 % 2 !== 0 ? 1 : 0);
  }
  function validateInput(input) {
    if (!Number.isInteger(input.initialHealth) || input.initialHealth <= 0) {
      throw new Error("Tie-range initial health is missing or invalid");
    }
    if (!Number.isInteger(input.individual) || input.individual < 0 || !Number.isInteger(input.mutual) || input.mutual < 0 || !Number.isInteger(input.delay) || input.delay < 0) {
      throw new Error("Tie-range rule options are missing or invalid");
    }
    if (input.maxRounds !== null && (!Number.isInteger(input.maxRounds) || input.maxRounds < 1)) {
      throw new Error("Tie-range maximum rounds is invalid");
    }
    if (!Array.isArray(input.teamIds) || input.teamIds.length !== 2 || input.teamIds.some((teamId) => typeof teamId !== "string")) {
      throw new Error("Tie-range team IDs are invalid");
    }
    if (!Array.isArray(input.rounds)) throw new Error("Tie-range result history is invalid");
    for (let index = 0; index < input.rounds.length; index += 1) {
      const settled = input.rounds[index];
      const expectedRound = index + 1;
      if (!settled || !Number.isInteger(settled.round) || settled.round < 1) {
        throw new Error(`Invalid tie-range result history at round ${expectedRound}`);
      }
      if (settled.round !== expectedRound) {
        throw new Error(`Tie-range result history has a gap at round ${expectedRound}`);
      }
      if (!Array.isArray(settled.scores) || settled.scores.length !== 2 || settled.scores.some((score) => !Number.isInteger(score) || score < 0 || score > 5e3)) {
        throw new Error(`Invalid tie-range score at round ${settled.round}`);
      }
    }
  }
  function foldTieRange(input, mode2) {
    validateInput(input);
    const initialHealth = [input.initialHealth, input.initialHealth];
    const initialMultiplierTenths = [10, 10];
    const health = [...initialHealth];
    const multiplierTenths = [...initialMultiplierTenths];
    let mutualMultiplierTenths = 10;
    let terminal = null;
    const rounds = [];
    for (const settled of input.rounds) {
      const healthBefore = [...health];
      const roundMultiplierTenths = [...multiplierTenths];
      const roundMutualMultiplierTenths = mutualMultiplierTenths;
      const bestScore = Math.max(settled.scores[0], settled.scores[1]);
      const band = mode2 === null ? 0 : tieRangeBand(bestScore, mode2);
      const difference = Math.abs(settled.scores[0] - settled.scores[1]);
      const withinBand = difference <= band;
      const damageDealt = [0, 0];
      let winner = null;
      if (difference > 0) {
        winner = settled.scores[0] > settled.scores[1] ? 0 : 1;
        const loser = winner === 0 ? 1 : 0;
        const damage = roundHalfEven(difference, multiplierTenths[winner]);
        damageDealt[winner] = damage;
        health[loser] = Math.max(0, health[loser] - damage);
      }
      const knockout = health[0] === 0 || health[1] === 0;
      const roundLimit = input.maxRounds !== null && settled.round >= input.maxRounds;
      if (knockout || roundLimit) {
        terminal = {
          round: settled.round,
          winnerTeamId: health[0] === health[1] ? null : input.teamIds[health[0] > health[1] ? 0 : 1],
          isDraw: health[0] === health[1]
        };
      } else if (settled.round >= input.delay) {
        multiplierTenths[0] += input.mutual;
        multiplierTenths[1] += input.mutual;
        mutualMultiplierTenths += input.mutual;
        if (withinBand) {
          multiplierTenths[0] += input.individual;
          multiplierTenths[1] += input.individual;
        } else if (winner !== null) {
          multiplierTenths[winner] += input.individual;
        }
      }
      rounds.push({
        round: settled.round,
        scores: [...settled.scores],
        healthBefore,
        healthAfter: [...health],
        damageDealt,
        multiplierTenths: roundMultiplierTenths,
        nextMultiplierTenths: [...multiplierTenths],
        band,
        withinBand,
        mutualMultiplierTenths: roundMutualMultiplierTenths,
        nextMutualMultiplierTenths: mutualMultiplierTenths
      });
      if (terminal !== null) break;
    }
    return {
      teamIds: [...input.teamIds],
      initialHealth,
      currentHealth: [...health],
      initialMultiplierTenths,
      currentMultiplierTenths: [...multiplierTenths],
      initialMutualMultiplierTenths: 10,
      currentMutualMultiplierTenths: mutualMultiplierTenths,
      rounds,
      terminal
    };
  }

  // tampermonkey/src/tie-range-player-state.ts
  var PLAYER_TIE_RANGE_RULES_VERSION = 1;
  var STORAGE_PREFIX = "rashinban.tie-range";
  var STORAGE_INDEX_KEY = `${STORAGE_PREFIX}.games`;
  var MAX_SAVED_GAMES = 10;
  var DecodeError = class extends Error {
    constructor(code, message) {
      super(message);
      __publicField(this, "code");
      this.code = code;
    }
  };
  function record(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DecodeError("invalid-snapshot", `${label} is missing or invalid`);
    }
    return value;
  }
  function nonemptyString(value, label) {
    if (typeof value !== "string" || value.length === 0) {
      throw new DecodeError("invalid-snapshot", `${label} is missing or invalid`);
    }
    return value;
  }
  function integer(value, label, minimum = 0) {
    if (!Number.isInteger(value) || value < minimum) {
      throw new DecodeError("invalid-snapshot", `${label} is missing or invalid`);
    }
    return value;
  }
  function tupleEqual(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  function diagnostic(code, message) {
    return { code, message };
  }
  function outputFor(context) {
    if (context === null || context.mode === "off") return null;
    return foldTieRange(context.input, context.mode);
  }
  function retained(previous, code, message) {
    return {
      accepted: false,
      context: previous,
      output: outputFor(previous),
      diagnostic: diagnostic(code, message)
    };
  }
  function decodeOptions(raw) {
    const options = record(raw.options, "Player duel options");
    const initialHealth = integer(raw.initialHealth ?? options.initialHealth, "Initial health", 1);
    if (options.initialHealth !== void 0 && options.initialHealth !== initialHealth) {
      throw new DecodeError("incompatible-rules", "Initial health options disagree");
    }
    const individual = integer(options.roundWinMultiplierIncrement, "Round-win multiplier increment");
    const mutual = integer(options.multiplierIncrement, "Mutual multiplier increment");
    const delay = integer(options.roundsWithoutDamageMultiplier, "Multiplier delay");
    const rawMaxRounds = options.maxNumberOfRounds ?? raw.maxNumberOfRounds;
    const maxRounds = rawMaxRounds === null ? null : integer(rawMaxRounds, "Maximum rounds", 1);
    if (raw.maxNumberOfRounds !== void 0 && raw.maxNumberOfRounds !== maxRounds) {
      throw new DecodeError("incompatible-rules", "Maximum-round options disagree");
    }
    const teamOneHealth = options.initialHealthTeamOne;
    const teamTwoHealth = options.initialHealthTeamTwo;
    if (options.individualInitialHealth === true || teamOneHealth !== void 0 && teamTwoHealth !== void 0 && teamOneHealth !== teamTwoHealth || typeof teamOneHealth === "number" && teamOneHealth !== 0 && teamOneHealth !== initialHealth || typeof teamTwoHealth === "number" && teamTwoHealth !== 0 && teamTwoHealth !== initialHealth) {
      throw new DecodeError("incompatible-rules", "Asymmetric team health is unsupported");
    }
    if (options.disableHealing === false) {
      throw new DecodeError("incompatible-rules", "Healing must be disabled");
    }
    if (options.disableMultipliers === true) {
      throw new DecodeError("incompatible-rules", "Disabled multipliers are unsupported");
    }
    if (options.roundStartingBehavior !== void 0 && !["Default", "ManuallyStartFirstRound", "ManuallyStartAllRounds"].includes(
      String(options.roundStartingBehavior)
    )) {
      throw new DecodeError("incompatible-rules", "Special round-start scoring is unsupported");
    }
    return { initialHealth, individual, mutual, delay, maxRounds };
  }
  function decodeTeams(raw) {
    if (!Array.isArray(raw.teams) || raw.teams.length !== 2) {
      throw new DecodeError("unsupported-game", "Exactly two teams are required");
    }
    const byLabel = /* @__PURE__ */ new Map();
    for (const rawTeam of raw.teams) {
      const team = record(rawTeam, "Team");
      const label = typeof team.name === "string" ? team.name.toLowerCase() : "";
      if (label !== "blue" && label !== "red") {
        throw new DecodeError("unsupported-game", "Explicit blue and red team labels are required");
      }
      if (byLabel.has(label)) throw new DecodeError("unsupported-game", "Team labels must be unique");
      const id = nonemptyString(team.id, "Team ID");
      if (!Array.isArray(team.players) || team.players.length !== 1) {
        throw new DecodeError("unsupported-game", "Only one player per team is supported");
      }
      const playerId = nonemptyString(record(team.players[0], "Player").playerId, "Player ID");
      if (!Array.isArray(team.roundResults)) {
        throw new DecodeError("partial-results", "Team round results are missing");
      }
      const results = /* @__PURE__ */ new Map();
      for (const rawResult of team.roundResults) {
        const result = record(rawResult, "Round result");
        const round = integer(result.roundNumber, "Round-result number", 1);
        const score = integer(result.score, `Score for round ${round}`);
        if (score > 5e3) throw new DecodeError("invalid-snapshot", `Score for round ${round} is invalid`);
        if (results.has(round)) throw new DecodeError("partial-results", `Duplicate result for round ${round}`);
        results.set(round, score);
      }
      byLabel.set(label, { id, playerId, results });
    }
    const blue = byLabel.get("blue");
    const red = byLabel.get("red");
    if (!blue || !red || blue.id === red.id || blue.playerId === red.playerId) {
      throw new DecodeError("unsupported-game", "Team and player identities must be distinct");
    }
    const allRounds = /* @__PURE__ */ new Set([...blue.results.keys(), ...red.results.keys()]);
    const ordered = [...allRounds].sort((left, right) => left - right);
    const rounds = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const round = ordered[index];
      if (round !== index + 1 || !blue.results.has(round) || !red.results.has(round)) {
        throw new DecodeError("partial-results", `Paired contiguous results are required at round ${index + 1}`);
      }
      rounds.push({ round, scores: [blue.results.get(round), red.results.get(round)] });
    }
    return {
      teamIds: [blue.id, red.id],
      playerIds: [blue.playerId, red.playerId],
      rounds
    };
  }
  function decodeRoundStarts(raw, settledRounds) {
    if (!Array.isArray(raw.rounds)) throw new DecodeError("invalid-snapshot", "Round identities are missing");
    const seen = /* @__PURE__ */ new Set();
    const starts = [];
    for (const rawRound of raw.rounds) {
      const sourceRound = record(rawRound, "Round identity");
      const round = integer(sourceRound.roundNumber, "Round identity number", 1);
      if (seen.has(round)) throw new DecodeError("invalid-snapshot", `Duplicate round identity ${round}`);
      seen.add(round);
      if (sourceRound.isHealingRound === true) {
        throw new DecodeError("incompatible-rules", `Healing round ${round} is unsupported`);
      }
      if (sourceRound.startTime !== null && sourceRound.startTime !== void 0) {
        starts.push({ round, startTime: nonemptyString(sourceRound.startTime, `Round ${round} start time`) });
      }
    }
    for (let round = 1; round <= settledRounds; round += 1) {
      if (!seen.has(round)) throw new DecodeError("partial-results", `Round identity ${round} is missing`);
    }
    return starts.sort((left, right) => left.round - right.round);
  }
  function decodeSnapshot(rawValue) {
    const raw = record(rawValue, "Player duel response");
    const gameId = nonemptyString(raw.gameId, "Game ID");
    const sourceVersion = integer(raw.version, "Source version");
    const currentRoundNumber = integer(raw.currentRoundNumber, "Current round number", 1);
    const sourceStatus = nonemptyString(raw.status, "Source status");
    const rules = decodeOptions(raw);
    const teams = decodeTeams(raw);
    const roundStarts = decodeRoundStarts(raw, teams.rounds.length);
    return {
      gameId,
      sourceVersion,
      currentRoundNumber,
      sourceStatus,
      teamIds: teams.teamIds,
      teamLabels: ["blue", "red"],
      playerIds: teams.playerIds,
      roundStarts,
      input: { ...rules, teamIds: teams.teamIds, rounds: teams.rounds }
    };
  }
  function sameRules(previous, next) {
    return previous.input.initialHealth === next.input.initialHealth && previous.input.individual === next.input.individual && previous.input.mutual === next.input.mutual && previous.input.delay === next.input.delay && previous.input.maxRounds === next.input.maxRounds;
  }
  function sameRound(left, right) {
    return left.round === right.round && tupleEqual(left.scores, right.scores);
  }
  function rollbackStart(previous, next) {
    let rollback = next.currentRoundNumber < previous.currentRoundNumber ? next.currentRoundNumber : null;
    const previousStarts = new Map(previous.roundStarts.map((start2) => [start2.round, start2.startTime]));
    for (const start2 of next.roundStarts) {
      const oldStart = previousStarts.get(start2.round);
      if (oldStart !== void 0 && oldStart !== start2.startTime && start2.round <= Math.min(previous.currentRoundNumber, next.currentRoundNumber)) {
        rollback = rollback === null ? start2.round : Math.min(rollback, start2.round);
      }
    }
    return rollback;
  }
  function freezeContext(context) {
    for (const round of context.input.rounds) {
      Object.freeze(round.scores);
      Object.freeze(round);
    }
    for (const start2 of context.roundStarts) Object.freeze(start2);
    Object.freeze(context.input.rounds);
    Object.freeze(context.input.teamIds);
    Object.freeze(context.input);
    Object.freeze(context.teamIds);
    Object.freeze(context.teamLabels);
    Object.freeze(context.playerIds);
    Object.freeze(context.roundStarts);
    return Object.freeze(context);
  }
  function parsePlayerDuelPath(path) {
    const match = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:team-)?duels\/([A-Za-z0-9_-]+)(?:\/summary)?\/?$/.exec(path);
    return match ? { gameId: match[1] } : null;
  }
  function parsePlayerPageRoute(path) {
    const pathname = path.split(/[?#]/, 1)[0];
    const duel = parsePlayerDuelPath(pathname);
    if (duel) return { kind: "duel", gameId: duel.gameId };
    const party = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?party\/lobby(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(pathname);
    if (party) {
      return { kind: "party-lobby", partyCode: party[1] ?? null };
    }
    return null;
  }
  function acceptPlayerSnapshot(previous, raw, configuredMode) {
    const rawGameId = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw.gameId : void 0;
    const relevantPrevious = previous && typeof rawGameId === "string" && rawGameId !== previous.gameId ? null : previous;
    if (configuredMode !== "off" && configuredMode !== "full" && configuredMode !== "half") {
      return retained(relevantPrevious, "invalid-snapshot", "Configured tie-range mode is invalid");
    }
    let decoded;
    try {
      decoded = decodeSnapshot(raw);
    } catch (error) {
      if (error instanceof DecodeError) return retained(relevantPrevious, error.code, error.message);
      return retained(relevantPrevious, "invalid-snapshot", "Player duel response is invalid");
    }
    const activePrevious = relevantPrevious?.gameId === decoded.gameId ? relevantPrevious : null;
    if (activePrevious && decoded.sourceVersion < activePrevious.sourceVersion) {
      return retained(activePrevious, "stale-version", "An older duel response was ignored");
    }
    if (activePrevious && decoded.sourceVersion === activePrevious.sourceVersion) {
      return {
        accepted: true,
        context: activePrevious,
        output: outputFor(activePrevious),
        diagnostic: activePrevious.rollbackPendingFrom ? diagnostic("recovery", "Waiting for restarted round history to clear") : activePrevious.sourceStatus === "Finished" && outputFor(activePrevious)?.terminal === null ? diagnostic("source-ended", "Duel ended without a custom winner") : null
      };
    }
    if (activePrevious && (!tupleEqual(activePrevious.teamIds, decoded.teamIds) || !tupleEqual(activePrevious.playerIds, decoded.playerIds))) {
      return retained(activePrevious, "identity-change", "Team identities changed during the duel");
    }
    if (activePrevious && !sameRules(activePrevious, decoded)) {
      return retained(activePrevious, "rules-change", "Duel scoring options changed during the duel");
    }
    const rollback = activePrevious ? rollbackStart(activePrevious, decoded) : null;
    if (rollback === null && !activePrevious?.rollbackPendingFrom && decoded.input.rounds.length < decoded.currentRoundNumber - 1) {
      return retained(activePrevious, "recovery", "Earlier resolved rounds are missing from the player response");
    }
    let acceptedRounds = decoded.input.rounds;
    let rollbackPendingFrom = activePrevious?.rollbackPendingFrom ?? null;
    if (activePrevious) {
      if (rollback === null) {
        if (decoded.input.rounds.length < activePrevious.input.rounds.length || activePrevious.input.rounds.some((round, index) => !decoded.input.rounds[index] || !sameRound(round, decoded.input.rounds[index]))) {
          return retained(activePrevious, "recovery", "Settled history is incomplete or changed without rollback evidence");
        }
        const previousTerminal = outputFor(activePrevious)?.terminal;
        if (previousTerminal !== null && previousTerminal !== void 0) {
          acceptedRounds = activePrevious.input.rounds;
        }
      } else {
        const prefix = activePrevious.input.rounds.filter((round) => round.round < rollback);
        if (prefix.some((round, index) => !decoded.input.rounds[index] || !sameRound(round, decoded.input.rounds[index]))) {
          return retained(activePrevious, "recovery", "Rollback response does not contain the verified prefix");
        }
        acceptedRounds = prefix;
        rollbackPendingFrom = decoded.input.rounds.some((round) => round.round >= rollback) ? rollback : null;
      }
    }
    if (rollback === null && rollbackPendingFrom !== null) {
      if (decoded.input.rounds.some((round) => round.round >= rollbackPendingFrom)) {
        acceptedRounds = acceptedRounds.filter((round) => round.round < rollbackPendingFrom);
      } else {
        rollbackPendingFrom = null;
      }
    }
    const context = freezeContext({
      schemaVersion: PLAYER_TIE_RANGE_RULES_VERSION,
      gameId: decoded.gameId,
      mode: activePrevious?.mode ?? configuredMode,
      sourceVersion: decoded.sourceVersion,
      currentRoundNumber: decoded.currentRoundNumber,
      sourceStatus: decoded.sourceStatus,
      rollbackPendingFrom,
      teamIds: [...decoded.teamIds],
      teamLabels: ["blue", "red"],
      playerIds: [...decoded.playerIds],
      roundStarts: decoded.roundStarts.map((start2) => ({ ...start2 })),
      input: {
        ...decoded.input,
        teamIds: [...decoded.teamIds],
        rounds: acceptedRounds.map((round) => ({ round: round.round, scores: [...round.scores] }))
      }
    });
    const output = outputFor(context);
    const endedWithoutCustomWinner = decoded.sourceStatus === "Finished" && output?.terminal === null;
    return {
      accepted: true,
      context,
      output,
      diagnostic: rollbackPendingFrom !== null ? diagnostic("recovery", "Waiting for restarted round history to clear") : endedWithoutCustomWinner ? diagnostic("source-ended", "Duel ended without a custom winner") : null
    };
  }
  function gameKey(gameId) {
    return `${STORAGE_PREFIX}.game.${encodeURIComponent(gameId)}`;
  }
  function parseIndex(value) {
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  function restoreContext(value, expectedGameId) {
    if (typeof value !== "string") return { context: null, output: null, diagnostic: null };
    try {
      const parsed = record(JSON.parse(value), "Saved tie-range context");
      if (parsed.schemaVersion !== PLAYER_TIE_RANGE_RULES_VERSION) {
        return {
          context: null,
          output: null,
          diagnostic: diagnostic("schema-mismatch", "Saved tie-range rules are from a different version")
        };
      }
      if (parsed.mode !== "off" && parsed.mode !== "full" && parsed.mode !== "half" || parsed.gameId !== expectedGameId || expectedGameId.length === 0 || !Number.isInteger(parsed.sourceVersion) || parsed.sourceVersion < 0 || !Number.isInteger(parsed.currentRoundNumber) || parsed.currentRoundNumber < 1 || typeof parsed.sourceStatus !== "string" || parsed.sourceStatus.length === 0 || !Array.isArray(parsed.teamIds) || parsed.teamIds.length !== 2 || !Array.isArray(parsed.teamLabels) || !tupleEqual(parsed.teamLabels, ["blue", "red"]) || !Array.isArray(parsed.playerIds) || parsed.playerIds.length !== 2 || !Array.isArray(parsed.roundStarts)) {
        throw new Error("invalid context");
      }
      for (const tuple of [parsed.teamIds, parsed.playerIds]) {
        if (tuple.some((id) => typeof id !== "string" || id.length === 0) || tuple[0] === tuple[1]) {
          throw new Error("invalid identity");
        }
      }
      if (!parsed.input || !tupleEqual(parsed.teamIds, parsed.input.teamIds)) throw new Error("identity mismatch");
      foldTieRange(parsed.input, parsed.mode === "off" ? null : parsed.mode);
      const seen = /* @__PURE__ */ new Set();
      for (const start2 of parsed.roundStarts) {
        if (!start2 || !Number.isInteger(start2.round) || start2.round < 1 || seen.has(start2.round) || typeof start2.startTime !== "string" || start2.startTime.length === 0) throw new Error("invalid round identity");
        seen.add(start2.round);
      }
      if (parsed.rollbackPendingFrom !== void 0 && parsed.rollbackPendingFrom !== null && (!Number.isInteger(parsed.rollbackPendingFrom) || parsed.rollbackPendingFrom < 1 || parsed.input.rounds.some((round) => round.round >= parsed.rollbackPendingFrom))) throw new Error("invalid rollback");
      const context = freezeContext(parsed);
      const output = outputFor(context);
      return {
        context,
        output,
        diagnostic: context.rollbackPendingFrom ? diagnostic("recovery", "Waiting for restarted round history to clear") : context.sourceStatus === "Finished" && output?.terminal === null ? diagnostic("source-ended", "Duel ended without a custom winner") : null
      };
    } catch {
      return {
        context: null,
        output: null,
        diagnostic: diagnostic("invalid-saved-context", "Saved tie-range context is invalid")
      };
    }
  }
  async function loadPlayerContext(storage, gameId) {
    return restoreContext(await storage.get(gameKey(gameId)), gameId);
  }
  var saveQueues = /* @__PURE__ */ new WeakMap();
  async function savePlayerContext(storage, context) {
    const operation = async () => {
      await storage.set(gameKey(context.gameId), JSON.stringify(context));
      const oldIndex = parseIndex(await storage.get(STORAGE_INDEX_KEY));
      const index = [...new Set(oldIndex.filter((gameId) => gameId !== context.gameId)), context.gameId];
      const evicted = index.splice(0, Math.max(0, index.length - MAX_SAVED_GAMES));
      await storage.set(STORAGE_INDEX_KEY, JSON.stringify(index));
      await Promise.all(evicted.map((gameId) => storage.remove(gameKey(gameId))));
    };
    const previous = saveQueues.get(storage) ?? Promise.resolve();
    const next = previous.catch(() => {
    }).then(() => storage.withLock ? storage.withLock(operation) : operation());
    saveQueues.set(storage, next);
    try {
      await next;
    } finally {
      if (saveQueues.get(storage) === next) saveQueues.delete(storage);
    }
  }

  // tampermonkey/src/tie-range-player-controller.ts
  var DUEL_API = "https://game-server.geoguessr.com/api/duels/";
  var ACTIVE_PARTY_API = "/api/v4/parties/v2/active";
  var PHONEBOOK_API = "/api/v4/game-server/phonebook/";
  var LIVE_GAME_ORIGIN = "https://gs2.geoguessr.com";
  var SUCCESS_POLL_MS = 2500;
  var REQUEST_TIMEOUT_MS = 8e3;
  var STALE_MS = 1e4;
  var MAX_BACKOFF_MS = 3e4;
  var NO_CONTENT = /* @__PURE__ */ Symbol("no-content");
  var HttpError = class extends Error {
    constructor(status) {
      super(`Player API returned HTTP ${status}`);
      __publicField(this, "status");
      this.status = status;
    }
  };
  function validPathId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
  }
  function readPhonebook(raw, gameId) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("Game-server phonebook response is invalid");
    }
    const value = raw;
    if (value.gameId !== gameId) throw new Error("Game-server phonebook returned another game");
    if (value.status === "Active") {
      if (!validPathId(value.gameServerNodeId)) throw new Error("Active game-server node ID is invalid");
      return {
        gameId,
        kind: "active",
        url: `${LIVE_GAME_ORIGIN}/${value.gameServerNodeId}/${gameId}`
      };
    }
    if (value.status === "Inactive" || value.status === "Archived" || value.status === "Finished") {
      return { gameId, kind: "archive", url: `${DUEL_API}${encodeURIComponent(gameId)}` };
    }
    throw new Error("Game-server phonebook status is unavailable");
  }
  function routeKey(route) {
    return route.kind === "duel" ? `duel:${route.gameId}` : `party-lobby:${route.partyCode ?? ""}`;
  }
  function readActiveParty(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("Active party response is invalid");
    }
    const value = raw;
    const partyId = value.partyId === void 0 ? null : value.partyId;
    if (partyId !== null && !validPathId(partyId)) throw new Error("Active party ID is invalid");
    if (value.gameState === "NoGame" || value.gameState === "Finished" && value.lobbyId === null) {
      return { gameId: null, partyId, waiting: true, gameMaster: false };
    }
    if (value.gameState !== "Ongoing" && value.gameState !== "Finished") {
      throw new Error("Active party game state is unsupported");
    }
    if (value.gameType !== "Duels" && value.gameType !== "TeamDuels") {
      throw new Error("Active party game type is unsupported");
    }
    if (typeof value.lobbyId !== "string" || value.lobbyId.length === 0) {
      throw new Error("Active party lobby ID is missing");
    }
    if (!validPathId(value.lobbyId)) throw new Error("Active party lobby ID is invalid");
    const owner = typeof value.owner === "object" && value.owner !== null ? value.owner : null;
    const settings = typeof value.partySettings === "object" && value.partySettings !== null ? value.partySettings : null;
    return {
      gameId: value.lobbyId,
      partyId,
      waiting: false,
      gameMaster: settings?.masterControl === true && typeof owner?.userId === "string"
    };
  }
  function createPlayerTieRangeController(dependencies) {
    let started = false;
    let generation = 0;
    let currentRoute = null;
    let currentRouteKey = null;
    let gameId = null;
    let mapRounds = [];
    let context = null;
    let output = null;
    let diagnostic2 = null;
    let schemaBlocked = false;
    let request = null;
    let requestTimeout = null;
    let wakeTimer = null;
    let pollToken = null;
    let failureCount = 0;
    let lastAcceptedAt = null;
    let nextAttemptAt = null;
    let problem = null;
    let gameEndpoint = null;
    let currentPartyId = null;
    function configuredMode() {
      return dependencies.getConfiguredMode();
    }
    function localTeamId() {
      const userId = dependencies.getUserId();
      if (!context || !userId) return null;
      const index = context.playerIds.indexOf(userId);
      return index < 0 ? null : context.teamIds[index];
    }
    function publish(status, message = null) {
      const configured = configuredMode();
      const userId = dependencies.getUserId();
      const playerIsKnownOutsideGame = context !== null && context.mode !== "off" && typeof userId === "string" && userId.length > 0 && localTeamId() === null;
      dependencies.onView({
        status: playerIsKnownOutsideGame ? "unavailable" : status,
        gameId,
        configuredMode: configured,
        capturedMode: context?.mode ?? null,
        appliesToNextDuel: context !== null && context.mode !== configured,
        localTeamId: localTeamId(),
        context,
        mapRounds,
        output,
        diagnostic: diagnostic2,
        message: playerIsKnownOutsideGame ? "Current account is not a player in this duel" : message
      });
    }
    function clearWake() {
      if (wakeTimer !== null) dependencies.clearTimeout(wakeTimer);
      wakeTimer = null;
    }
    function clearRequestTimeout(controller) {
      if (requestTimeout === null || controller && requestTimeout.controller !== controller) return;
      dependencies.clearTimeout(requestTimeout.handle);
      requestTimeout = null;
    }
    function abortRequest() {
      const active = request;
      if (!active) return;
      clearRequestTimeout(active);
      active.abort();
      if (request === active) request = null;
    }
    function resetPolling() {
      clearWake();
      abortRequest();
      pollToken = null;
      failureCount = 0;
      lastAcceptedAt = null;
      nextAttemptAt = null;
      problem = null;
      gameEndpoint = null;
      currentPartyId = null;
    }
    function publishProblem() {
      if (problem === "auth") {
        publish("auth-error", "Sign in to GeoGuessr to refresh custom HP");
        return;
      }
      if (lastAcceptedAt !== null && dependencies.now() - lastAcceptedAt >= STALE_MS) {
        publish("stale", "HP may be out of date");
        return;
      }
      publish("reconnecting", "Reconnecting");
    }
    function scheduleWake() {
      clearWake();
      if (!started || currentRoute === null || nextAttemptAt === null) return;
      const now = dependencies.now();
      let at = nextAttemptAt;
      if (problem !== null && lastAcceptedAt !== null && now < lastAcceptedAt + STALE_MS) {
        at = Math.min(at, lastAcceptedAt + STALE_MS);
      }
      wakeTimer = dependencies.setTimeout(() => {
        wakeTimer = null;
        if (!started || currentRoute === null) return;
        const currentNow = dependencies.now();
        if (problem !== null && lastAcceptedAt !== null && currentNow >= lastAcceptedAt + STALE_MS) {
          publishProblem();
        }
        if (nextAttemptAt !== null && currentNow >= nextAttemptAt) {
          void poll(generation);
        } else {
          scheduleWake();
        }
      }, Math.max(0, at - now));
    }
    function requireCurrent(expectedGeneration) {
      if (expectedGeneration !== generation || !started) throw new DOMException("Aborted", "AbortError");
    }
    async function fetchJson(url, expectedGeneration, allowNoContent = false) {
      requireCurrent(expectedGeneration);
      const controller = new AbortController();
      request = controller;
      requestTimeout = {
        controller,
        handle: dependencies.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      };
      try {
        const response = await dependencies.fetch(url, {
          method: "GET",
          credentials: "include",
          signal: controller.signal
        });
        requireCurrent(expectedGeneration);
        if (!response.ok) throw new HttpError(response.status);
        if (allowNoContent && response.status === 204) return NO_CONTENT;
        const value = await response.json();
        requireCurrent(expectedGeneration);
        return value;
      } finally {
        if (request === controller) request = null;
        clearRequestTimeout(controller);
      }
    }
    async function restoreGame(nextGameId, expectedGeneration) {
      if (gameId === nextGameId) return true;
      gameId = nextGameId;
      context = null;
      mapRounds = [];
      output = null;
      diagnostic2 = null;
      schemaBlocked = false;
      failureCount = 0;
      lastAcceptedAt = null;
      problem = null;
      gameEndpoint = null;
      publish("loading");
      const restored = await loadPlayerContext(dependencies.storage, nextGameId);
      if (!started || expectedGeneration !== generation) return false;
      context = restored.context;
      output = restored.output;
      diagnostic2 = restored.diagnostic;
      schemaBlocked = restored.diagnostic?.code === "schema-mismatch";
      if (schemaBlocked) publish("unavailable", "Custom HP unavailable");
      else if (context?.mode === "off") publish("off");
      else if (output) {
        lastAcceptedAt = dependencies.now() - STALE_MS;
        if (diagnostic2?.code === "source-ended") publish("ended", diagnostic2.message);
        else publish("stale", diagnostic2?.message ?? "Checking saved HP against the current duel");
      } else publish("loading");
      return true;
    }
    async function discoverPartyGame(expectedGeneration) {
      const raw = await fetchJson(ACTIVE_PARTY_API, expectedGeneration, true);
      requireCurrent(expectedGeneration);
      if (raw === NO_CONTENT) {
        if (output?.terminal || context?.sourceStatus === "Finished") {
          publish("ended", diagnostic2?.message ?? "Custom duel finished");
        } else {
          gameId = null;
          context = null;
          mapRounds = [];
          output = null;
          diagnostic2 = null;
          schemaBlocked = false;
          gameEndpoint = null;
          publish("waiting", "Waiting for a duel");
        }
        return void 0;
      }
      const active = readActiveParty(raw);
      if (active.partyId !== null && currentPartyId !== null && active.partyId !== currentPartyId) {
        gameId = null;
        context = null;
        mapRounds = [];
        output = null;
        diagnostic2 = null;
        schemaBlocked = false;
        gameEndpoint = null;
      }
      if (active.partyId !== null) currentPartyId = active.partyId;
      if (active.waiting) {
        if (output?.terminal || context?.sourceStatus === "Finished") {
          publish("ended", diagnostic2?.message ?? "Custom duel finished");
        } else {
          gameId = null;
          context = null;
          mapRounds = [];
          output = null;
          diagnostic2 = null;
          schemaBlocked = false;
          gameEndpoint = null;
          publish("waiting", "Waiting for a duel");
        }
        return null;
      }
      const value = raw;
      const owner = value.owner;
      if (active.gameMaster && owner?.userId === dependencies.getUserId()) {
        gameId = active.gameId;
        context = null;
        mapRounds = [];
        output = null;
        diagnostic2 = null;
        schemaBlocked = true;
        publish("unavailable", "Game master accounts are not player HUD targets");
        return null;
      }
      return active.gameId;
    }
    async function resolveGameEndpoint(targetGameId, expectedGeneration) {
      if (gameEndpoint?.gameId === targetGameId) return gameEndpoint;
      const raw = await fetchJson(
        `${PHONEBOOK_API}${encodeURIComponent(targetGameId)}`,
        expectedGeneration
      );
      requireCurrent(expectedGeneration);
      if (raw === NO_CONTENT) throw new Error("Game-server phonebook response is empty");
      gameEndpoint = readPhonebook(raw, targetGameId);
      return gameEndpoint;
    }
    async function fetchGameSnapshot(targetGameId, expectedGeneration) {
      const endpoint = await resolveGameEndpoint(targetGameId, expectedGeneration);
      try {
        return await fetchJson(endpoint.url, expectedGeneration);
      } catch (error) {
        requireCurrent(expectedGeneration);
        if (endpoint.kind === "active") gameEndpoint = null;
        if (!(error instanceof HttpError) || error.status !== 404 || endpoint.kind !== "active") throw error;
        const refreshed = await resolveGameEndpoint(targetGameId, expectedGeneration);
        return await fetchJson(refreshed.url, expectedGeneration);
      }
    }
    function handleFailure(error, expectedGeneration) {
      if (!started || expectedGeneration !== generation) return;
      problem = error instanceof HttpError && (error.status === 401 || error.status === 403) ? "auth" : "network";
      failureCount += 1;
      nextAttemptAt = dependencies.now() + Math.min(MAX_BACKOFF_MS, SUCCESS_POLL_MS * 2 ** failureCount);
      publishProblem();
      scheduleWake();
    }
    async function poll(expectedGeneration) {
      if (!started || expectedGeneration !== generation || currentRoute === null || pollToken !== null) return;
      const token = /* @__PURE__ */ Symbol("poll");
      pollToken = token;
      clearWake();
      try {
        let targetGameId;
        if (currentRoute.kind === "party-lobby") {
          targetGameId = await discoverPartyGame(expectedGeneration);
          if (!started || expectedGeneration !== generation) return;
          if (targetGameId === void 0) {
            failureCount = 0;
            problem = null;
            nextAttemptAt = dependencies.now() + SUCCESS_POLL_MS;
            scheduleWake();
            return;
          }
          if (targetGameId === null) {
            failureCount = 0;
            problem = null;
            nextAttemptAt = dependencies.now() + SUCCESS_POLL_MS;
            scheduleWake();
            return;
          }
        } else {
          targetGameId = currentRoute.gameId;
        }
        if (!await restoreGame(targetGameId, expectedGeneration)) return;
        if (schemaBlocked) {
          nextAttemptAt = dependencies.now() + SUCCESS_POLL_MS;
          scheduleWake();
          return;
        }
        const raw = await fetchGameSnapshot(targetGameId, expectedGeneration);
        if (!started || expectedGeneration !== generation || gameId !== targetGameId) return;
        if (typeof raw !== "object" || raw === null || raw.gameId !== targetGameId) {
          throw new Error("Player response belongs to another game");
        }
        const accepted = acceptPlayerSnapshot(context, raw, configuredMode());
        context = accepted.context;
        mapRounds = accepted.accepted && context ? decodePlayerMapRounds(raw, context) : [];
        output = accepted.output;
        diagnostic2 = accepted.diagnostic;
        failureCount = 0;
        problem = null;
        nextAttemptAt = dependencies.now() + SUCCESS_POLL_MS;
        if (accepted.accepted) {
          lastAcceptedAt = dependencies.now();
          if (context) await savePlayerContext(dependencies.storage, context);
        }
        if (!started || expectedGeneration !== generation || gameId !== targetGameId) return;
        if (!accepted.accepted) publish("unavailable", "Custom HP unavailable");
        else if (context?.mode === "off") publish("off");
        else if (accepted.diagnostic?.code === "source-ended") publish("ended", accepted.diagnostic.message);
        else if (output) publish("ready");
        else publish("unavailable", "Custom HP unavailable");
        scheduleWake();
      } catch (error) {
        if (!started || expectedGeneration !== generation) return;
        handleFailure(error, expectedGeneration);
      } finally {
        if (pollToken === token) pollToken = null;
      }
    }
    function syncRoute(forceRefresh) {
      if (!started) return;
      const parsed = parsePlayerPageRoute(dependencies.getPath());
      const nextKey = parsed ? routeKey(parsed) : null;
      if (nextKey === currentRouteKey) {
        if (forceRefresh && parsed) void poll(generation);
        return;
      }
      generation += 1;
      resetPolling();
      currentRoute = parsed;
      currentRouteKey = nextKey;
      gameId = null;
      context = null;
      mapRounds = [];
      output = null;
      diagnostic2 = null;
      schemaBlocked = false;
      currentPartyId = null;
      if (!parsed) {
        publish("inactive");
        return;
      }
      publish(parsed.kind === "party-lobby" ? "waiting" : "loading");
      void poll(generation);
    }
    return {
      start() {
        if (started) return;
        started = true;
        syncRoute(true);
      },
      refresh() {
        syncRoute(true);
      },
      routeChanged() {
        syncRoute(true);
      },
      dispose() {
        if (!started) return;
        started = false;
        generation += 1;
        resetPolling();
        currentRoute = null;
        currentRouteKey = null;
        gameId = null;
        context = null;
        mapRounds = [];
        output = null;
        diagnostic2 = null;
        schemaBlocked = false;
        currentPartyId = null;
        publish("inactive");
      }
    };
  }

  // tampermonkey/src/tie-range-player-ui.ts
  var CLASS_SELECTORS = {
    duelRoot: '[class*="duels_root__"]',
    healthBars: '[class*="hud_healthBars__"]',
    resultRoot: '[class*="round-score_root__"]',
    resultRound: '[class*="round-score_roundNumber__"]',
    damage: '[class*="round-score_damageAnimation__"]',
    summary: '[class*="game-summary-2_root__"]',
    summaryHeader: '[class*="game-summary-2_playedRoundsHeader__"]',
    summaryRow: '[class*="game-summary-2_playedRound__"]',
    roundNumber: '[class*="game-summary-2_roundNumber__"]',
    terminal: '[class*="summon-glow-text_root__"]'
  };
  function multiplier(value) {
    return `${(value / 10).toFixed(value % 10 === 0 ? 0 : 1)}\xD7`;
  }
  function classStartsWith(element, prefix) {
    return Array.from(element.classList).some((value) => value.startsWith(prefix));
  }
  function visible(element, document2) {
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden) return false;
      const style = document2.defaultView?.getComputedStyle(current);
      if (style?.display === "none" || current === element && (style?.visibility === "hidden" || style?.visibility === "collapse") || Number.parseFloat(style?.opacity ?? "1") === 0) return false;
    }
    return typeof element.getClientRects !== "function" || element.getClientRects().length > 0;
  }
  function rootElements(document2) {
    return Array.from(document2.querySelectorAll(CLASS_SELECTORS.duelRoot)).filter((element) => classStartsWith(element, "duels_root__"));
  }
  function scopedElements(roots, selector) {
    return roots.flatMap((root) => [
      ...root.matches(selector) ? [root] : [],
      ...Array.from(root.querySelectorAll(selector))
    ]);
  }
  function visibleResultRoots(document2, roots, expectedRound) {
    if (expectedRound === null) return [];
    return scopedElements(roots, CLASS_SELECTORS.resultRoot).filter((element) => {
      if (!classStartsWith(element, "round-score_root__")) return false;
      const heading = element.querySelector(CLASS_SELECTORS.resultRound);
      if (!heading || !visible(heading, document2)) return false;
      const text = heading.textContent ?? "";
      const displayedRound = [...text.matchAll(/\d+/g)].at(-1)?.[0];
      return displayedRound !== void 0 && Number.parseInt(displayedRound, 10) === expectedRound;
    });
  }
  function summaryDisclosesTerminal(document2, roots, view) {
    const terminalRound = view.output?.terminal?.round;
    if (terminalRound === void 0) return false;
    return scopedElements(roots, CLASS_SELECTORS.summary).some((summary) => {
      if (!classStartsWith(summary, "game-summary-2_root__") || !visible(summary, document2)) return false;
      return Array.from(summary.querySelectorAll(CLASS_SELECTORS.summaryRow)).some((row) => {
        const round = Number.parseInt(row.querySelector(CLASS_SELECTORS.roundNumber)?.textContent ?? "", 10);
        return round === terminalRound && visible(row, document2);
      });
    });
  }
  function userIdFromLink(element, document2) {
    const href = element.querySelector('a[href*="/user/"]')?.getAttribute("href");
    if (!href) return null;
    try {
      const path = new URL(href, document2.baseURI).pathname.replace(/\/$/, "");
      const match = path.match(/\/user\/([^/]+)$/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }
  function createPlayerTieRangeUi(dependencies) {
    const { document: document2 } = dependencies;
    const mapOverlay = createPlayerMapOverlay(() => dependencies.getPageWindow?.() ?? document2.defaultView);
    document2.getElementById("rb-tie-range-player")?.remove();
    const host = document2.createElement("div");
    host.id = "rb-tie-range-player";
    host.setAttribute("data-rb", "player-root");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
        color: #fff; font: 600 14px/1.2 Inter, system-ui, sans-serif; }
      *, *::before, *::after { box-sizing: border-box; }
      [hidden] { display: none !important; }
      .hud { position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; width: calc(100vw - 48px);
        transform: translateX(-50%); filter: drop-shadow(0 3px 9px #000b); }
      .mode { margin: 0 auto 6px; width: max-content; padding: 3px 9px; border-radius: 999px;
        background: #111d; color: #f4f4f4; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
      .teams { display: flex; justify-content: space-between; gap: 180px; }
      .team { position: relative; width: min(420px, calc((100% - 180px) / 2)); min-width: 0; padding: 7px 9px 9px; border: 1px solid #ffffff3b; border-radius: 8px; background: #0d111ae8; }
      .damage { position: absolute; top: calc(100% + 5px); right: 9px; padding: 4px 8px; border-radius: 5px;
        background: #35131ff2; color: #ff8492; font-size: 32px; font-variant-numeric: tabular-nums; }
      @media (prefers-reduced-motion: reduce) { .fill { transition: none; } }
      .team[data-side="blue"] { --team: #38a8ff; }
      .team[data-side="red"] { --team: #ff5365; }
      .team-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--team); font-size: 13px; }
      .numbers { display: flex; align-items: baseline; gap: 7px; }
      .health { font-size: 20px; font-variant-numeric: tabular-nums; }
      .multiplier { color: #ffe169; font-size: 16px; font-variant-numeric: tabular-nums; }
      .track { height: 8px; margin-top: 5px; overflow: hidden; border-radius: 999px; background: #ffffff25; }
      .fill { height: 100%; width: 0; border-radius: inherit; background: var(--team); transition: width 220ms ease; }
      .result { margin: 22px auto 0; width: 76%; text-align: center; font-size: 40px; text-shadow: 0 2px 6px #000; }
      .result-title { display: none; }
      .result-grid { display: flex; justify-content: space-between; gap: 100px; font-variant-numeric: tabular-nums; }
      .result-meta { display: none; }
      .terminal { position: fixed; top: 22%; left: 50%; transform: translateX(-50%); min-width: min(420px, calc(100vw - 32px));
        padding: 13px 22px; border: 1px solid #ffe16999; border-radius: 10px; background: #111e; text-align: center;
        filter: drop-shadow(0 3px 12px #000c); }
      .terminal strong { display: block; color: #ffe169; font-size: 30px; letter-spacing: .04em; text-transform: uppercase; }
      .terminal span { display: block; margin-top: 3px; color: #ddd; font-size: 12px; }
      .diagnostic { margin: 6px auto 0; width: max-content; max-width: 100%; padding: 4px 8px; border-radius: 5px;
        background: #5c2b12ed; color: #ffd8bd; text-align: center; font-size: 11px; }
      .settings-open { position: fixed; top: max(10px, env(safe-area-inset-top)); right: 12px; pointer-events: auto;
        border: 1px solid #ffffff45; border-radius: 999px; padding: 6px 9px; background: #111d; color: #fff; cursor: pointer;
        font: 600 11px/1.2 Inter, system-ui, sans-serif; }
      .settings { position: fixed; inset: 0; display: grid; place-items: center; padding: 20px; background: #0008; pointer-events: auto; }
      .settings-card { width: min(390px, 100%); padding: 18px; border: 1px solid #ffffff45; border-radius: 12px; background: #161a22;
        box-shadow: 0 18px 60px #000a; }
      .settings h2 { margin: 0 0 13px; font-size: 18px; }
      .settings label { display: grid; gap: 6px; }
      .settings select { width: 100%; padding: 8px; border: 1px solid #ffffff45; border-radius: 6px; background: #252b36; color: #fff; }
      .settings p { margin: 11px 0 15px; color: #cbd0da; font-size: 12px; font-weight: 450; line-height: 1.45; }
      .settings button { float: right; padding: 7px 12px; border: 0; border-radius: 6px; background: #e9edf5; color: #111; cursor: pointer; }
      @media (max-width: 620px) { .hud { width: calc(100vw - 18px); top: 52px; } .teams { gap: 100px; }
        .team { width: calc((100% - 100px) / 2); padding-inline: 7px; } .health { font-size: 17px; }
        .numbers { flex-wrap: wrap; gap: 3px; } .team-head { flex-wrap: wrap; } }
    </style>
    <section class="hud" data-rb="hud" aria-live="polite" hidden>
      <div class="mode" data-rb="mode" data-rb-mode-note></div>
      <div class="teams" data-rb="teams">
        <article class="team" data-rb="team-0"><div class="team-head"><span class="label" data-rb="label"></span><span class="numbers"><strong class="health" data-rb="health"></strong><span class="multiplier" data-rb="multiplier"></span></span></div><div class="track"><div class="fill" data-rb="bar-fill"></div></div></article>
        <article class="team" data-rb="team-1"><div class="team-head"><span class="label" data-rb="label"></span><span class="numbers"><strong class="health" data-rb="health"></strong><span class="multiplier" data-rb="multiplier"></span></span></div><div class="track"><div class="fill" data-rb="bar-fill"></div></div></article>
      </div>
      <div class="result" data-rb="result" hidden><div class="result-title" data-rb="result-title"></div><div class="result-grid"><span data-rb="result-team-0"></span><span data-rb="result-team-1"></span></div><div class="result-meta" data-rb="result-meta"></div></div>
      <div class="diagnostic" data-rb="diagnostic" hidden></div>
    </section>
    <div class="terminal" data-rb="terminal" aria-live="assertive" hidden><strong data-rb="terminal-headline"></strong><span data-rb="terminal-detail"></span></div>
    <button type="button" class="settings-open" data-rb="settings-open"></button>
    <div class="settings" data-rb="settings-panel" role="dialog" aria-modal="true" aria-labelledby="rb-settings-title" hidden>
      <div class="settings-card"><h2 id="rb-settings-title">Player tie-range</h2><label>Mode<select data-rb="mode-select"><option value="off">Off</option><option value="full">Full</option><option value="half">Half</option></select></label><p>The selected mode is captured when a duel begins. Changes apply to the next duel.</p><button type="button" data-rb="settings-close">Close</button></div>
    </div>`;
    (document2.body ?? document2.documentElement).append(host);
    const byRb = (name) => {
      const element = shadow.querySelector(`[data-rb="${name}"]`);
      if (!element) throw new Error(`Missing player UI element: ${name}`);
      return element;
    };
    const hud = byRb("hud");
    const terminal = byRb("terminal");
    const diagnostic2 = byRb("diagnostic");
    const settingsOpen = byRb("settings-open");
    const settingsPanel = byRb("settings-panel");
    const modeSelect = byRb("mode-select");
    for (const index of [0, 1]) {
      const damage = document2.createElement("span");
      damage.className = "damage";
      damage.dataset.rb = "damage";
      damage.hidden = true;
      byRb(`team-${index}`).append(damage);
    }
    const originalStyles = /* @__PURE__ */ new Map();
    const originallyMissingStyleAttribute = /* @__PURE__ */ new Set();
    const summaryReplacements = /* @__PURE__ */ new Map();
    let desiredStyles = null;
    let lastView = null;
    let revealedRoundIdentity = null;
    let focusBeforeSettings = null;
    let disposed = false;
    let reconcileQueued = false;
    let lastDamageIdentity = null;
    let initialResultIdentity = null;
    let activeDamage = null;
    function animateDamage(root, damage, identity, teamId, after, maximum) {
      activeDamage?.cancel();
      const page = document2.defaultView;
      if (page.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof damage.animate !== "function") return;
      const canonicalIndex = lastView.output.teamIds.indexOf(teamId);
      const before = lastView.output.rounds.at(-1).healthBefore[canonicalIndex];
      const health = root.querySelector('[data-rb="health"]');
      const fill = root.querySelector('[data-rb="bar-fill"]');
      const write = (value) => {
        health.textContent = String(value);
        fill.style.width = `${maximum > 0 ? value / maximum * 100 : 0}%`;
      };
      const box = damage.getBoundingClientRect();
      const x = page.innerWidth * (root.getBoundingClientRect().left < page.innerWidth / 2 ? 0.24 : 0.76) - (box.left + box.width / 2);
      const y = Math.max(150, root.getBoundingClientRect().bottom + 65) - box.top;
      const animation = damage.animate([
        { transform: `translate(${x}px, ${y}px) scale(1.5)`, offset: 0 },
        { transform: `translate(${x}px, ${y}px) scale(1.5)`, offset: 0.35 },
        { transform: "translate(0, 0) scale(1)", offset: 1 }
      ], { duration: 1200, easing: "ease-in-out" });
      let frame = 0;
      const started = page.performance.now();
      const cancel = () => {
        page.cancelAnimationFrame(frame);
        animation.cancel();
        write(after);
      };
      activeDamage = { identity, teamId, cancel };
      write(before);
      const tick = () => {
        if (activeDamage?.identity !== identity) return;
        const progress = Math.max(0, Math.min(1, (page.performance.now() - started - 750) / 450));
        write(Math.round(before + (after - before) * progress));
        if (progress < 1) frame = page.requestAnimationFrame(tick);
        else activeDamage = null;
      };
      frame = page.requestAnimationFrame(tick);
    }
    function hideNativeTree(element, except) {
      for (const child of [element, ...element.querySelectorAll("*")]) {
        if (child === except || except?.contains(child)) continue;
        setNativeStyle(child, "visibility", "hidden");
      }
    }
    function setNativeStyle(element, property, value) {
      let desired = desiredStyles?.get(element);
      if (!desired && desiredStyles) {
        desired = /* @__PURE__ */ new Set();
        desiredStyles.set(element, desired);
      }
      desired?.add(property);
      let snapshot = originalStyles.get(element);
      if (!snapshot) {
        snapshot = {};
        originalStyles.set(element, snapshot);
        if (!element.hasAttribute("style")) originallyMissingStyleAttribute.add(element);
      }
      if (!(property in snapshot)) snapshot[property] = element.style[property];
      if (element.style[property] !== value) element.style[property] = value;
    }
    function restoreUnusedNativeStyles() {
      for (const [element, snapshot] of originalStyles) {
        const desired = desiredStyles?.get(element);
        for (const [property, value] of Object.entries(snapshot)) {
          if (desired?.has(property)) continue;
          element.style[property] = value ?? "";
          delete snapshot[property];
        }
        if (Object.keys(snapshot).length === 0) {
          originalStyles.delete(element);
          if (originallyMissingStyleAttribute.delete(element) && element.style.length === 0) {
            element.removeAttribute("style");
          }
        }
      }
      desiredStyles = null;
    }
    function restoreNative() {
      for (const [element, snapshot] of originalStyles) {
        for (const [property, value] of Object.entries(snapshot)) {
          element.style[property] = value ?? "";
        }
      }
      originalStyles.clear();
      for (const element of originallyMissingStyleAttribute) {
        if (element.style.length === 0) element.removeAttribute("style");
      }
      originallyMissingStyleAttribute.clear();
      desiredStyles = null;
      for (const replacement of summaryReplacements.values()) replacement.remove();
      summaryReplacements.clear();
    }
    function renderDisplay(display, layoutDiagnostic) {
      if (!display.teams && activeDamage) {
        activeDamage.cancel();
        activeDamage = null;
      }
      hud.hidden = !display.showHud && !display.showDiagnostic && layoutDiagnostic === null;
      byRb("mode").hidden = !display.showHud;
      byRb("teams").hidden = !display.showHud;
      byRb("mode").textContent = display.appliesToNextDuel ? `${display.modeLabel} \xB7 setting applies next duel` : display.modeLabel;
      const configured = lastView?.configuredMode ?? dependencies.getConfiguredMode();
      settingsOpen.textContent = `Tie range settings: ${configured === "off" ? "Off" : configured === "full" ? "Full" : "Half"}`;
      settingsOpen.hidden = lastView?.status === "inactive";
      if (display.teams) {
        const damageIdentity = display.result && lastView?.context ? JSON.stringify([playerRoundIdentity(lastView.context, display.result.round), display.result.damageDealt, display.teams.map((team) => team.health)]) : null;
        if (activeDamage && activeDamage.identity !== damageIdentity) {
          activeDamage.cancel();
          activeDamage = null;
        }
        display.teams.forEach((team, index) => {
          const root = byRb(`team-${index}`);
          root.dataset.side = team.side;
          root.querySelector('[data-rb="label"]').textContent = team.label;
          if (activeDamage?.teamId !== team.teamId) root.querySelector('[data-rb="health"]').textContent = String(team.health);
          root.querySelector('[data-rb="multiplier"]').textContent = multiplier(team.multiplierTenths);
          const percent = team.maximumHealth <= 0 ? 0 : Math.max(0, Math.min(100, team.health / team.maximumHealth * 100));
          if (activeDamage?.teamId !== team.teamId) root.querySelector('[data-rb="bar-fill"]').style.width = `${percent}%`;
          const damage = root.querySelector('[data-rb="damage"]');
          const amount = display.result?.damageDealt[index === 0 ? 1 : 0] ?? 0;
          damage.hidden = amount === 0;
          damage.textContent = amount > 0 ? `\u2212${amount}` : "";
          if (amount > 0 && damageIdentity !== lastDamageIdentity && playerRoundIdentity(lastView.context, display.result.round) !== initialResultIdentity) {
            animateDamage(root, damage, damageIdentity, team.teamId, team.health, team.maximumHealth);
          }
        });
        if (damageIdentity !== null) lastDamageIdentity = damageIdentity;
      }
      const result = byRb("result");
      result.hidden = display.result === null;
      if (display.result && display.teams) {
        byRb("result-title").textContent = `Round ${display.result.round} result`;
        for (const index of [0, 1]) {
          byRb(`result-team-${index}`).textContent = String(display.result.scores[index]);
        }
        byRb("result-meta").textContent = `Tie band ${display.result.band} \xB7 ${display.result.withinBand ? "inside range" : "outside range"}`;
      }
      terminal.hidden = display.terminal === null;
      if (display.terminal) {
        byRb("terminal-headline").textContent = display.terminal.headline;
        byRb("terminal-detail").textContent = display.terminal.detail;
      }
      const message = [display.diagnostic, layoutDiagnostic].filter(Boolean).join(" \xB7 ");
      diagnostic2.hidden = message.length === 0 || !display.showDiagnostic && layoutDiagnostic === null;
      diagnostic2.textContent = message;
    }
    function applySummaryReplacements(view, roots) {
      if (!view.context || !view.output) return null;
      let unsupported = false;
      const desired = /* @__PURE__ */ new Set();
      for (const summary of scopedElements(roots, CLASS_SELECTORS.summary)) {
        if (!classStartsWith(summary, "game-summary-2_root__")) continue;
        const header = summary.querySelector(CLASS_SELECTORS.summaryHeader);
        const headerCells = header ? Array.from(header.children) : [];
        if (headerCells.length !== 5) {
          unsupported = true;
          continue;
        }
        const healthColumns = [3, 4];
        let columnByTeam = view.context.playerIds.map((playerId) => healthColumns.find((column) => (userIdFromLink(headerCells[column], document2) ?? userIdFromLink(headerCells[column - 2], document2)) === playerId) ?? -1);
        if (columnByTeam[0] >= 0 && columnByTeam[1] < 0) columnByTeam[1] = columnByTeam[0] === 3 ? 4 : 3;
        if (columnByTeam[1] >= 0 && columnByTeam[0] < 0) columnByTeam[0] = columnByTeam[1] === 3 ? 4 : 3;
        if (columnByTeam.some((column) => column < 0)) {
          const observations = Array.from(summary.querySelectorAll(CLASS_SELECTORS.summaryRow)).flatMap((row) => {
            const number = Number.parseInt(row.querySelector(CLASS_SELECTORS.roundNumber)?.textContent ?? "", 10);
            const folded = view.output.rounds.find((round) => round.round === number);
            if (!folded || row.children.length !== 5) return [];
            const scores = [1, 2].map((column) => {
              const digits = row.children[column].textContent?.trim().match(/^\d[\d,\u00a0 ]*/)?.[0];
              return digits === void 0 ? NaN : Number(digits.replace(/\D/g, ""));
            });
            return [{ folded, scores }];
          });
          const orders = [[0, 1], [1, 0]];
          const matching = orders.filter((order) => observations.length > 0 && observations.every(({ folded, scores }) => scores[0] === folded.scores[order[0]] && scores[1] === folded.scores[order[1]]));
          if (matching.length === 1) {
            columnByTeam = matching[0][0] === 0 ? [3, 4] : [4, 3];
          } else if (matching.length === 2 && view.output.rounds.every((round) => round.scores[0] === round.scores[1])) {
            columnByTeam = [3, 4];
          }
        }
        if (columnByTeam[0] < 0 || columnByTeam[1] < 0 || columnByTeam[0] === columnByTeam[1]) {
          unsupported = true;
          continue;
        }
        for (const row of summary.querySelectorAll(CLASS_SELECTORS.summaryRow)) {
          if (!classStartsWith(row, "game-summary-2_playedRound__")) continue;
          const cells = Array.from(row.children);
          const roundNumber = Number.parseInt(row.querySelector(CLASS_SELECTORS.roundNumber)?.textContent ?? "", 10);
          const folded = view.output.rounds.find((round) => round.round === roundNumber);
          const afterTerminal = view.output.terminal !== null && roundNumber > view.output.terminal.round;
          if (cells.length !== 5 || !folded && !afterTerminal) {
            unsupported = true;
            continue;
          }
          const roundLabel = cells[0].querySelector(CLASS_SELECTORS.roundNumber);
          if (roundLabel) {
            hideNativeTree(cells[0], roundLabel);
            setNativeStyle(roundLabel, "visibility", "visible");
          }
          for (const teamIndex of [0, 1]) {
            const cell = cells[columnByTeam[teamIndex]];
            if (!cell) {
              unsupported = true;
              continue;
            }
            desired.add(cell);
            setNativeStyle(cell, "position", "relative");
            let replacement = summaryReplacements.get(cell);
            if (!replacement) {
              replacement = document2.createElement("span");
              replacement.setAttribute("data-rb", "summary-health");
              Object.assign(replacement.style, {
                position: "absolute",
                inset: "0",
                zIndex: "2",
                display: "grid",
                placeItems: "center",
                background: "#10141c",
                color: teamIndex === 0 ? "#59b7ff" : "#ff6978",
                font: "600 14px/1.2 Inter, system-ui, sans-serif",
                pointerEvents: "auto"
              });
              cell.append(replacement);
              summaryReplacements.set(cell, replacement);
            }
            const health = String(folded?.healthAfter[teamIndex] ?? view.output.currentHealth[teamIndex]);
            const damage = folded?.damageDealt[teamIndex === 0 ? 1 : 0] ?? 0;
            const text = `${health}${damage > 0 ? ` (\u2212${damage})` : ""}`;
            if (replacement.textContent !== text) replacement.textContent = text;
            const used = folded ? multiplier(folded.multiplierTenths[teamIndex]) : "Duel already finished";
            const label = `Custom health ${health}; damage received ${damage}; used multiplier ${used}`;
            if (replacement.title !== label) replacement.title = label;
            if (replacement.getAttribute("aria-label") !== label) replacement.setAttribute("aria-label", label);
          }
        }
      }
      for (const [cell, replacement] of summaryReplacements) {
        if (desired.has(cell)) continue;
        replacement.remove();
        summaryReplacements.delete(cell);
      }
      return unsupported ? "Native summary layout is unsupported; its HP values were left unchanged" : null;
    }
    function reconcile() {
      if (disposed || !lastView) return;
      desiredStyles = /* @__PURE__ */ new Map();
      const roots = rootElements(document2);
      const duelSurfaceVisible = roots.some((root) => visible(root, document2) && root.querySelector([CLASS_SELECTORS.healthBars, CLASS_SELECTORS.resultRoot, CLASS_SELECTORS.summary].join(", ")));
      if (!duelSurfaceVisible) {
        restoreNative();
        mapOverlay.dispose();
        const display2 = derivePlayerTieRangeDisplay(lastView, false, revealedRoundIdentity);
        renderDisplay({
          ...display2,
          showHud: false,
          showDiagnostic: false,
          teams: null,
          result: null,
          terminal: null,
          diagnostic: null
        }, null);
        return;
      }
      const expectedRound = lastView.output?.rounds.at(-1)?.round ?? null;
      const matchingResultRoots = visibleResultRoots(document2, roots, expectedRound);
      const disclosed = matchingResultRoots.length > 0;
      if (disclosed && expectedRound !== null && lastView.context) {
        revealedRoundIdentity = playerRoundIdentity(lastView.context, expectedRound);
      }
      const terminalSummaryVisible = summaryDisclosesTerminal(document2, roots, lastView);
      terminal.style.top = terminalSummaryVisible ? "100px" : "22%";
      if (terminalSummaryVisible && lastView.output?.terminal) {
        revealedRoundIdentity = lastView.context ? playerRoundIdentity(lastView.context, lastView.output.terminal.round) : null;
      }
      const display = derivePlayerTieRangeDisplay(lastView, disclosed, revealedRoundIdentity);
      let layoutDiagnostic = null;
      if (display.suppressNative) {
        let healthBarsFound = false;
        for (const root of roots) {
          for (const healthBars of root.querySelectorAll(CLASS_SELECTORS.healthBars)) {
            hideNativeTree(healthBars);
            healthBarsFound = true;
          }
          if (display.terminal) {
            for (const banner of root.querySelectorAll(CLASS_SELECTORS.terminal)) {
              setNativeStyle(banner, "visibility", "hidden");
            }
          }
        }
        if (roots.length > 0 && !healthBarsFound && !display.terminal) {
          layoutDiagnostic = "Native duel HUD layout is unsupported; native values were left visible";
        } else if (roots.length === 0 && !display.terminal && lastView.status !== "ended") {
          layoutDiagnostic = "Waiting for a supported duel HUD";
        }
        for (const damage of scopedElements(roots, `${CLASS_SELECTORS.damage}, [class*="damage-animation_root__"]`)) {
          hideNativeTree(damage);
        }
        const summaryDiagnostic = applySummaryReplacements(lastView, roots);
        if (summaryDiagnostic) layoutDiagnostic = summaryDiagnostic;
      } else {
        for (const replacement of summaryReplacements.values()) replacement.remove();
        summaryReplacements.clear();
      }
      restoreUnusedNativeStyles();
      renderDisplay(display, layoutDiagnostic);
      mapOverlay.update(lastView, display.result?.round ?? null);
    }
    function queueReconcile() {
      if (reconcileQueued || disposed) return;
      reconcileQueued = true;
      queueMicrotask(() => {
        reconcileQueued = false;
        reconcile();
      });
    }
    function showSettings() {
      focusBeforeSettings = shadow.activeElement instanceof HTMLElement ? shadow.activeElement : document2.activeElement instanceof HTMLElement ? document2.activeElement : null;
      modeSelect.value = dependencies.getConfiguredMode();
      settingsPanel.hidden = false;
      modeSelect.focus();
    }
    function closeSettings() {
      settingsPanel.hidden = true;
      focusBeforeSettings?.focus();
      focusBeforeSettings = null;
    }
    settingsOpen.addEventListener("click", showSettings);
    byRb("settings-close").addEventListener("click", closeSettings);
    settingsPanel.addEventListener("click", (event) => {
      if (event.target === settingsPanel) closeSettings();
    });
    shadow.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !settingsPanel.hidden) closeSettings();
    });
    modeSelect.addEventListener("change", () => {
      const value = modeSelect.value;
      if (value !== "off" && value !== "full" && value !== "half") return;
      settingsOpen.textContent = `Tie range settings: ${value === "off" ? "Off" : value === "full" ? "Full" : "Half"}`;
      closeSettings();
      dependencies.onModeChange(value);
    });
    const MutationObserverConstructor = document2.defaultView?.MutationObserver;
    const observer = MutationObserverConstructor ? new MutationObserverConstructor(queueReconcile) : null;
    observer?.observe(document2.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden", "style", "aria-hidden"] });
    settingsOpen.textContent = `Tie range settings: ${dependencies.getConfiguredMode() === "off" ? "Off" : dependencies.getConfiguredMode() === "full" ? "Full" : "Half"}`;
    return {
      update(view) {
        if (disposed) return;
        if (lastView === null || playerDisclosureMustReset(lastView, view)) {
          revealedRoundIdentity = null;
          lastDamageIdentity = null;
        }
        if (lastView?.gameId !== view.gameId || view.status === "inactive" || view.status === "off") {
          activeDamage?.cancel();
          activeDamage = null;
          restoreNative();
        }
        if (view.context && view.context.gameId !== lastView?.context?.gameId) {
          const latest = view.output?.rounds.at(-1);
          initialResultIdentity = latest ? playerRoundIdentity(view.context, latest.round) : null;
        }
        lastView = view;
        reconcile();
      },
      openSettings() {
        if (disposed) return;
        showSettings();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        activeDamage?.cancel();
        activeDamage = null;
        observer?.disconnect();
        mapOverlay.dispose();
        restoreNative();
        host.remove();
        lastView = null;
      }
    };
  }

  // tampermonkey/src/rashinban-tie-range.user.ts
  var MODE_KEY = "rb-tie-range:mode";
  function mode(value) {
    return value === "full" || value === "half" ? value : "off";
  }
  function accountId() {
    try {
      const text = document.getElementById("__NEXT_DATA__")?.textContent;
      const id = text ? JSON.parse(text).props?.accountProps?.account?.user?.userId : null;
      return typeof id === "string" && id.length > 0 ? id : null;
    } catch {
      return null;
    }
  }
  async function start() {
    let configuredMode = mode(await GM_getValue(MODE_KEY, "off"));
    let guestId = null;
    let identityRequest = null;
    let lastIdentityAttempt = -Infinity;
    let disposed = false;
    const ui = createPlayerTieRangeUi({
      document,
      getPageWindow: () => typeof unsafeWindow === "undefined" ? window : unsafeWindow,
      getConfiguredMode: () => configuredMode,
      onModeChange: (nextMode) => {
        void (async () => {
          try {
            await GM_setValue(MODE_KEY, nextMode);
            configuredMode = nextMode;
            controller.refresh();
          } catch {
            window.alert("Tie-range settings could not be saved. Please try again from the Tampermonkey menu.");
          }
        })();
      }
    });
    const controller = createPlayerTieRangeController({
      fetch: (url, init) => fetch(url, init),
      storage: {
        withLock: (operation) => navigator.locks.request("rashinban.tie-range.storage", operation),
        get: (key) => GM_getValue(key),
        set: async (key, value) => {
          await GM_setValue(key, value);
        },
        remove: async (key) => {
          await GM_deleteValue(key);
        }
      },
      now: () => Date.now(),
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: (handle) => window.clearTimeout(handle),
      getPath: () => location.pathname,
      getUserId: () => accountId() ?? guestId,
      getConfiguredMode: () => configuredMode,
      onView: (view) => ui.update(view)
    });
    async function refreshIdentity() {
      if (disposed || !parsePlayerPageRoute(location.pathname)) return;
      if (accountId()) {
        guestId = null;
        return;
      }
      if (identityRequest || Date.now() - lastIdentityAttempt < 1e4) return;
      lastIdentityAttempt = Date.now();
      const abort = new AbortController();
      identityRequest = abort;
      const timeout = window.setTimeout(() => abort.abort(), 8e3);
      try {
        const response = await fetch("/api/v4/guest-users/id", { credentials: "include", signal: abort.signal });
        if (!response.ok) return;
        const value = await response.json();
        const id = typeof value === "object" && value !== null ? value.id : null;
        guestId = typeof id === "string" && id.length > 0 ? id : null;
        if (!disposed) controller.refresh();
      } catch {
      } finally {
        window.clearTimeout(timeout);
        if (identityRequest === abort) identityRequest = null;
      }
    }
    GM_registerMenuCommand("RASHINBAN: Player tie-range settings", () => ui.openSettings());
    controller.start();
    void refreshIdentity();
    let previousPath = location.pathname;
    const routeTimer = window.setInterval(() => {
      if (location.pathname !== previousPath) {
        previousPath = location.pathname;
        controller.routeChanged();
      }
      void refreshIdentity();
    }, 500);
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void refreshIdentity();
      void (async () => {
        try {
          configuredMode = mode(await GM_getValue(MODE_KEY, configuredMode));
        } catch {
        }
        if (!disposed) controller.refresh();
      })();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("popstate", refresh);
    window.addEventListener("pagehide", (event) => {
      if (event.persisted) return;
      disposed = true;
      window.clearInterval(routeTimer);
      identityRequest?.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("popstate", refresh);
      controller.dispose();
      ui.dispose();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void start().catch(console.error);
    }, { once: true });
  } else {
    void start().catch(console.error);
  }
})();
