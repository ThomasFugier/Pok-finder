import { useEffect, useMemo, useRef, useState } from "react";
import { checkServerHealth, emitAck, socket } from "./socket";
import { useGameStore } from "./store";
import pokemonData from "./data/pokemon_all.json";

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
  normal: "Normal",
  whosthat: "Who's that Pokemon mode"
};

const ROUND_OPTIONS = [10, 20, 50];
const TIMER_OPTIONS_SEC = [10, 15, 30, 45, 60];
const LANGUAGE_OPTIONS = ["en", "fr"];
const DISPLAY_MODE_OPTIONS = ["normal", "whosthat"];
const SCORING_MODE_OPTIONS = ["exact", "voting", "approx"];
const GENERATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ENABLED_GENERATIONS = [...GENERATION_OPTIONS];
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
  normal: "Normal",
  whosthat: "Silhouette"
};

const SCORING_MODE_PICKER_LABELS = {
  exact: "Exact",
  voting: "Voting",
  approx: "Approx"
};

const SETTINGS_TOOLTIPS = {
  rounds: "How many Pokemon rounds will be played in this match.",
  language: "Language used for Pokemon names during gameplay.",
  generations: "Choose which Pokemon generations are included in the match.",
  displayMode: "Normal shows the Pokemon directly. Silhouette hides its colors.",
  scoring: "Exact: all-or-nothing, Approx: typo-tolerant, Voting: players validate answers.",
  timer: "Time available to submit your answer each round."
};

const LANGUAGE_OPTION_TOOLTIPS = {
  en: "Pokemon names will be expected in English.",
  fr: "Pokemon names will be expected in French."
};

const DISPLAY_MODE_OPTION_TOOLTIPS = {
  normal: "Pokemon appears in full color immediately.",
  whosthat: "Pokemon appears as a silhouette first, like the anime reveal."
};

const SCORING_OPTION_TOOLTIPS = {
  exact: "Only exact spelling gets points.",
  approx: "Close spelling gives partial points.",
  voting: "Players vote to validate each answer before points are awarded."
};

const CONFETTI_COLORS = ["#ffd166", "#ff5d8f", "#39d98a", "#45b5ff", "#f59e0b", "#22c55e", "#f43f5e", "#d946ef"];

function randomConfettiPiece(idPrefix, index, { burst = false } = {}) {
  const size = 6 + Math.random() * 10;
  const left = `${Math.random() * 100}%`;
  const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
  const drift = `${(Math.random() * 120) - 60}px`;
  const spin = `${(Math.random() * 900) + 520}deg`;
  const delay = burst ? `${Math.random() * 0.16}s` : `${Math.random() * 5.8}s`;
  const duration = burst ? `${1.9 + Math.random() * 1.3}s` : `${5.8 + Math.random() * 4.5}s`;
  const shapeRoll = Math.random();
  const shape = shapeRoll < 0.7 ? "rect" : (shapeRoll < 0.9 ? "ribbon" : "dot");

  return {
    id: `${idPrefix}-${index}`,
    shape,
    burst,
    style: {
      "--left": left,
      "--size": `${size}px`,
      "--color": color,
      "--drift": drift,
      "--spin": spin,
      "--delay": delay,
      "--duration": duration
    }
  };
}

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

function getPokemonPool(selectedGenerations = [1]) {
  const pool = pokemonData.filter((pokemon) => selectedGenerations.includes(getPokemonGeneration(pokemon.id)));
  return pool.length ? pool : pokemonData;
}

function pickRandomPokemon(selectedGenerations = [1], usedPokemonIds = []) {
  const pool = getPokemonPool(selectedGenerations);
  const usedSet = new Set(usedPokemonIds);
  const available = pool.filter((pokemon) => !usedSet.has(pokemon.id));
  const source = available.length ? available : pool;
  return source[Math.floor(Math.random() * source.length)];
}

