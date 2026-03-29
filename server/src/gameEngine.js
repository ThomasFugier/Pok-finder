import {
  DEFAULT_SETTINGS,
  DISPLAY_MODE_OPTIONS,
  ENABLED_GENERATIONS,
  GENERATION_OPTIONS,
  LANGUAGE_OPTIONS,
  MAX_PLAYERS,
  SCORING_MODE_OPTIONS,
  RESULTS_DURATION_MS,
  ROUND_OPTIONS,
  TIMER_OPTIONS_SEC,
  VOTING_DURATION_MS
} from "./config.js";
import { createPlayerId, createRoomId, normalizeAnswer, similarityScore } from "./utils.js";
import pokemonData from "./data/pokemon151.json" with { type: "json" };

function now() {
  return Date.now();
}

function getPokemonGeneration(pokemonId) {
  if (pokemonId <= 151) return 1;
  if (pokemonId <= 251) return 2;
  if (pokemonId <= 386) return 3;
  if (pokemonId <= 493) return 4;
  if (pokemonId <= 649) return 5;
  if (pokemonId <= 721) return 6;
  if (pokemonId <= 809) return 7;
  if (pokemonId <= 905) return 8;
  return 9;
}

function publicPlayer(player) {
  return {
    id: player.id,
    nickname: player.nickname,
    avatar: player.avatar,
    score: player.score,
    connected: player.connected,
    isHost: player.isHost,
    hasSubmitted: player.hasSubmitted
  };
}

function sanitizeSettings(nextSettings = {}, fallback = DEFAULT_SETTINGS) {
  const rounds = ROUND_OPTIONS.includes(nextSettings.rounds)
    ? nextSettings.rounds
    : fallback.rounds;
  const language = LANGUAGE_OPTIONS.includes(nextSettings.language)
    ? nextSettings.language
    : fallback.language;
  const displayMode = DISPLAY_MODE_OPTIONS.includes(nextSettings.displayMode)
    ? nextSettings.displayMode
    : (DISPLAY_MODE_OPTIONS.includes(nextSettings.mode) ? nextSettings.mode : fallback.displayMode);
  const scoringMode = SCORING_MODE_OPTIONS.includes(nextSettings.scoringMode)
    ? nextSettings.scoringMode
    : (SCORING_MODE_OPTIONS.includes(nextSettings.mode) ? nextSettings.mode : fallback.scoringMode);
  const roundDurationSec = TIMER_OPTIONS_SEC.includes(nextSettings.roundDurationSec)
    ? nextSettings.roundDurationSec
    : fallback.roundDurationSec;

  const requestedGenerations = Array.isArray(nextSettings.generations)
    ? nextSettings.generations
    : fallback.generations;
  const generations = requestedGenerations
    .filter((value) => Number.isInteger(value) && GENERATION_OPTIONS.includes(value) && ENABLED_GENERATIONS.includes(value));
  const fallbackGenerations = Array.isArray(fallback.generations)
    ? fallback.generations.filter((value) => ENABLED_GENERATIONS.includes(value))
    : [];

  return {
    rounds,
    language,
    displayMode,
    scoringMode,
    roundDurationSec,
    generations: generations.length ? generations : (fallbackGenerations.length ? fallbackGenerations : [ENABLED_GENERATIONS[0]])
  };
}

export class GameEngine {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  createRoom({ nickname, avatar, preferredPlayerId, socketId, initialSettings }) {
    const roomId = createRoomId(this.rooms);
    const playerId = preferredPlayerId || createPlayerId();

    const settings = sanitizeSettings(initialSettings, DEFAULT_SETTINGS);

    const room = {
      id: roomId,
      hostId: playerId,
      settings,
      players: [
        {
          id: playerId,
          socketId,
          nickname,
          avatar,
          score: 0,
          connected: true,
          isHost: true,
          hasSubmitted: false,
          answer: ""
        }
      ],
      state: "lobby",
      roundIndex: 0,
      totalRounds: settings.rounds,
      currentPokemon: null,
      answers: {},
      votes: {},
      roundEndsAt: null,
      phaseEndsAt: null,
      roundTimer: null,
      phaseTimer: null,
      ticker: null,
      recentRoundResults: [],
      winners: []
    };

    this.rooms.set(roomId, room);
    return { room, playerId };
  }

