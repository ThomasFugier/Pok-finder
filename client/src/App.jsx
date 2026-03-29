import { useEffect, useMemo, useRef, useState } from "react";
import { checkServerHealth, emitAck, socket } from "./socket";
import { useGameStore } from "./store";
import pokemonData from "./data/pokemon151.json";

const AVATAR_ASSETS = {
  red: {
    label: "Red",
    image: "https://play.pokemonshowdown.com/sprites/trainers/red.png"
  },
  prof_oak: {
    label: "Prof. Chen",
    image: "https://play.pokemonshowdown.com/sprites/trainers/oak.png"
  },
  misty: {
    label: "Misty",
    image: "https://play.pokemonshowdown.com/sprites/trainers/misty.png"
  },
  brock: {
    label: "Brock",
    image: "https://play.pokemonshowdown.com/sprites/trainers/brock.png"
  },
  team_rocket: {
    label: "Team Rocket",
    image: "https://play.pokemonshowdown.com/sprites/trainers/teamrocket.png"
  },
  rocket_grunt: {
    label: "Rocket Grunt",
    image: "https://play.pokemonshowdown.com/sprites/trainers/rocketgrunt.png"
  },
  giovanni: {
    label: "Giovanni",
    image: "https://play.pokemonshowdown.com/sprites/trainers/giovanni.png"
  },
  cynthia: {
    label: "Cynthia",
    image: "https://play.pokemonshowdown.com/sprites/trainers/cynthia.png"
  }
};

const AVATARS = Object.keys(AVATAR_ASSETS);

const DISPLAY_MODE_LABELS = {
  normal: { en: "Normal", fr: "Normal" },
  whosthat: { en: "Who's that Pokemon mode", fr: "Who's that Pokemon mode" }
};

const ROUND_OPTIONS = [10, 20, 50];
const TIMER_OPTIONS_SEC = [10, 15, 30, 45, 60];
const LANGUAGE_OPTIONS = ["en", "fr"];
const DISPLAY_MODE_OPTIONS = ["normal", "whosthat"];
const SCORING_MODE_OPTIONS = ["exact", "voting", "approx"];
const GENERATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ENABLED_GENERATIONS = [1];
const RESULTS_DURATION_MS = 60000;
const VOTING_DURATION_MS = 12000;
const DEFAULT_SETTINGS = {
  rounds: 10,
  language: "en",
  displayMode: "normal",
  scoringMode: "approx",
  roundDurationSec: 30,
  generations: [1]
};

const LANGUAGE_LABELS = {
  fr: "French",
  en: "English"
};

const DISPLAY_MODE_PICKER_LABELS = {
  normal: { fr: "Normal", en: "Normal" },
  whosthat: { fr: "Silhouette", en: "Silhouette" }
};

const SCORING_MODE_PICKER_LABELS = {
  exact: { fr: "Exact", en: "Exact" },
  voting: { fr: "Vote", en: "Voting" },
  approx: { fr: "Approx", en: "Approx" }
};

