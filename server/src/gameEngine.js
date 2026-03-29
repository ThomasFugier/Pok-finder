import {
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  RESULTS_DURATION_MS,
  VOTING_DURATION_MS
} from "./config.js";
import { createPlayerId, createRoomId, normalizeAnswer, similarityScore } from "./utils.js";
import pokemonData from "./data/pokemon_all.json" with { type: "json" };
import { getPokemonPool as getPokemonPoolFromList } from "../../shared/pokemonUtils.js";
import { sanitizeSettings as sanitizeSettingsShared } from "../../shared/settings.js";

function now() {
  return Date.now();
}

const FIRST_ROUND_REVEAL_DELAY_MS = 3000;

function getPokemonPool(selectedGenerations = [1]) {
  return getPokemonPoolFromList(pokemonData, selectedGenerations);
}

function publicPlayer(player) {
  return {
    id: player.id,
    nickname: player.nickname,
    avatar: player.avatar,
    score: player.score,
    connected: player.connected,
    isHost: player.isHost,
    hasSubmitted: player.hasSubmitted,
    isReady: !!player.isReady
  };
}

function sanitizeSettings(nextSettings = {}, fallback = DEFAULT_SETTINGS) {
  return sanitizeSettingsShared(nextSettings, fallback);
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
          isReady: false,
          hasSubmitted: false,
          answer: ""
        }
      ],
      state: "lobby",
      roundIndex: 0,
      totalRounds: settings.rounds,
      currentPokemon: null,
      usedPokemonIds: [],
      answers: {},
      votes: {},
      roundEndsAt: null,
      roundStartsAt: null,
      phaseEndsAt: null,
      roundTimer: null,
      phaseTimer: null,
      isPaused: false,
      pausedRemainingMs: 0,
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
      isReady: false,
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
    if (room.isPaused) {
      return false;
    }

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
    room.players.forEach((p) => {
      p.isReady = false;
    });
    this.broadcastRoom(room);
    return { room };
  }

  setReadyState(roomId, playerId, isReady) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.state !== "lobby") return { error: "Can only set ready in lobby" };

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { error: "Player not found" };

    player.isReady = !!isReady;
    this.broadcastRoom(room);
    return { ok: true };
  }

  startGame(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.hostId !== playerId) return { error: "Only host can start" };
    if (room.players.length < 1) return { error: "Need at least one player" };
    const connectedPlayers = room.players.filter((p) => p.connected);
    if (!connectedPlayers.every((p) => p.isReady)) {
      return { error: "All players must be ready" };
    }
    const poolSize = getPokemonPool(room.settings.generations || [1]).length;
    if (room.totalRounds > poolSize) {
      return { error: `Not enough unique Pokemon for ${room.totalRounds} rounds with selected generations` };
    }

    room.state = "round";
    room.roundIndex = 0;
    room.usedPokemonIds = [];
    room.isPaused = false;
    room.pausedRemainingMs = 0;
    room.players.forEach((p) => {
      p.score = 0;
      p.isReady = false;
      p.hasSubmitted = false;
      p.answer = "";
    });
    this.startRound(room, { startDelayMs: FIRST_ROUND_REVEAL_DELAY_MS });
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

  togglePause(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.hostId !== playerId) return { error: "Only host can pause" };
    if (!["round", "voting", "roundResults"].includes(room.state)) {
      return { error: "Cannot pause in this phase" };
    }

    if (!room.isPaused) {
      const remainingMs = room.state === "round"
        ? Math.max(0, (room.roundEndsAt || now()) - now())
        : Math.max(0, (room.phaseEndsAt || now()) - now());

      room.isPaused = true;
      room.pausedRemainingMs = remainingMs;
      room.roundEndsAt = room.state === "round" ? null : room.roundEndsAt;
      room.roundStartsAt = room.state === "round" ? null : room.roundStartsAt;
      room.phaseEndsAt = room.state !== "round" ? null : room.phaseEndsAt;

      clearTimeout(room.roundTimer);
      clearTimeout(room.phaseTimer);
      room.roundTimer = null;
      room.phaseTimer = null;
      this.clearTicker(room);
      this.broadcastRoom(room);
      return { ok: true, paused: true };
    }

    const remainingMs = Math.max(0, room.pausedRemainingMs || 0);
    room.isPaused = false;
    room.pausedRemainingMs = 0;

    if (room.state === "round") {
      const roundDurationMs = room.settings.roundDurationSec * 1000;
      const preStartMs = Math.max(0, remainingMs - roundDurationMs);
      room.roundEndsAt = now() + remainingMs;
      room.roundStartsAt = now() + preStartMs;
      clearTimeout(room.roundTimer);
      room.roundTimer = setTimeout(() => {
        this.finishRound(room.id);
      }, remainingMs);
    } else if (room.state === "voting") {
      room.phaseEndsAt = now() + remainingMs;
      clearTimeout(room.phaseTimer);
      room.phaseTimer = setTimeout(() => {
        this.finalizeVoting(room.id);
      }, remainingMs);
    } else if (room.state === "roundResults") {
      room.phaseEndsAt = now() + remainingMs;
      clearTimeout(room.phaseTimer);
      room.phaseTimer = setTimeout(() => {
        this.advanceGame(room.id);
      }, remainingMs);
    }

    this.setTicker(room);
    this.broadcastRoom(room);
    return { ok: true, paused: false };
  }

  startRound(room, { startDelayMs = 0 } = {}) {
    // Each round picks a random Pokemon from the generations enabled in settings.
    room.roundIndex += 1;
    room.state = "round";
    const pool = getPokemonPool(room.settings.generations || [1]);
    const usedSet = new Set(room.usedPokemonIds || []);
    const available = pool.filter((pokemon) => !usedSet.has(pokemon.id));
    const source = available.length ? available : pool;
    room.currentPokemon = source[Math.floor(Math.random() * source.length)];
    room.usedPokemonIds = [...(room.usedPokemonIds || []), room.currentPokemon.id];
    room.answers = {};
    room.votes = {};
    room.recentRoundResults = [];
    room.isPaused = false;
    room.pausedRemainingMs = 0;

    room.players.forEach((p) => {
      p.hasSubmitted = false;
      p.answer = "";
    });

    const delayMs = Math.max(0, startDelayMs);
    const durationMs = room.settings.roundDurationSec * 1000;
    room.roundStartsAt = now() + delayMs;
    room.roundEndsAt = room.roundStartsAt + durationMs;
    this.setTicker(room);
    clearTimeout(room.roundTimer);
    room.roundTimer = setTimeout(() => {
      this.finishRound(room.id);
    }, delayMs + durationMs);

    this.broadcastRoom(room);
  }

  submitAnswer({ roomId, playerId, answer }) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: "Room not found" };
    if (room.state !== "round") return { error: "Round is not active" };
    if (room.roundStartsAt && now() < room.roundStartsAt) return { error: "Round has not started yet" };

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
    room.isPaused = false;
    room.pausedRemainingMs = 0;
    room.roundStartsAt = null;

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
    room.isPaused = false;
    room.pausedRemainingMs = 0;
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
    room.isPaused = false;
    room.pausedRemainingMs = 0;
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
      room.isPaused = false;
      room.pausedRemainingMs = 0;
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
    room.usedPokemonIds = [];
    room.answers = {};
    room.votes = {};
    room.recentRoundResults = [];
    room.roundStartsAt = null;
    room.phaseEndsAt = null;
    room.roundEndsAt = null;
    room.players.forEach((p) => {
      p.isReady = false;
      p.hasSubmitted = false;
      p.answer = "";
      p.score = 0;
    });
    room.isPaused = false;
    room.pausedRemainingMs = 0;
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

  clearTicker(_room) {
    // Tick updates are computed client-side from timestamps.
  }

  setTicker(_room) {
    // Intentionally no-op to avoid full-state broadcasts every second.
  }

  buildPublicState(room, viewerPlayerId = null) {
    const hasRoundStarted = room.state !== "round" || !room.roundStartsAt || now() >= room.roundStartsAt;
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
      isPaused: room.isPaused,
      pausedRemainingMs: room.isPaused ? room.pausedRemainingMs : 0,
      roundIndex: room.roundIndex,
      totalRounds: room.totalRounds,
      roundStartsAt: room.roundStartsAt,
      roundEndsAt: room.roundEndsAt,
      phaseEndsAt: room.phaseEndsAt,
      players,
      currentPokemon: room.currentPokemon && hasRoundStarted
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
