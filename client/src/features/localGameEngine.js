import pokemonData from "../data/pokemon_all.json";
import { normalizeAnswer, similarityScore } from "@shared/answerUtils.js";
import { DEFAULT_SETTINGS, RESULTS_DURATION_MS } from "@shared/gameConstants.js";
import { getPokemonPool as getPokemonPoolFromList, pickRandomPokemon } from "@shared/pokemonUtils.js";
import { sanitizeSettings } from "@shared/settings.js";

export function clonePlayers(players) {
  return players.map((player) => ({ ...player }));
}

export function getPokemonPool(selectedGenerations = [1]) {
  return getPokemonPoolFromList(pokemonData, selectedGenerations);
}

export function getRoundTargetName(room) {
  if (!room || room.state !== "round" || !room.currentPokemon) return "";
  return room.settings.language === "fr" ? room.currentPokemon.fr : room.currentPokemon.en;
}

export function startLocalRound(room, { startDelayMs = 0 } = {}) {
  const players = clonePlayers(room.players).map((player) => ({ ...player, hasSubmitted: false, answer: "" }));
  const pickedPokemon = pickRandomPokemon(pokemonData, room.settings.generations, room.usedPokemonIds || []);
  const nextUsedPokemonIds = [...(room.usedPokemonIds || []), pickedPokemon.id];
  const roundStartsAt = Date.now() + Math.max(0, startDelayMs);

  return {
    ...room,
    state: "round",
    roundIndex: room.roundIndex + 1,
    players,
    currentPokemon: pickedPokemon,
    usedPokemonIds: nextUsedPokemonIds,
    roundStartsAt,
    roundEndsAt: roundStartsAt + (room.settings.roundDurationSec * 1000),
    phaseEndsAt: null,
    isPaused: false,
    pausedRemainingMs: 0,
    expectedName: null,
    recentRoundResults: [],
    votes: {}
  };
}

export function finishLocalRound(room) {
  if (room.state !== "round") return room;

  const expected = room.settings.language === "fr" ? room.currentPokemon.fr : room.currentPokemon.en;
  const players = clonePlayers(room.players);

  const recentRoundResults = players.map((player) => {
    const exact = normalizeAnswer(player.answer) === normalizeAnswer(expected);
    const provisionalScore = room.settings.scoringMode === "approx"
      ? similarityScore(player.answer, expected)
      : (exact ? 100 : 0);

    const awardedScore = provisionalScore;
    player.score += awardedScore;

    return {
      playerId: player.id,
      nickname: player.nickname,
      answer: player.answer,
      exact,
      provisionalScore,
      awardedScore,
      voteAccepted: room.settings.scoringMode === "voting" ? true : undefined
    };
  });

  return {
    ...room,
    state: "roundResults",
    players,
    expectedName: expected,
    roundStartsAt: null,
    roundEndsAt: null,
    phaseEndsAt: Date.now() + RESULTS_DURATION_MS,
    isPaused: false,
    pausedRemainingMs: 0,
    recentRoundResults
  };
}

export function advanceLocalGame(room) {
  if (room.state !== "roundResults") return room;

  if (room.roundIndex >= room.totalRounds) {
    const winners = clonePlayers(room.players).sort((a, b) => b.score - a.score);
    return {
      ...room,
      state: "finalResults",
      phaseEndsAt: null,
      isPaused: false,
      pausedRemainingMs: 0,
      winners
    };
  }

  return startLocalRound(room);
}

export function createLocalRoom({ playerId, nickname, avatar, settings }) {
  const initialSettings = sanitizeSettings(settings, DEFAULT_SETTINGS);

  return {
    id: "LOCAL",
    hostId: playerId,
    settings: initialSettings,
    state: "lobby",
    roundIndex: 0,
    totalRounds: initialSettings.rounds,
    roundStartsAt: null,
    roundEndsAt: null,
    phaseEndsAt: null,
    isPaused: false,
    pausedRemainingMs: 0,
    expectedName: null,
    players: [
      {
        id: playerId,
        nickname,
        avatar,
        score: 0,
        connected: true,
        isHost: true,
        isReady: false,
        hasSubmitted: false,
        answer: ""
      }
    ],
    currentPokemon: null,
    recentRoundResults: [],
    votes: {},
    usedPokemonIds: [],
    winners: []
  };
}

export function resetLocalLobby(room) {
  const players = clonePlayers(room.players).map((player) => ({
    ...player,
    score: 0,
    isReady: false,
    hasSubmitted: false,
    answer: ""
  }));

  return {
    ...room,
    state: "lobby",
    roundIndex: 0,
    totalRounds: room.settings.rounds,
    currentPokemon: null,
    roundStartsAt: null,
    roundEndsAt: null,
    phaseEndsAt: null,
    isPaused: false,
    pausedRemainingMs: 0,
    expectedName: null,
    recentRoundResults: [],
    winners: [],
    usedPokemonIds: [],
    players
  };
}

export function applyLocalVote(room, voterId, targetPlayerId, accepted) {
  const nextResults = room.recentRoundResults.map((result) => (
    result.playerId === targetPlayerId
      ? { ...result, voteAccepted: accepted, awardedScore: accepted ? result.provisionalScore : 0 }
      : result
  ));

  const nextVotes = {
    ...(room.votes || {}),
    [targetPlayerId]: {
      ...((room.votes || {})[targetPlayerId] || {}),
      [voterId]: accepted
    }
  };

  const awardedByPlayer = new Map(nextResults.map((result) => [result.playerId, result.awardedScore]));
  const nextPlayers = clonePlayers(room.players).map((player) => {
    const nextAwarded = awardedByPlayer.get(player.id);
    if (typeof nextAwarded !== "number") return player;
    const previousResult = room.recentRoundResults.find((result) => result.playerId === player.id);
    const previousAwarded = previousResult?.awardedScore || 0;
    return {
      ...player,
      score: player.score - previousAwarded + nextAwarded
    };
  });

  return {
    ...room,
    recentRoundResults: nextResults,
    votes: nextVotes,
    players: nextPlayers
  };
}