function sanitizeSettings(nextSettings = {}, fallback = DEFAULT_SETTINGS) {
  const rounds = ROUND_OPTIONS.includes(nextSettings.rounds) ? nextSettings.rounds : fallback.rounds;
  const language = LANGUAGE_OPTIONS.includes(nextSettings.language) ? nextSettings.language : fallback.language;
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

function getLocalIdentity() {
  try {
    const raw = localStorage.getItem("pokefinder.identity");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setLocalIdentity(value) {
  localStorage.setItem("pokefinder.identity", JSON.stringify(value));
}

function clearLocalIdentity() {
  localStorage.removeItem("pokefinder.identity");
}

function getLocalSetupSettings() {
  try {
    const raw = localStorage.getItem("pokefinder.setupSettings");
    if (!raw) return DEFAULT_SETTINGS;
    return sanitizeSettings(JSON.parse(raw), DEFAULT_SETTINGS);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function setLocalSetupSettings(value) {
  localStorage.setItem("pokefinder.setupSettings", JSON.stringify(value));
}

function timeLeftMs(ts, currentNow) {
  if (!ts) return 0;
  return Math.max(0, ts - currentNow);
}

function normalizeAnswer(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const s = a ?? "";
  const t = b ?? "";
  const rows = s.length + 1;
  const cols = t.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[s.length][t.length];
}

function similarityScore(input, expected) {
  const normalizedInput = normalizeAnswer(input);
  const normalizedExpected = normalizeAnswer(expected);
  if (!normalizedInput || !normalizedExpected) return 0;
  if (normalizedInput === normalizedExpected) return 100;
  const distance = levenshtein(normalizedInput, normalizedExpected);
  const maxLength = Math.max(normalizedInput.length, normalizedExpected.length);
  const ratio = Math.max(0, 1 - distance / maxLength);
  return Math.round(ratio * 100);
}

function clonePlayers(players) {
  return players.map((p) => ({ ...p }));
}

function getAvatarAsset(avatarId) {
  return AVATAR_ASSETS[avatarId] || AVATAR_ASSETS[AVATARS[0]];
}

function pickRandomAvatar(excludeAvatarId) {
  const pool = AVATARS.filter((id) => id !== excludeAvatarId);
  if (!pool.length) return AVATARS[0];
  return pool[Math.floor(Math.random() * pool.length)];
}

function getRoundTargetName(room) {
  if (!room || room.state !== "round" || !room.currentPokemon) return "";
  return room.settings.language === "fr" ? room.currentPokemon.fr : room.currentPokemon.en;
}

function buildAnswerMaskTemplate(targetName) {
  if (!targetName) return "__________";
  return Array.from(targetName)
    .map((char) => (/[0-9A-Za-zÀ-ÿ]/.test(char) ? "_" : char))
    .join("");
}

function buildAnswerMaskTokens(template, typedValue) {
  let typedIndex = 0;
  const typedChars = Array.from(typedValue || "");
  const activeSlotIndex = typedChars.length;
  let slotIndex = 0;

  return Array.from(template)
    .map((slot) => {
      if (slot !== "_") {
        return {
          char: slot,
          isCurrent: false
        };
      }

      const nextChar = typedChars[typedIndex];
      const token = {
        char: nextChar ? nextChar.toUpperCase() : "_",
        isCurrent: !nextChar && slotIndex === activeSlotIndex
      };

      typedIndex += 1;
      slotIndex += 1;
      return token;
    });
}

function countAnswerSlots(template) {
  return Array.from(template).filter((slot) => slot === "_").length;
}

function hydrateAnswerFromTemplate(template, typedValue) {
  let typedIndex = 0;
  const typedChars = Array.from(typedValue || "");
  let output = "";

  for (const slot of Array.from(template)) {
    if (slot === "_") {
      if (typedIndex >= typedChars.length) break;
      output += typedChars[typedIndex];
      typedIndex += 1;
      continue;
    }

    if (typedIndex > 0) {
      output += slot;
    }
  }

  return output.trim();
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

function pickRandomPokemon(selectedGenerations = [1]) {
  const pool = pokemonData.filter((pokemon) => selectedGenerations.includes(getPokemonGeneration(pokemon.id)));
  const roundPool = pool.length ? pool : pokemonData;
  return roundPool[Math.floor(Math.random() * roundPool.length)];
}

function startLocalRound(room) {
  const players = clonePlayers(room.players).map((p) => ({ ...p, hasSubmitted: false, answer: "" }));
  return {
    ...room,
    state: "round",
    roundIndex: room.roundIndex + 1,
    players,
    currentPokemon: pickRandomPokemon(room.settings.generations),
    roundEndsAt: Date.now() + (room.settings.roundDurationSec * 1000),
    phaseEndsAt: null,
    expectedName: null,
    recentRoundResults: [],
    votes: {}
  };
}

function finishLocalRound(room) {
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
    roundEndsAt: null,
    phaseEndsAt: Date.now() + RESULTS_DURATION_MS,
    recentRoundResults
  };
}

function advanceLocalGame(room) {
  if (room.state !== "roundResults") return room;
  if (room.roundIndex >= room.totalRounds) {
    const winners = clonePlayers(room.players).sort((a, b) => b.score - a.score);
    return {
      ...room,
      state: "finalResults",
      phaseEndsAt: null,
      winners
    };
  }
  return startLocalRound(room);
}

function createLocalRoom({ playerId, nickname, avatar, settings }) {
  const initialSettings = sanitizeSettings(settings, DEFAULT_SETTINGS);
  return {
    id: "LOCAL",
    hostId: playerId,
    settings: initialSettings,
    state: "lobby",
    roundIndex: 0,
    totalRounds: initialSettings.rounds,
    roundEndsAt: null,
    phaseEndsAt: null,
    expectedName: null,
    players: [
      {
        id: playerId,
        nickname,
        avatar,
        score: 0,
        connected: true,
        isHost: true,
        hasSubmitted: false,
        answer: ""
      }
    ],
    currentPokemon: null,
    recentRoundResults: [],
    votes: {},
    winners: []
  };
}

function useNowTick() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(id);
  }, []);
  return now;
}

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

function PokemonCanvas({ sprite, hidden }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!sprite || !ref.current) return;
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    const pixelBuffer = document.createElement("canvas");
    const pixelCtx = pixelBuffer.getContext("2d");
    let frameId = null;
    let cancelled = false;

    const drawFrame = ({ pixelFactor, maskOpacity, offsetY, distortFactor }) => {
      const width = canvas.width;
      const height = canvas.height;
      const fit = width * 0.86;
      const ratio = img.width / img.height;
      const baseWidth = ratio >= 1 ? fit : fit * ratio;
      const baseHeight = ratio >= 1 ? fit / ratio : fit;
      const drawWidth = baseWidth * (1 + (0.2 * distortFactor));
      const drawHeight = baseHeight * (1 - (0.14 * distortFactor));
      const wobbleX = Math.sin((1 - distortFactor) * Math.PI * 3) * 4 * distortFactor;
      const x = ((width - drawWidth) / 2) + wobbleX;
      const y = (height - drawHeight) / 2 + offsetY;

      const sampleWidth = Math.max(1, Math.round(drawWidth * pixelFactor));
      const sampleHeight = Math.max(1, Math.round(drawHeight * pixelFactor));
      pixelBuffer.width = sampleWidth;
      pixelBuffer.height = sampleHeight;
      pixelCtx.clearRect(0, 0, sampleWidth, sampleHeight);
      pixelCtx.imageSmoothingEnabled = false;
      pixelCtx.drawImage(img, 0, 0, sampleWidth, sampleHeight);

      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pixelBuffer, x, y, drawWidth, drawHeight);
      ctx.imageSmoothingEnabled = true;

      if (maskOpacity > 0) {
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = `rgba(6, 8, 15, ${maskOpacity})`;
        ctx.fillRect(x, y, drawWidth, drawHeight);
        ctx.globalCompositeOperation = "source-over";
      }
    };

    const animateReveal = (timestamp, startTime) => {
      if (cancelled) return;
      const elapsed = timestamp - startTime;
      const revealDurationMs = 1000;
      const travelProgress = Math.min(1, elapsed / revealDurationMs);
      const pixelProgress = Math.min(1, elapsed / revealDurationMs);
      const maskProgress = Math.min(1, elapsed / revealDurationMs);

      const offsetY = (1 - easeOutCubic(travelProgress)) * 34;
      const pixelFactor = 0.03 + (0.97 * easeOutCubic(pixelProgress));
      const maskOpacity = hidden ? 1 : (1 - easeOutCubic(maskProgress));
      const distortFactor = 1 - easeOutCubic(pixelProgress);

      drawFrame({ pixelFactor, maskOpacity, offsetY, distortFactor });

      if (travelProgress < 1 || pixelProgress < 1 || (!hidden && maskProgress < 1)) {
        frameId = requestAnimationFrame((nextTs) => animateReveal(nextTs, startTime));
        return;
      }

      drawFrame({ pixelFactor: 1, maskOpacity: hidden ? 1 : 0, offsetY: 0, distortFactor: 0 });
    };

    img.crossOrigin = "anonymous";
    img.onload = () => {
      frameId = requestAnimationFrame((ts) => animateReveal(ts, ts));
    };
    img.src = sprite;

    return () => {
      cancelled = true;
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [sprite, hidden]);

  return <canvas className="pokemon-canvas" width="220" height="220" ref={ref} />;
}