function startLocalRound(room) {
  const players = clonePlayers(room.players).map((p) => ({ ...p, hasSubmitted: false, answer: "" }));
  const pickedPokemon = pickRandomPokemon(room.settings.generations, room.usedPokemonIds || []);
  const nextUsedPokemonIds = [...(room.usedPokemonIds || []), pickedPokemon.id];
  return {
    ...room,
    state: "round",
    roundIndex: room.roundIndex + 1,
    players,
    currentPokemon: pickedPokemon,
    usedPokemonIds: nextUsedPokemonIds,
    roundEndsAt: Date.now() + (room.settings.roundDurationSec * 1000),
    phaseEndsAt: null,
    isPaused: false,
    pausedRemainingMs: 0,
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
    isPaused: false,
    pausedRemainingMs: 0,
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
      isPaused: false,
      pausedRemainingMs: 0,
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
    if (room.isPaused) return;
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
    if (room?.state !== "roundResults" || !isHost) return;

    const onKeyDown = (event) => {
      if (event.key !== "Enter") return;
      if (event.repeat) return;
      const targetTag = event.target?.tagName?.toLowerCase();
      if (targetTag === "input" || targetTag === "textarea") return;
      if (event.target?.isContentEditable) return;
      event.preventDefault();
      nextRoundNow();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [room?.state, isHost, nextRoundNow]);

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
    const inviteText = `Come play with me on Poké Party Quiz!\nRoom code: ${roomCode}\n${joinUrl}`;

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
      const poolSize = getPokemonPool(room.settings.generations).length;
      if (room.settings.rounds > poolSize) {
        setError(`Not enough unique Pokemon for ${room.settings.rounds} rounds with current generations`);
        return;
      }
      const players = clonePlayers(room.players).map((p) => ({ ...p, score: 0, isReady: false, hasSubmitted: false, answer: "" }));
      setRoom(startLocalRound({ ...room, players, roundIndex: 0, winners: [], usedPokemonIds: [] }));
      return;
    }

    const connectedPlayers = room.players.filter((p) => p.connected);
    if (!connectedPlayers.every((p) => p.isReady)) {
      setError("All players must be ready");
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

  async function togglePauseGame() {
    if (!room || !isHost) return;
    if (!["round", "voting", "roundResults"].includes(room.state)) return;

    if (isLocalRoom) {
      if (!room.isPaused) {
        const remainingMs = room.state === "round"
          ? Math.max(0, (room.roundEndsAt || Date.now()) - Date.now())
          : Math.max(0, (room.phaseEndsAt || Date.now()) - Date.now());
        setRoom({
          ...room,
          isPaused: true,
          pausedRemainingMs: remainingMs,
          roundEndsAt: room.state === "round" ? null : room.roundEndsAt,
          phaseEndsAt: room.state !== "round" ? null : room.phaseEndsAt
        });
        return;
      }

      const remainingMs = Math.max(0, room.pausedRemainingMs || 0);
      setRoom({
        ...room,
        isPaused: false,
        pausedRemainingMs: 0,
        roundEndsAt: room.state === "round" ? Date.now() + remainingMs : room.roundEndsAt,
        phaseEndsAt: room.state !== "round" ? Date.now() + remainingMs : room.phaseEndsAt
      });
      return;
    }

    const res = await emitAck("game:togglePause", {
      roomId: room.id,
      playerId
    });
    if (!res.ok) setError(res.error || "Failed to toggle pause");
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
      const nextVotes = {
        ...(room.votes || {}),
        [targetPlayerId]: {
          ...((room.votes || {})[targetPlayerId] || {}),
          [playerId]: accepted
        }
      };
      const nextPlayers = clonePlayers(room.players).map((p) => {
        const result = nextResults.find((r) => r.playerId === p.id);
        if (!result) return p;
        return { ...p, score: result.awardedScore };
      });
      setRoom({ ...room, recentRoundResults: nextResults, votes: nextVotes, players: nextPlayers });
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

  async function toggleReadyState() {
    if (!room || !playerId || room.state !== "lobby") return;
    const mePlayer = room.players.find((p) => p.id === playerId);
    const nextReady = !mePlayer?.isReady;

    if (isLocalRoom) {
      const players = clonePlayers(room.players).map((p) => (
        p.id === playerId ? { ...p, isReady: nextReady } : p
      ));
      setRoom({ ...room, players });
      return;
    }

    const res = await emitAck("room:setReady", {
      roomId: room.id,
      playerId,
      isReady: nextReady
    });
    if (!res.ok) setError(res.error || "Failed to update ready state");
  }

  async function returnToLobby() {
    if (!room) return;

    if (isLocalRoom) {
      const players = clonePlayers(room.players).map((p) => ({ ...p, score: 0, isReady: false, hasSubmitted: false, answer: "" }));
      setRoom({
        ...room,
        state: "lobby",
        roundIndex: 0,
        totalRounds: room.settings.rounds,
        currentPokemon: null,
        roundEndsAt: null,
        phaseEndsAt: null,
        isPaused: false,
        pausedRemainingMs: 0,
        expectedName: null,
        recentRoundResults: [],
        winners: [],
        usedPokemonIds: [],
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
  const liveRemainingMs = room?.state === "round" ? roundMs : phaseMs;
  const timerRemainingMs = room?.isPaused ? Math.max(0, room?.pausedRemainingMs || 0) : liveRemainingMs;
  const timerProgress = Math.max(0, Math.min(1, timerRemainingMs / Math.max(1, timerTotalMs)));
  const timerFillProgress = 1 - timerProgress;
  const timerLabel = room?.isPaused ? "PAUSED" : `${Math.ceil(timerRemainingMs / 1000)}`;
  const canEditSettings = !isInLobby || isHost;
  const roomDisplayLabel = room
    ? (DISPLAY_MODE_LABELS[room.settings.displayMode] || DISPLAY_MODE_LABELS.normal)
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
  const readyPlayersCount = room ? room.players.filter((p) => p.isReady && p.connected).length : 0;
  const connectedPlayersCount = room ? room.players.filter((p) => p.connected).length : 0;
  const allConnectedReady = room ? connectedPlayersCount > 0 && readyPlayersCount === connectedPlayersCount : false;
  const canPauseGame = !!(room && isHost && ["round", "voting", "roundResults"].includes(room.state));
  const isTimerVisible = !!room && (room.state === "round" || room.state === "voting" || room.state === "roundResults");
  const timerActionLabel = room?.state === "roundResults"
    ? "Next"
    : (room?.isPaused ? "Resume" : "Pause");
  const confettiPieces = useMemo(() => {
    if (room?.state !== "finalResults") return null;

    const backFlow = Array.from({ length: 92 }, (_, i) => randomConfettiPiece("back-flow", i));
    const frontFlow = Array.from({ length: 36 }, (_, i) => randomConfettiPiece("front-flow", i));

    return { backFlow, frontFlow };
  }, [room?.state, room?.id, room?.roundIndex]);

  if (!roomId || !playerId || !room || room.state === "lobby") {
    return (
      <main className="page page-home">
        <section className="party-shell ultra-menu">
          <header className="menu-topbar">
            <div className="brand-block">
              <h1>Poké Party Quiz</h1>
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
                    <span className="has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.rounds}>Rounds</span>
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
                      <span key={value} className={`${value === formSettings.rounds ? "active" : ""} has-tooltip`.trim()} data-tooltip={`${value} rounds`}>
                        {value}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="setting-block">
                  <span className="setting-title has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.language}>Language</span>
                  <div className="toggle-group">
                    {LANGUAGE_OPTIONS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`${value === formSettings.language ? "toggle-pill active" : "toggle-pill"} has-tooltip`.trim()}
                        data-tooltip={LANGUAGE_OPTION_TOOLTIPS[value]}
                        onClick={() => applyMenuSettings({ language: value })}
                        disabled={!canEditSettings}
                      >
                        {LANGUAGE_LABELS[value]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-block">
                  <span className="setting-title has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.generations}>Generation</span>
                  <div className="toggle-group generations">
                    {GENERATION_OPTIONS.map((value) => {
                      const isSelected = formSettings.generations.includes(value);
                      const isEnabled = ENABLED_GENERATIONS.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          className={`${isSelected ? "toggle-pill active" : "toggle-pill"} has-tooltip`.trim()}
                          data-tooltip={`Include Pokemon from Generation ${value}.`}
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
                </div>

                <div className="setting-block">
                  <span className="setting-title has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.displayMode}>Display mode</span>
                  <div className="toggle-group">
                    {DISPLAY_MODE_OPTIONS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`${value === formSettings.displayMode ? "toggle-pill active" : "toggle-pill"} has-tooltip`.trim()}
                        data-tooltip={DISPLAY_MODE_OPTION_TOOLTIPS[value]}
                        onClick={() => applyMenuSettings({ displayMode: value })}
                        disabled={!canEditSettings}
                      >
                        {DISPLAY_MODE_PICKER_LABELS[value] || value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-block">
                  <span className="setting-title has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.scoring}>Scoring</span>
                  <div className="toggle-group three">
                    {SCORING_MODE_OPTIONS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`${value === formSettings.scoringMode ? "toggle-pill active" : "toggle-pill"} has-tooltip`.trim()}
                        data-tooltip={SCORING_OPTION_TOOLTIPS[value]}
                        onClick={() => applyMenuSettings({ scoringMode: value })}
                        disabled={!canEditSettings}
                      >
                        {SCORING_MODE_PICKER_LABELS[value] || value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-block range-setting">
                  <div className="setting-head">
                    <span className="has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.timer}>Timer</span>
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
                      <span
                        key={value}
                        className={`${value === formSettings.roundDurationSec ? "active" : ""} has-tooltip`.trim()}
                        data-tooltip={`${value} seconds per round`}
                      >
                        {value}s
                      </span>
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
                        <li key={p.id} className={p.isReady ? "ready" : "not-ready"}>
                          <span className="player-badge">
                            <img
                              className="avatar-image"
                              src={getAvatarAsset(p.avatar).image}
                              alt={getAvatarAsset(p.avatar).label}
                              loading="lazy"
                            />
                          </span>
                          <strong>{p.nickname}</strong>
                          <span className={p.isReady ? "ready-pill" : "not-ready-pill"}>
                            {isLocalRoom ? (p.isHost ? "Host" : "Player") : (p.isReady ? "Ready" : "Not ready")}
                          </span>
                        </li>
                      ))}
                  </ul>
                  <div className="cta-row lobby-actions">
                    {!isLocalRoom ? (
                      <button className={me?.isReady ? "primary" : ""} onClick={toggleReadyState}>
                        {me?.isReady ? "Unready" : "Ready"}
                      </button>
                    ) : null}
                    <button onClick={quitRoom}>Leave</button>
                    {room.id !== "LOCAL" ? (
                      <button className="share-btn" onClick={() => copyRoomInvite(room.id)}>Copy room link</button>
                    ) : null}
                    {isHost ? (
                      <button className="primary big-cta" onClick={startGame} disabled={!isLocalRoom && !allConnectedReady}>Start game</button>
                    ) : (
                      <button className="big-cta" disabled>Start game</button>
                    )}
                  </div>
                  {!isLocalRoom ? <p className="waiting-text">Ready players: {readyPlayersCount}/{connectedPlayersCount}</p> : null}
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
      className={`page page-room ${room.state === "round" ? "round-active-screen" : ""} ${room.state === "roundResults" ? "results-screen" : ""} ${room.state === "finalResults" ? "final-screen" : ""}`.trim()}
    >
      {room.state === "finalResults" && confettiPieces ? (
        <>
          <div className="confetti-layer confetti-back" aria-hidden="true">
            {confettiPieces.backFlow.map((piece) => (
              <span key={piece.id} className={`confetti-piece ${piece.shape} flow`} style={piece.style} />
            ))}
          </div>
          <div className="confetti-layer confetti-front" aria-hidden="true">
            {confettiPieces.frontFlow.map((piece) => (
              <span key={piece.id} className={`confetti-piece ${piece.shape} flow`} style={piece.style} />
            ))}
          </div>
        </>
      ) : null}

      <header className="topbar card">
        <button className="quit-btn" onClick={quitRoom}>Leave</button>
        {room.state !== "finalResults" ? (
          <div className="top-salon">
            <h3>Room ({room.players.length}/8)</h3>
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
                const targetVotes = room.votes?.[result.playerId] || {};
                const eligibleVoters = room.players.filter((p) => p.id !== result.playerId && p.connected);
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
                    <div className="vote-state-grid">
                      {eligibleVoters.map((voter) => {
                        const vote = targetVotes[voter.id];
                        const stateLabel = vote === true ? "YES" : (vote === false ? "NO" : "PENDING");
                        const stateClass = vote === true ? "yes" : (vote === false ? "no" : "pending");
                        return (
                          <span key={`${result.playerId}-${voter.id}`} className={`vote-state-chip ${stateClass}`}>
                            {voter.nickname}: {stateLabel}
                          </span>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {room.state === "roundResults" && (
          <section className="card panel panel-results fade-in">
            <h3>Answer</h3>
            <div key={`reveal-${room.roundIndex}`} className="result-pokemon-reveal">
              <img src={room.currentPokemon?.sprite} alt={room.expectedName || "Pokemon"} loading="lazy" />
              <p className="reveal-name">{room.expectedName}</p>
            </div>
            <div className="result-table-card">
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
            </div>
          </section>
        )}

        {room.state === "finalResults" && (
          <section className="card panel panel-final fade-in">
            <div className="final-title-wrap">
              <h3>Hall Of Fame</h3>
            </div>
            <ol className="leaderboard">
              {room.winners.map((p, index) => (
                <li
                  key={p.id}
                  className={index === 0 ? "top-1" : (index === 1 ? "top-2" : (index === 2 ? "top-3" : ""))}
                  style={{ "--rank-index": index }}
                >
                  <span className="leader-rank">#{index + 1}</span>
                  <span className={index === 0 ? "leader-name winner" : "leader-name"}>
                    {index === 0 ? <span className="winner-crown" aria-hidden="true">👑</span> : null}
                    <span>{p.nickname}</span>
                  </span>
                  <strong>{p.score} pts</strong>
                </li>
              ))}
            </ol>

            <div className="final-footer">
              <p className="panel-subtitle final-note">Session complete. Start a new lobby for another run.</p>
              {isHost ? (
                <button className="primary" onClick={returnToLobby}>Back to lobby</button>
              ) : (
                <p>Waiting for host...</p>
              )}
            </div>
          </section>
        )}
      </section>

      {isTimerVisible ? (
        <section className="card timer-banner timer-dock" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(timerFillProgress * 100)}>
          <div className="timer-row">
            <div className="timer-main">
              <div className="timer-banner-head">
                <span>{timerLabel}</span>
              </div>
              <div className="timer-track">
                <div className="timer-fill" style={{ width: `${timerFillProgress * 100}%` }} />
              </div>
            </div>
            {canPauseGame ? (
              <button
                className="pause-btn timer-action-btn"
                onClick={room.state === "roundResults" ? nextRoundNow : togglePauseGame}
              >
                {timerActionLabel}
              </button>
            ) : (
              room.state === "roundResults" ? <span className="timer-action-note">Waiting for host...</span> : null
            )}
          </div>
        </section>
      ) : null}

      {error ? <p className="error fixed-error">{error}</p> : null}
    </main>
  );
}

export default App;
