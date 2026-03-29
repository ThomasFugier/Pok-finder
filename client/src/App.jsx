import { useEffect, useMemo, useRef, useState } from "react";
import { emitAck, socket } from "./socket";
import { useGameStore } from "./store";
import pokemonData from "./data/pokemon151.json";

const AVATARS = [
  "pikachu",
  "bulbasaur",
  "charmander",
  "squirtle",
  "eevee",
  "jigglypuff",
  "meowth",
  "psyduck"
];

const DISPLAY_MODE_LABELS = {
  normal: { en: "Normal", fr: "Normal" },
  whosthat: { en: "Who's that Pokemon mode", fr: "Qui est ce Pokémon?" }
};

const SCORING_MODE_LABELS = {
  exact: "Exact",
  voting: "Voting",
  approx: "Approximation"
};

const ROUND_OPTIONS = [10, 20, 50];
const TIMER_OPTIONS_SEC = [10, 15, 30, 45, 60];
const LANGUAGE_OPTIONS = ["en", "fr"];
const DISPLAY_MODE_OPTIONS = ["normal", "whosthat"];
const SCORING_MODE_OPTIONS = ["exact", "voting", "approx"];
const RESULTS_DURATION_MS = 7000;
const VOTING_DURATION_MS = 12000;
const DEFAULT_SETTINGS = {
  rounds: 10,
  language: "fr",
  displayMode: "normal",
  scoringMode: "approx",
  roundDurationSec: 10
};