function App() {
  const now = useNowTick();
  const {
    room,
    roomId,
    playerId,
    nickname,
    avatar,
    error,
    setError,
    setIdentity,
    setRoom,
    resetAll
  } = useGameStore();

  const [formName, setFormName] = useState(nickname || "");
  const [formAvatar, setFormAvatar] = useState(avatar || AVATARS[0]);
  const [formSettings, setFormSettings] = useState(() => getLocalSetupSettings());
  const [joinRoomId, setJoinRoomId] = useState(() => {
    try {
      const value = new URLSearchParams(window.location.search).get("room") || "";
      return value.toUpperCase().slice(0, 5);
    } catch {
      return "";
    }
  });
  const [answer, setAnswer] = useState("");
  const [serverOnline, setServerOnline] = useState(false);
  const [serverChecking, setServerChecking] = useState(true);
  const [inviteCopied, setInviteCopied] = useState(false);
  const answerInputRef = useRef(null);

  const me = useMemo(() => room?.players?.find((p) => p.id === playerId), [room, playerId]);
  const isHost = !!(me && room?.hostId === me.id);
  const isLocalRoom = room?.id === "LOCAL";
  const isInLobby = !!(room && room.state === "lobby");

  useEffect(() => {
    const identity = getLocalIdentity();
    if (identity?.roomId && identity?.playerId) {
      setIdentity(identity);
    }
  }, [setIdentity]);

  useEffect(() => {
    let cancelled = false;

    const runHealthCheck = async () => {
      setServerChecking(true);
      const online = await checkServerHealth();
      if (cancelled) return;
      setServerOnline(online);
      setServerChecking(false);
    };

    runHealthCheck();
    const intervalId = setInterval(runHealthCheck, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    socket.connect();

    socket.on("room:state", (nextRoom) => {
      setRoom(nextRoom);
      setError("");
    });

    socket.on("room:forceExit", (payload) => {
      clearLocalIdentity();
      resetAll();
      setError(payload?.reason || "Room was closed by host");
    });

    socket.on("connect", async () => {
      setServerOnline(true);
      setServerChecking(false);
      const identity = getLocalIdentity();
      if (identity?.roomId && identity?.playerId && identity.roomId !== "LOCAL") {
        setIdentity(identity);
        await emitAck("room:reconnect", {
          roomId: identity.roomId,
          playerId: identity.playerId
        });
      }
    });

    socket.on("connect_error", () => {
      setServerOnline(false);
    });

    socket.on("disconnect", () => {
      setServerOnline(false);
    });

    return () => {
      socket.off("room:state");
      socket.off("room:forceExit");
      socket.off("connect");
      socket.off("connect_error");
      socket.off("disconnect");
      socket.disconnect();
    };
  }, [resetAll, setError, setIdentity, setRoom]);

  useEffect(() => {
    if (!isLocalRoom || !room) return;
    if (room.state === "round" && room.roundEndsAt && now >= room.roundEndsAt) {
      setRoom(finishLocalRound(room));
      return;
    }
    if (room.state === "roundResults" && room.phaseEndsAt && now >= room.phaseEndsAt) {
      setRoom(advanceLocalGame(room));
    }
  }, [now, room, isLocalRoom, setRoom]);

  useEffect(() => {
    setAnswer("");
  }, [room?.roundIndex, room?.state]);

  useEffect(() => {
    if (room?.state !== "round" || me?.hasSubmitted) return;
    const focusId = requestAnimationFrame(() => {
      answerInputRef.current?.focus();
      answerInputRef.current?.select();
    });
    return () => cancelAnimationFrame(focusId);
  }, [room?.state, room?.roundIndex, me?.hasSubmitted]);

  useEffect(() => {
    if (room?.state === "lobby" && room?.settings) {
      setFormSettings(sanitizeSettings(room.settings, DEFAULT_SETTINGS));
    }
  }, [room?.state, room?.settings]);

  useEffect(() => {
    setLocalSetupSettings(formSettings);
  }, [formSettings]);

  function applyMenuSettings(partial) {
    const nextSettings = sanitizeSettings({ ...formSettings, ...partial }, DEFAULT_SETTINGS);
    setFormSettings(nextSettings);

    if (!isInLobby || !room) return;

    if (isLocalRoom) {
      setRoom({
        ...room,
        settings: nextSettings,
        totalRounds: nextSettings.rounds
      });
      return;
    }

    emitAck("room:updateSettings", {
      roomId: room.id,
      playerId,
      settings: nextSettings
    }).then((res) => {
      if (!res.ok) setError(res.error || "Failed to update settings");
    });
  }

  function startSoloLocal() {
    const cleanName = (formName || "Player").slice(0, 20);
    const settings = sanitizeSettings(formSettings, DEFAULT_SETTINGS);
    const localPlayerId = `local_${Math.random().toString(36).slice(2, 10)}`;
    const identity = {
      roomId: "LOCAL",
      playerId: localPlayerId,
      nickname: cleanName,
      avatar: formAvatar
    };

    setIdentity(identity);
    setRoom(createLocalRoom({
      playerId: localPlayerId,
      nickname: cleanName,
      avatar: formAvatar,
      settings
    }));
    setLocalIdentity(identity);
    setError("");
  }

  async function createRoom() {
    if (!serverOnline) {
      setError("Server unavailable");
      return;
    }

    const cleanName = (formName || "Player").slice(0, 20);
    const settings = sanitizeSettings(formSettings, DEFAULT_SETTINGS);
    const previous = getLocalIdentity();
    const res = await emitAck("room:create", {
      nickname: cleanName,
      avatar: formAvatar,
      playerId: previous?.playerId,
      settings
    });
    if (!res.ok) {
      setError(res.error || "Failed to create room");
      return;
    }

    const identity = {
      roomId: res.roomId,
      playerId: res.playerId,
      nickname: cleanName,
      avatar: formAvatar
    };
    setIdentity(identity);
    setLocalIdentity(identity);
  }

  async function copyRoomInvite(targetRoomId = room?.id) {
    if (!targetRoomId || targetRoomId === "LOCAL") return;

    const roomCode = targetRoomId.toUpperCase();
    const baseUrl = window.location.origin;
    const joinUrl = `${baseUrl}/?room=${encodeURIComponent(roomCode)}`;
    const inviteText = `Come play with me on Pokefinder Party!\nRoom code: ${roomCode}\n${joinUrl}`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteText);
      } else {
        const temp = document.createElement("textarea");
        temp.value = inviteText;
        temp.setAttribute("readonly", "true");
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
      }
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1800);
    } catch {
      setError("Failed to copy room link");
    }
  }

  async function joinRoom() {
    const cleanName = (formName || "Player").slice(0, 20);
    const code = joinRoomId.trim().toUpperCase();
    const previous = getLocalIdentity();
    const res = await emitAck("room:join", {
      roomId: code,
      nickname: cleanName,
      avatar: formAvatar,
      playerId: previous?.playerId
    });
    if (!res.ok) {
      setError(res.error || "Failed to join room");
      return;
    }

    const identity = {
      roomId: code,
      playerId: res.playerId,
      nickname: cleanName,
      avatar: formAvatar
    };
    setIdentity(identity);
    setLocalIdentity(identity);
  }

  async function startGame() {
    if (!room) return;

    if (isLocalRoom) {
      const players = clonePlayers(room.players).map((p) => ({ ...p, score: 0, hasSubmitted: false, answer: "" }));
      setRoom(startLocalRound({ ...room, players, roundIndex: 0, winners: [] }));
      return;
    }

    const res = await emitAck("game:start", { roomId: room.id, playerId });
    if (!res.ok) setError(res.error || "Failed to start");
  }

  async function nextRoundNow() {
    if (!room || room.state !== "roundResults") return;

    if (isLocalRoom) {
      if (!isHost) return;
      setRoom(advanceLocalGame(room));
      return;
    }

    const res = await emitAck("game:nextRound", { roomId: room.id, playerId });
    if (!res.ok) setError(res.error || "Failed to go next");
  }

  async function submitAnswer() {
    if (!room) return;
    const roundTemplate = buildAnswerMaskTemplate(getRoundTargetName(room));
    const preparedAnswer = hydrateAnswerFromTemplate(roundTemplate, answer);
    if (!preparedAnswer) return;

    if (isLocalRoom) {
      const players = clonePlayers(room.players).map((p) => {
        if (p.id !== playerId || p.hasSubmitted) return p;
        return { ...p, answer: preparedAnswer, hasSubmitted: true };
      });
      const updated = { ...room, players };
      setRoom(finishLocalRound(updated));
      return;
    }

    const res = await emitAck("answer:submit", {
      roomId: room.id,
      playerId,
      answer: preparedAnswer
    });
    if (!res.ok) setError(res.error || "Failed to submit answer");
  }

  async function submitVote(targetPlayerId, accepted) {
    if (!room) return;

    if (isLocalRoom) {
      const nextResults = room.recentRoundResults.map((result) => (
        result.playerId === targetPlayerId
          ? { ...result, voteAccepted: accepted, awardedScore: accepted ? result.provisionalScore : 0 }
          : result
      ));
      const nextPlayers = clonePlayers(room.players).map((p) => {
        const result = nextResults.find((r) => r.playerId === p.id);
        if (!result) return p;
        return { ...p, score: result.awardedScore };
      });
      setRoom({ ...room, recentRoundResults: nextResults, players: nextPlayers });
      return;
    }

    const res = await emitAck("vote:submit", {
      roomId: room.id,
      playerId,
      targetPlayerId,
      accepted
    });
    if (!res.ok) setError(res.error || "Failed to vote");
  }

  async function returnToLobby() {
    if (!room) return;

    if (isLocalRoom) {
      const players = clonePlayers(room.players).map((p) => ({ ...p, score: 0, hasSubmitted: false, answer: "" }));
      setRoom({
        ...room,
        state: "lobby",
        roundIndex: 0,
        totalRounds: room.settings.rounds,
        currentPokemon: null,
        roundEndsAt: null,
        phaseEndsAt: null,
        expectedName: null,
        recentRoundResults: [],
        winners: [],
        players
      });
      return;
    }

    const res = await emitAck("game:returnLobby", { roomId: room.id, playerId });
    if (!res.ok) setError(res.error || "Failed to return to lobby");
  }

  async function quitRoom() {
    if (!room) return;

    if (isLocalRoom) {
      clearLocalIdentity();
      resetAll();
      return;
    }

    const res = await emitAck("room:leave", { roomId: room.id, playerId });
    if (!res.ok) {
      setError(res.error || "Failed to quit room");
      return;
    }

    clearLocalIdentity();
    resetAll();
  }

  const roundMs = room?.state === "round" ? timeLeftMs(room?.roundEndsAt, now) : 0;
  const phaseMs = room?.state !== "round" ? timeLeftMs(room?.phaseEndsAt, now) : 0;

  const timerTotalMs = room?.state === "round"
    ? (room.settings.roundDurationSec * 1000)
    : (room?.state === "voting" ? VOTING_DURATION_MS : RESULTS_DURATION_MS);
  const timerRemainingMs = room?.state === "round" ? roundMs : phaseMs;
  const timerProgress = Math.max(0, Math.min(1, timerRemainingMs / Math.max(1, timerTotalMs)));
  const timerFillProgress = 1 - timerProgress;
  const timerLabel = room?.state === "round"
    ? `${Math.ceil(timerRemainingMs / 1000)}`
    : (room?.state === "voting"
      ? `${Math.ceil(timerRemainingMs / 1000)}`
      : (room?.state === "roundResults"
        ? `${Math.ceil(timerRemainingMs / 1000)}`
        : "0"));
  const canEditSettings = !isInLobby || isHost;
  const roomDisplayLabel = room
    ? (DISPLAY_MODE_LABELS[room.settings.displayMode]?.[room.settings.language] || DISPLAY_MODE_LABELS.normal.en)
    : "";
  const roomGenerationsLabel = room
    ? `Gen ${[...(room.settings.generations || [1])].sort((a, b) => a - b).join(", ")}`
    : "";
  const roundIndexValue = Math.max(0, ROUND_OPTIONS.indexOf(formSettings.rounds));
  const timerIndexValue = Math.max(0, TIMER_OPTIONS_SEC.indexOf(formSettings.roundDurationSec));
  const answerMaskTemplate = buildAnswerMaskTemplate(getRoundTargetName(room));
  const answerSlotsCount = countAnswerSlots(answerMaskTemplate);
  const answerMaskTokens = buildAnswerMaskTokens(answerMaskTemplate, answer);
  const sortedPlayers = room?.players
    ? room.players.slice().sort((a, b) => b.score - a.score)
    : [];

  if (!roomId || !playerId || !room || room.state === "lobby") {
    return (
      <main className="page page-home">
        <section className="party-shell ultra-menu">
          <header className="menu-topbar">
            <div className="brand-block">
              <h1>Pokefinder Party</h1>
            </div>
            <div className="menu-status">
              <span className={serverOnline ? "status-pill online" : "status-pill offline"}>
                <span className={serverOnline ? "network-icon online" : "network-icon offline"} aria-hidden="true" />
                <span>{serverOnline ? "Server online" : "Server offline"}</span>
                {serverChecking ? <span className="status-spinner" aria-hidden="true" /> : null}
              </span>
              {isInLobby ? <p className="room-code">Active code: {room.id}</p> : null}
            </div>
          </header>

          <div className="menu-tile-grid">
            <section className="menu-tile playopedia">
              <h3>Trainer profile</h3>
              <div className="profile-identity">
                <div className="profile-avatar-picker">
                  <div className="profile-avatar-shell">
                    <span className="avatar-preview profile-avatar">
                      <img
                        className="avatar-image"
                        src={getAvatarAsset(formAvatar).image}
                        alt={getAvatarAsset(formAvatar).label}
                        loading="lazy"
                      />
                    </span>
                    <button
                      type="button"
                      className="avatar-random-btn"
                      onClick={() => setFormAvatar((previous) => pickRandomAvatar(previous))}
                      aria-label="Change avatar"
                      title="Change avatar"
                    >
                      <span aria-hidden="true">⇄</span>
                    </button>
                  </div>
                </div>
                <label className="profile-name-field">
                  What's your name?
                  <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Your nickname" />
                </label>
              </div>
            </section>

            <section className="menu-tile crew">
              <h3>Game settings</h3>
              <div className="settings">
                <div className="setting-block range-setting">
                  <div className="setting-head">
                    <span>Rounds</span>
                    <strong>{formSettings.rounds}</strong>
                  </div>
                  <input
                    className="range-input"
                    type="range"
                    min={0}
                    max={ROUND_OPTIONS.length - 1}
                    step={1}
                    value={roundIndexValue}
                    onChange={(e) => applyMenuSettings({ rounds: ROUND_OPTIONS[Number(e.target.value)] })}
                    disabled={!canEditSettings}
                  />
                  <div className="range-stops">
                    {ROUND_OPTIONS.map((value) => (
                      <span key={value} className={value === formSettings.rounds ? "active" : ""}>{value}</span>
                    ))}
                  </div>
                </div>

                <div className="setting-block">
                  <span className="setting-title">Language</span>
                  <div className="toggle-group">
                    {LANGUAGE_OPTIONS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={value === formSettings.language ? "toggle-pill active" : "toggle-pill"}
                        onClick={() => applyMenuSettings({ language: value })}
                        disabled={!canEditSettings}
                      >
                        {LANGUAGE_LABELS[value]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-block">
                  <span className="setting-title">Generation</span>
                  <div className="toggle-group generations">
                    {GENERATION_OPTIONS.map((value) => {
                      const isSelected = formSettings.generations.includes(value);
                      const isEnabled = ENABLED_GENERATIONS.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          className={isSelected ? "toggle-pill active" : "toggle-pill"}
                          onClick={() => {
                            if (!isEnabled) return;
                            if (isSelected && formSettings.generations.length === 1) return;
                            const nextGenerations = isSelected
                              ? formSettings.generations.filter((item) => item !== value)
                              : [...formSettings.generations, value];
                            applyMenuSettings({ generations: nextGenerations });
                          }}
                          disabled={!canEditSettings || !isEnabled}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                  <small className="setting-note">More generations coming soon</small>
                </div>

                <div className="setting-block">
                  <span className="setting-title">Display mode</span>
                  <div className="toggle-group">
                    {DISPLAY_MODE_OPTIONS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={value === formSettings.displayMode ? "toggle-pill active" : "toggle-pill"}
                        onClick={() => applyMenuSettings({ displayMode: value })}
                        disabled={!canEditSettings}
                      >
                        {DISPLAY_MODE_PICKER_LABELS[value]?.[formSettings.language] || value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-block">
                  <span className="setting-title">Scoring</span>
                  <div className="toggle-group three">
                    {SCORING_MODE_OPTIONS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={value === formSettings.scoringMode ? "toggle-pill active" : "toggle-pill"}
                        onClick={() => applyMenuSettings({ scoringMode: value })}
                        disabled={!canEditSettings}
                      >
                        {SCORING_MODE_PICKER_LABELS[value]?.[formSettings.language] || value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-block range-setting">
                  <div className="setting-head">
                    <span>Timer</span>
                    <strong>{formSettings.roundDurationSec}s</strong>
                  </div>
                  <input
                    className="range-input"
                    type="range"
                    min={0}
                    max={TIMER_OPTIONS_SEC.length - 1}
                    step={1}
                    value={timerIndexValue}
                    onChange={(e) => applyMenuSettings({ roundDurationSec: TIMER_OPTIONS_SEC[Number(e.target.value)] })}
                    disabled={!canEditSettings}
                  />
                  <div className="range-stops">
                    {TIMER_OPTIONS_SEC.map((value) => (
                      <span key={value} className={value === formSettings.roundDurationSec ? "active" : ""}>{value}s</span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="menu-tile cup">
              {!isInLobby ? (
                <div className="action-stage">
                  <h3>Lobby</h3>
                  <div className="salon-actions">
                    <button className="primary big-cta" onClick={createRoom} disabled={!serverOnline}>Create lobby</button>
                    <button className="big-cta" onClick={startSoloLocal}>Play local solo</button>
                  </div>
                  <p className="join-label">Already have a room code?</p>
                  <div className="join">
                    <input
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                      placeholder="Room code"
                      maxLength={5}
                    />
                      <button onClick={joinRoom}>Join</button>
                  </div>
                </div>
              ) : (
                <div className="lobby-stage">
                  <div className="lobby-head">
                    <h3>Room {room.id}</h3>
                    <span>{room.players.length}/8</span>
                  </div>
                  <div className="lobby-summary">
                    <span>{room.settings.rounds} rounds</span>
                    <span>{room.settings.roundDurationSec}s / round</span>
                    <span>{roomDisplayLabel}</span>
                    <span>{roomGenerationsLabel}</span>
                    <span>{room.settings.language.toUpperCase()}</span>
                  </div>
                  <ul className="lobby-player-list">
                    {room.players
                      .slice()
                      .sort((a, b) => b.score - a.score)
                      .map((p) => (
                        <li key={p.id}>
                          <span className="player-badge">
                            <img
                              className="avatar-image"
                              src={getAvatarAsset(p.avatar).image}
                              alt={getAvatarAsset(p.avatar).label}
                              loading="lazy"
                            />
                          </span>
                          <strong>{p.nickname}</strong>
                          <span>{p.isHost ? "Host" : "Player"}</span>
                        </li>
                      ))}
                  </ul>
                  <div className={room.id !== "LOCAL" ? "cta-row with-share" : "cta-row"}>
                    <button onClick={quitRoom}>Leave</button>
                    {room.id !== "LOCAL" ? (
                      <button className="share-btn" onClick={() => copyRoomInvite(room.id)}>Copy room link</button>
                    ) : null}
                    {isHost ? (
                      <button className="primary big-cta" onClick={startGame}>Start game</button>
                    ) : (
                      <button className="big-cta" disabled>Start game</button>
                    )}
                  </div>
                  {inviteCopied ? <p className="waiting-text">Invite copied</p> : null}
                  {!isHost ? <p className="waiting-text">Waiting for host...</p> : null}
                </div>
              )}
            </section>
          </div>

          {error ? <p className="error home-error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main
      className={`page page-room ${room.state === "round" ? "round-active-screen" : ""} ${room.state === "roundResults" ? "results-screen" : ""}`.trim()}
    >
      <header className="topbar card">
        <button className="quit-btn" onClick={quitRoom}>Leave</button>
        {room.state !== "finalResults" ? (
          <div className="top-salon">
            <h3>Salon ({room.players.length}/8)</h3>
            <ul className="top-salon-list">
              {sortedPlayers.map((p, index) => (
                <li key={p.id} className={`${!p.connected ? "disconnected" : ""} ${p.id === playerId ? "me" : ""}`.trim()}>
                  <span className="rank">#{index + 1}</span>
                  <span className="player-avatar">
                    <img
                      className="avatar-image"
                      src={getAvatarAsset(p.avatar).image}
                      alt={getAvatarAsset(p.avatar).label}
                      loading="lazy"
                    />
                  </span>
                  <strong>{p.nickname}</strong>
                  <span className="player-score">{p.score} pts</span>
                  {p.isHost ? <span className="host-chip">Host</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : <div className="top-salon spacer" />}
        <div className="topbar-right">
          {room.id !== "LOCAL" ? (
            <button className="share-btn" onClick={() => copyRoomInvite(room.id)}>Copy room link</button>
          ) : null}
          {inviteCopied ? <span className="copied-pill">Copied</span> : null}
          <div className="round-counter">{room.roundIndex}/{room.totalRounds}</div>
        </div>
      </header>

      <section className="layout">
        {room.state === "round" && (
          <section className="panel panel-round fade-in">
            <div className="round-focus-zone">
              <h3>Who's that Pokemon?</h3>
              <div className="pokemon-stage">
                <PokemonCanvas
                  sprite={room.currentPokemon?.sprite}
                  hidden={room.settings.displayMode === "whosthat"}
                />
              </div>
              <p className="panel-hint">
                Type your best guess before the timer ends.
              </p>
              <div className="answer-row">
                <div className="answer-mask-input">
                  <span className="answer-mask-display" aria-hidden="true">
                    <span className="answer-mask-content">
                      <span className="answer-mask-arrow">▶</span>
                      {answerMaskTokens.map((token, index) => (
                        <span key={`${token.char}-${index}`} className={token.isCurrent ? "mask-char current" : "mask-char"}>
                          {token.char === " " ? "\u00A0" : token.char}
                        </span>
                      ))}
                    </span>
                  </span>
                  <input
                    ref={answerInputRef}
                    className="answer-mask-field"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value.replace(/[^0-9A-Za-zÀ-ÿ]/g, "").slice(0, answerSlotsCount))}
                    placeholder=""
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={answerSlotsCount}
                    disabled={me?.hasSubmitted}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitAnswer();
                    }}
                    aria-label="Pokemon name"
                  />
                </div>
                <button onClick={submitAnswer} disabled={me?.hasSubmitted || !answer.trim()}>
                  Submit
                </button>
              </div>
            </div>
          </section>
        )}

        {room.state === "voting" && (
          <section className="card panel fade-in">
            <h3>Voting phase</h3>
            <p>Review each player answer to validate awarded points.</p>
            <div className="votes">
              {room.recentRoundResults.map((result) => {
                const mine = result.playerId === playerId;
                return (
                  <article key={result.playerId} className="vote-card">
                    <div className="vote-head">
                      <strong>{result.nickname}</strong>
                      <span>{result.provisionalScore} potential pts</span>
                    </div>
                    <p>{result.answer || "(no answer)"}</p>
                    {mine ? (
                      <em>Your answer</em>
                    ) : (
                      <div className="row">
                        <button onClick={() => submitVote(result.playerId, true)}>Approve</button>
                        <button onClick={() => submitVote(result.playerId, false)}>Reject</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {room.state === "roundResults" && (
          <section className="card panel panel-results fade-in">
            <h3>Results</h3>
            <div key={`reveal-${room.roundIndex}`} className="result-pokemon-reveal">
              <img src={room.currentPokemon?.sprite} alt={room.expectedName || "Pokemon"} loading="lazy" />
              <p className="reveal-name">{room.expectedName}</p>
            </div>
            <ul className="result-list">
              {room.recentRoundResults.map((result) => (
                <li key={result.playerId}>
                  <span className="result-main">{result.nickname}: {result.answer || "(no answer)"}</span>
                  <span className="result-side">
                    <span className="result-accuracy">{result.exact ? "Exact" : `${result.provisionalScore}%`}</span>
                    <strong>+{result.awardedScore}</strong>
                  </span>
                </li>
              ))}
            </ul>
            <div className="panel-actions">
              {isHost ? (
                <button className="primary" onClick={nextRoundNow}>Next</button>
              ) : (
                <p>Waiting for host...</p>
              )}
            </div>
          </section>
        )}

        {room.state === "finalResults" && (
          <section className="card panel fade-in">
            <h3>Final ranking</h3>
            <p className="panel-subtitle">Session complete. Start a new lobby for another run.</p>
            <ol className="leaderboard">
              {room.winners.map((p, index) => (
                <li key={p.id}>
                  <span className="leader-rank">#{index + 1}</span>
                  <span>{p.nickname}</span>
                  <strong>{p.score} pts</strong>
                </li>
              ))}
            </ol>

            {isHost ? (
              <button className="primary" onClick={returnToLobby}>Back to lobby</button>
            ) : (
              <p>Waiting for host...</p>
            )}
          </section>
        )}
      </section>

      {(room.state === "round" || room.state === "voting" || room.state === "roundResults") ? (
        <section className="card timer-banner timer-dock" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(timerFillProgress * 100)}>
          <div className="timer-banner-head">
            <span>{timerLabel}</span>
          </div>
          <div className="timer-track">
            <div className="timer-fill" style={{ width: `${timerFillProgress * 100}%` }} />
          </div>
        </section>
      ) : null}

      {error ? <p className="error fixed-error">{error}</p> : null}
    </main>
  );
}

export default App;