  joinRoom({ roomId, nickname, avatar, preferredPlayerId, socketId }) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.players.length >= MAX_PLAYERS) return { error: "Room is full" };
    if (room.state !== "lobby") return { error: "Game already started" };

    const reconnectCandidate = preferredPlayerId
      ? room.players.find((p) => p.id === preferredPlayerId)
      : null;

    if (reconnectCandidate) {
      if (reconnectCandidate.connected) {
        return { error: "Player identity already active" };
      }
      reconnectCandidate.socketId = socketId;
      reconnectCandidate.connected = true;
      reconnectCandidate.nickname = nickname || reconnectCandidate.nickname;
      reconnectCandidate.avatar = avatar || reconnectCandidate.avatar;
      return { room, playerId: reconnectCandidate.id, reconnected: true };
    }

    const playerId = preferredPlayerId || createPlayerId();
    room.players.push({
      id: playerId,
      socketId,
      nickname,
      avatar,
      score: 0,
      connected: true,
      isHost: false,
      hasSubmitted: false,
      answer: ""
    });

    return { room, playerId };
  }

  reconnectToRoom({ roomId, playerId, socketId }) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { error: "Player not found" };
    player.socketId = socketId;
    player.connected = true;
    return { room, playerId };
  }

  leaveBySocket(socketId) {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (!player) continue;

      const hostLeaving = room.hostId === player.id;

      player.connected = false;
      player.socketId = null;
      if (room.state === "lobby") {
        room.players = room.players.filter((p) => p.id !== player.id);
      }

      if (hostLeaving) {
        for (const participant of room.players) {
          if (!participant.connected || !participant.socketId) continue;
          this.io.to(participant.socketId).emit("room:forceExit", {
            reason: "Host disconnected"
          });
        }
        this.clearRoomTimers(room);
        this.rooms.delete(room.id);
        return;
      }

      if (!room.players.length) {
        this.clearRoomTimers(room);
        this.rooms.delete(room.id);
        return;
      }

      if (!room.players.some((p) => p.id === room.hostId && p.connected)) {
        const nextHost = room.players.find((p) => p.connected) || room.players[0];
        room.hostId = nextHost.id;
        room.players.forEach((p) => {
          p.isHost = p.id === room.hostId;
        });
      }

      const removed = this.handlePresenceChange(room);
      if (removed) return;

      this.broadcastRoom(room);
      return;
    }
  }

  leaveRoom({ roomId, playerId }) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { error: "Player not found" };

    if (room.hostId === playerId) {
      for (const participant of room.players) {
        if (!participant.connected || !participant.socketId || participant.id === playerId) continue;
        this.io.to(participant.socketId).emit("room:forceExit", {
          reason: "Host left the game"
        });
      }

      this.clearRoomTimers(room);
      this.rooms.delete(room.id);
      return { ok: true, roomClosed: true };
    }

    if (room.state === "lobby") {
      room.players = room.players.filter((p) => p.id !== player.id);
    } else {
      player.connected = false;
      player.socketId = null;
    }

    if (!room.players.length) {
      this.clearRoomTimers(room);
      this.rooms.delete(room.id);
      return { ok: true };
    }

    const removed = this.handlePresenceChange(room);
    if (!removed) {
      this.broadcastRoom(room);
    }

    return { ok: true };
  }

  handlePresenceChange(room) {
    const connectedPlayers = room.players.filter((p) => p.connected);

    if (!connectedPlayers.length) {
      this.clearRoomTimers(room);
      this.rooms.delete(room.id);
      return true;
    }

    if (room.state === "round") {
      const allSubmitted = connectedPlayers.every((p) => p.hasSubmitted);
      if (allSubmitted) {
        this.finishRound(room.id);
        return true;
      }
      return false;
    }

    if (room.state === "voting") {
      const connectedIds = new Set(connectedPlayers.map((p) => p.id));
      const expectedVotesPerAnswer = Math.max(0, connectedPlayers.length - 1);
      const allDone = room.recentRoundResults.every((result) => {
        const votes = room.votes[result.playerId] || {};
        const voteCount = Object.keys(votes).filter((voterId) => connectedIds.has(voterId)).length;
        return voteCount >= expectedVotesPerAnswer;
      });

      if (allDone) {
        this.finalizeVoting(room.id);
        return true;
      }
    }

    return false;
  }

  updateSettings(roomId, playerId, nextSettings) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.hostId !== playerId) return { error: "Only host can update settings" };
    if (room.state !== "lobby") return { error: "Cannot update settings now" };

    room.settings = sanitizeSettings(nextSettings, room.settings);
    room.totalRounds = room.settings.rounds;
    this.broadcastRoom(room);
    return { room };
  }

  startGame(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.hostId !== playerId) return { error: "Only host can start" };
    if (room.players.length < 1) return { error: "Need at least one player" };

    room.state = "round";
    room.roundIndex = 0;
    room.players.forEach((p) => {
      p.score = 0;
      p.hasSubmitted = false;
      p.answer = "";
    });
    this.startRound(room);
    return { room };
  }

  nextRound(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.hostId !== playerId) return { error: "Only host can advance" };
    if (room.state !== "roundResults") return { error: "Can only advance from round results" };

    this.advanceGame(roomId);
    return { ok: true };
  }

  startRound(room) {
    // Each round picks a random Pokemon from the generations enabled in settings.
    room.roundIndex += 1;
    room.state = "round";
    const selectedGenerations = room.settings.generations || [1];
    const pool = pokemonData.filter((pokemon) => selectedGenerations.includes(getPokemonGeneration(pokemon.id)));
    const roundPool = pool.length ? pool : pokemonData;
    room.currentPokemon = roundPool[Math.floor(Math.random() * roundPool.length)];
    room.answers = {};
    room.votes = {};
    room.recentRoundResults = [];

    room.players.forEach((p) => {
      p.hasSubmitted = false;
      p.answer = "";
    });

    const durationMs = room.settings.roundDurationSec * 1000;
    room.roundEndsAt = now() + durationMs;
    this.setTicker(room);
    clearTimeout(room.roundTimer);
    room.roundTimer = setTimeout(() => {
      this.finishRound(room.id);
    }, durationMs);

    this.broadcastRoom(room);
  }

  submitAnswer({ roomId, playerId, answer }) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.state !== "round") return { error: "Round is not active" };

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { error: "Player not found" };
    if (player.hasSubmitted) return { error: "Already submitted" };

    const clean = (answer || "").slice(0, 60).trim();
    player.answer = clean;
    player.hasSubmitted = true;
    room.answers[player.id] = clean;

    const allConnectedSubmitted = room.players
      .filter((p) => p.connected)
      .every((p) => p.hasSubmitted);

    this.broadcastRoom(room);

    if (allConnectedSubmitted) {
      this.finishRound(room.id);
    }

    return { ok: true };
  }

  finishRound(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== "round") return;

    clearTimeout(room.roundTimer);
    room.roundTimer = null;

    const expected = room.settings.language === "fr" ? room.currentPokemon.fr : room.currentPokemon.en;

    // Provisional score uses exact match or similarity depending on mode.
    const results = room.players.map((player) => {
      const answer = player.answer || "";
      const exact = normalizeAnswer(answer) === normalizeAnswer(expected);
      const score = room.settings.scoringMode === "approx"
        ? similarityScore(answer, expected)
        : (exact ? 100 : 0);

      return {
        playerId: player.id,
        nickname: player.nickname,
        answer,
        exact,
        provisionalScore: score,
        awardedScore: 0
      };
    });

    room.recentRoundResults = results;

    if (room.settings.scoringMode === "voting") {
      // Voting mode pauses score awarding until players validate answers.
      room.state = "voting";
      room.phaseEndsAt = now() + VOTING_DURATION_MS;
      clearTimeout(room.phaseTimer);
      room.phaseTimer = setTimeout(() => {
        this.finalizeVoting(room.id);
      }, VOTING_DURATION_MS);
      this.setTicker(room);
      this.broadcastRoom(room);
      return;
    }

    for (const result of results) {
      const player = room.players.find((p) => p.id === result.playerId);
      player.score += result.provisionalScore;
      result.awardedScore = result.provisionalScore;
    }

    room.state = "roundResults";
    room.phaseEndsAt = now() + RESULTS_DURATION_MS;
    clearTimeout(room.phaseTimer);
    room.phaseTimer = setTimeout(() => {
      this.advanceGame(room.id);
    }, RESULTS_DURATION_MS);
    this.setTicker(room);
    this.broadcastRoom(room);
  }

  submitVote({ roomId, voterId, targetPlayerId, accepted }) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.state !== "voting") return { error: "Voting is not active" };
    if (voterId === targetPlayerId) return { error: "Cannot vote yourself" };

    if (!room.votes[targetPlayerId]) {
      room.votes[targetPlayerId] = {};
    }
    room.votes[targetPlayerId][voterId] = !!accepted;

    const connectedVoters = room.players.filter((p) => p.connected).length - 1;
    // Round advances early when all expected votes are in.
    const allDone = room.recentRoundResults.every((result) => {
      const votes = room.votes[result.playerId] || {};
      return Object.keys(votes).length >= Math.max(0, connectedVoters);
    });

    this.broadcastRoom(room);
    if (allDone) {
      this.finalizeVoting(room.id);
    }

    return { ok: true };
  }

  finalizeVoting(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== "voting") return;

    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;

    const connectedCount = room.players.filter((p) => p.connected).length;
    const required = Math.max(1, Math.ceil((connectedCount - 1) / 2));

    for (const result of room.recentRoundResults) {
      const targetVotes = room.votes[result.playerId] || {};
      const yesVotes = Object.values(targetVotes).filter(Boolean).length;
      const accepted = yesVotes >= required;
      const awarded = accepted ? result.provisionalScore : 0;

      result.awardedScore = awarded;
      result.voteAccepted = accepted;

      const player = room.players.find((p) => p.id === result.playerId);
      if (player) {
        player.score += awarded;
      }
    }

    room.state = "roundResults";
    room.phaseEndsAt = now() + RESULTS_DURATION_MS;
    room.phaseTimer = setTimeout(() => {
      this.advanceGame(room.id);
    }, RESULTS_DURATION_MS);
    this.setTicker(room);
    this.broadcastRoom(room);
  }

  advanceGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== "roundResults") return;

    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;

    if (room.roundIndex >= room.totalRounds) {
      room.state = "finalResults";
      room.winners = [...room.players].sort((a, b) => b.score - a.score);
      room.phaseEndsAt = null;
      this.clearTicker(room);
      this.broadcastRoom(room);
      return;
    }

    this.startRound(room);
  }

  restartToLobby(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.hostId !== playerId) return { error: "Only host can restart" };

    this.clearRoomTimers(room);
    room.state = "lobby";
    room.roundIndex = 0;
    room.currentPokemon = null;
    room.answers = {};
    room.votes = {};
    room.recentRoundResults = [];
    room.phaseEndsAt = null;
    room.roundEndsAt = null;
    room.players.forEach((p) => {
      p.hasSubmitted = false;
      p.answer = "";
      p.score = 0;
    });
    this.broadcastRoom(room);
    return { room };
  }

  clearRoomTimers(room) {
    clearTimeout(room.roundTimer);
    clearTimeout(room.phaseTimer);
    this.clearTicker(room);
    room.roundTimer = null;
    room.phaseTimer = null;
  }

  clearTicker(room) {
    clearInterval(room.ticker);
    room.ticker = null;
  }

  setTicker(room) {
    this.clearTicker(room);
    room.ticker = setInterval(() => {
      this.broadcastRoom(room);
    }, 1000);
  }

  buildPublicState(room, viewerPlayerId = null) {
    const expected = room.currentPokemon
      ? (room.settings.language === "fr" ? room.currentPokemon.fr : room.currentPokemon.en)
      : null;

    const players = room.players.map(publicPlayer);
    // Answers stay hidden during active guessing to prevent cheating.
    const playerAnswers = {};
    for (const player of room.players) {
      playerAnswers[player.id] = room.state === "round" ? undefined : player.answer;
    }

    return {
      id: room.id,
      hostId: room.hostId,
      settings: room.settings,
      state: room.state,
      roundIndex: room.roundIndex,
      totalRounds: room.totalRounds,
      roundEndsAt: room.roundEndsAt,
      phaseEndsAt: room.phaseEndsAt,
      players,
      currentPokemon: room.currentPokemon
        ? {
            id: room.currentPokemon.id,
            sprite: room.currentPokemon.sprite,
            revealName: room.state === "round" ? null : expected
          }
        : null,
      expectedName: room.state === "round" ? null : expected,
      playerAnswers,
      recentRoundResults: room.recentRoundResults,
      votes: room.votes,
      viewerPlayerId,
      winners: room.winners.map(publicPlayer)
    };
  }

  broadcastRoom(room) {
    for (const player of room.players) {
      if (!player.socketId) continue;
      this.io.to(player.socketId).emit("room:state", this.buildPublicState(room, player.id));
    }
  }
}