const LANGUAGE_LABELS = {
  fr: "Francais",
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
  return { rounds, language, displayMode, scoringMode, roundDurationSec };
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

function avatarTag(value) {
  return (value || "??").slice(0, 2).toUpperCase();
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

function buildAnswerMaskDisplay(template, typedValue) {
  let typedIndex = 0;
  const typedChars = Array.from(typedValue || "");

  return Array.from(template)
    .map((slot) => {
      if (slot !== "_") return slot;
      const nextChar = typedChars[typedIndex];
      typedIndex += 1;
      return nextChar ? nextChar.toUpperCase() : "_";
    })
    .join("");
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

function pickRandomPokemon() {
  return pokemonData[Math.floor(Math.random() * pokemonData.length)];
}

function startLocalRound(room) {
  const players = clonePlayers(room.players).map((p) => ({ ...p, hasSubmitted: false, answer: "" }));
  return {
    ...room,
    state: "round",
    roundIndex: room.roundIndex + 1,
    players,
    currentPokemon: pickRandomPokemon(),
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

function PokemonCanvas({ sprite, hidden }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!sprite || !ref.current) return;
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (hidden) {
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = "#06080f";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = "source-over";
      }
    };
    img.src = sprite;
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
  const [formSettings, setFormSettings] = useState({ ...DEFAULT_SETTINGS });
  const [joinRoomId, setJoinRoomId] = useState("");
  const [answer, setAnswer] = useState("");
  const [serverOnline, setServerOnline] = useState(null);
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
  const timerLabel = room?.state === "round"
    ? `Temps restant ${Math.ceil(timerRemainingMs / 1000)}s`
    : (room?.state === "voting"
      ? `Vote ${Math.ceil(timerRemainingMs / 1000)}s`
      : (room?.state === "roundResults"
        ? `Auto suivant ${Math.ceil(timerRemainingMs / 1000)}s`
        : "Partie terminee"));
  const canEditSettings = !isInLobby || isHost;
  const roomDisplayLabel = room
    ? (DISPLAY_MODE_LABELS[room.settings.displayMode]?.[room.settings.language] || DISPLAY_MODE_LABELS.normal.en)
    : "";
  const roomScoringLabel = room
    ? (SCORING_MODE_LABELS[room.settings.scoringMode] || SCORING_MODE_LABELS.exact)
    : "";
  const roundIndexValue = Math.max(0, ROUND_OPTIONS.indexOf(formSettings.rounds));
  const timerIndexValue = Math.max(0, TIMER_OPTIONS_SEC.indexOf(formSettings.roundDurationSec));
  const answerMaskTemplate = buildAnswerMaskTemplate(getRoundTargetName(room));
  const answerSlotsCount = countAnswerSlots(answerMaskTemplate);
  const answerMaskDisplay = buildAnswerMaskDisplay(answerMaskTemplate, answer);
  const roundProgress = room ? Math.max(0, Math.min(1, room.roundIndex / Math.max(1, room.totalRounds))) : 0;
  const submittedAnswersCount = room?.state === "round"
    ? room.players.filter((p) => p.hasSubmitted).length
    : 0;
  const phaseLabel = room?.state === "round"
    ? "Scan actif"
    : (room?.state === "voting"
      ? "Validation equipe"
      : (room?.state === "roundResults"
        ? "Debrief manche"
        : "Classement final"));

  if (!roomId || !playerId || !room || room.state === "lobby") {
    return (
      <main className="page page-home">
        <section className="party-shell ultra-menu">
          <header className="menu-topbar">
            <div className="brand-block">
              <h1>Pokefinder Party</h1>
            </div>
            <div className="menu-status">
              <span className={serverOnline === false ? "status-pill offline" : "status-pill online"}>
                {serverOnline === false ? "Serveur hors ligne" : "Serveur en ligne"}
              </span>
              {isInLobby ? <p className="room-code">Code actif : {room.id}</p> : null}
            </div>
          </header>

          <div className="menu-tile-grid">
            <section className="menu-tile playopedia">
              <h3>Profil dresseur</h3>
              <label>
                Pseudo
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ton pseudo" />
              </label>
              <div className="avatar-picker-head">
                <span className="label">Avatar</span>
                <span className="avatar-preview">{avatarTag(formAvatar)}</span>
              </div>
              <div className="avatar-grid">
                {AVATARS.map((id) => (
                  <button
                    key={id}
                    className={id === formAvatar ? "avatar active" : "avatar"}
                    onClick={() => setFormAvatar(id)}
                  >
                    {avatarTag(id)}
                  </button>
                ))}
              </div>
            </section>

            <section className="menu-tile crew">
              <h3>Parametres de partie</h3>
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
                  <span className="setting-title">Langue</span>
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
                  <span className="setting-title">Affichage</span>
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
                  <h3>Salon</h3>
                  <div className="salon-actions">
                    <button className="primary big-cta" onClick={createRoom}>Creer un salon</button>
                    <button className="big-cta" onClick={startSoloLocal}>Jouer en solo local</button>
                  </div>
                  <p className="join-label">Tu as deja un code ?</p>
                  <div className="join">
                    <input
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                      placeholder="Code room"
                      maxLength={5}
                    />
                    <button onClick={joinRoom}>Rejoindre</button>
                  </div>
                </div>
              ) : (
                <div className="lobby-stage">
                  <div className="lobby-head">
                    <h3>Room {room.id}</h3>
                    <span>{room.players.length}/8</span>
                  </div>
                  <div className="lobby-summary">
                    <span>{room.settings.rounds} manches</span>
                    <span>{room.settings.roundDurationSec}s / manche</span>
                    <span>{room.settings.language.toUpperCase()}</span>
                  </div>
                  <ul className="lobby-player-list">
                    {room.players
                      .slice()
                      .sort((a, b) => b.score - a.score)
                      .map((p) => (
                        <li key={p.id}>
                          <span className="player-badge">{avatarTag(p.avatar)}</span>
                          <strong>{p.nickname}</strong>
                          <span>{p.isHost ? "Hote" : "Joueur"}</span>
                        </li>
                      ))}
                  </ul>
                  <div className="cta-row">
                    {isHost ? (
                      <button className="primary big-cta" onClick={startGame}>Lancer la partie</button>
                    ) : (
                      <button className="big-cta" disabled>Lancer la partie</button>
                    )}
                    <button onClick={quitRoom}>Quitter</button>
                  </div>
                  {!isHost ? <p className="waiting-text">En attente de l'hote...</p> : null}
                </div>
              )}
            </section>
          </div>

          {serverOnline === false ? (
            <p className="info">Serveur indisponible. Tu peux continuer en solo local.</p>
          ) : null}
          {error ? <p className="error home-error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="page page-room">
      <header className="topbar card">
        <div className="room-head">
          <p className="phase-label">{phaseLabel}</p>
          <h2>Room {room.id}</h2>
          <p>Manche {room.roundIndex}/{room.totalRounds}</p>
          <div
            className="round-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(roundProgress * 100)}
          >
            <div className="round-progress-fill" style={{ width: `${roundProgress * 100}%` }} />
          </div>
          <div className="room-meta-chips">
            <span>{roomDisplayLabel}</span>
            <span>{roomScoringLabel}</span>
            <span>{room.settings.language.toUpperCase()}</span>
            <span>{room.settings.roundDurationSec}s</span>
            {isLocalRoom ? <span>SOLO</span> : null}
          </div>
        </div>
        <div className="hud-actions">
          {room.state === "round" ? (
            <span className="submission-chip">{submittedAnswersCount}/{room.players.length} reponses verrouillees</span>
          ) : null}

          {(room.state === "round" || room.state === "voting" || room.state === "roundResults") ? (
            <div className="timer-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(timerProgress * 100)}>
              <span>{timerLabel}</span>
              <div className="timer-track">
                <div className="timer-fill" style={{ width: `${timerProgress * 100}%` }} />
              </div>
            </div>
          ) : (
            <div className="timer-meter static"><span>{timerLabel}</span></div>
          )}

          {room.state === "roundResults" ? (
            <button className="primary" onClick={nextRoundNow} disabled={!isHost}>
              Suivant
            </button>
          ) : null}

          <button className="quit-btn" onClick={quitRoom}>Quitter</button>
        </div>
      </header>

      <section className="layout">
        <aside className="card players">
          <h3>Escouade ({room.players.length}/8)</h3>
          <ul>
            {room.players
              .slice()
              .sort((a, b) => b.score - a.score)
              .map((p, index) => {
                const statusLabel = !p.connected
                  ? "Hors ligne"
                  : (room.state === "round" && p.hasSubmitted ? "Reponse envoyee" : "En ligne");

                return (
                  <li key={p.id} className={`${!p.connected ? "disconnected" : ""} ${p.id === playerId ? "me" : ""}`.trim()}>
                    <span className="rank">#{index + 1}</span>
                    <span className="player-line">
                      <strong>{p.nickname}</strong>
                      <small>{statusLabel}</small>
                    </span>
                    <span className="player-score">{p.score} pts</span>
                    <span className="player-avatar">{avatarTag(p.avatar)}</span>
                    {p.isHost ? <em>Hote</em> : null}
                  </li>
                );
              })}
          </ul>
        </aside>

        {room.state === "round" && (
          <section className="card panel fade-in">
            <h3>Pokemon mystere</h3>
            <p className="panel-subtitle">
              {room.settings.displayMode === "whosthat"
                ? "Mode silhouette actif : identifie le Pokemon avant la fin du chrono."
                : "Mode normal actif : memorise et valide ta reponse le plus vite possible."}
            </p>
            <PokemonCanvas
              sprite={room.currentPokemon?.sprite}
              hidden={room.settings.displayMode === "whosthat"}
            />
            <p className="panel-hint">
              {me?.hasSubmitted
                ? "Reponse envoyee. Attends la fin du chrono."
                : "Entre ta meilleure proposition avant la fin du timer."}
            </p>

            <div className="answer-row">
              <div className="answer-mask-input">
                <span className="answer-mask-display" aria-hidden="true">{answerMaskDisplay}</span>
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
                  aria-label={room.settings.language === "fr" ? "Nom du Pokemon" : "Pokemon name"}
                />
              </div>
              <button onClick={submitAnswer} disabled={me?.hasSubmitted || !answer.trim()}>
                {me?.hasSubmitted ? "Verrouille" : "Valider"}
              </button>
            </div>
          </section>
        )}

        {room.state === "voting" && (
          <section className="card panel fade-in">
            <h3>Phase de vote</h3>
            <p>Confirme les reponses de chaque joueur pour valider les points accordes.</p>
            <div className="votes">
              {room.recentRoundResults.map((result) => {
                const mine = result.playerId === playerId;
                return (
                  <article key={result.playerId} className="vote-card">
                    <div className="vote-head">
                      <strong>{result.nickname}</strong>
                      <span>{result.provisionalScore} pts potentiels</span>
                    </div>
                    <p>{result.answer || "(aucune reponse)"}</p>
                    {mine ? (
                      <em>Ta reponse</em>
                    ) : (
                      <div className="row">
                        <button onClick={() => submitVote(result.playerId, true)}>Valider</button>
                        <button onClick={() => submitVote(result.playerId, false)}>Refuser</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {room.state === "roundResults" && (
          <section className="card panel fade-in">
            <h3>Debrief manche</h3>
            <p>Reponse cible : {room.expectedName}</p>
            <ul className="result-list">
              {room.recentRoundResults.map((result) => (
                <li key={result.playerId}>
                  <span>{result.nickname}: {result.answer || "(aucune reponse)"}</span>
                  <span className="result-accuracy">{result.exact ? "Exact" : `${result.provisionalScore}%`}</span>
                  <strong>+{result.awardedScore}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}

        {room.state === "finalResults" && (
          <section className="card panel fade-in">
            <h3>Classement final</h3>
            <p className="panel-subtitle">La session est terminee. Relance un lobby pour une nouvelle serie.</p>
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
              <button className="primary" onClick={returnToLobby}>Retour lobby</button>
            ) : (
              <p>En attente de l'hote...</p>
            )}
          </section>
        )}
      </section>

      {error ? <p className="error fixed-error">{error}</p> : null}
      <footer className="card foot">Pokefinder Party - mode salon fun</footer>
    </main>
  );
}

export default App;
