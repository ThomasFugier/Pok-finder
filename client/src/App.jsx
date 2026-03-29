import { useEffect, useMemo, useRef, useState } from "react";
import { PokemonCanvas as PokemonCanvasView } from "./components/PokemonCanvas";
import { AVATARS, getAvatarAsset, pickRandomAvatar as pickRandomAvatarFromList } from "./features/avatars";
import { createFinalConfetti } from "./features/confetti";
import {
  advanceLocalGame as advanceLocalGameState,
  applyLocalVote,
  clonePlayers as cloneRoomPlayers,
  createLocalRoom as createLocalRoomState,
  finishLocalRound as finishLocalRoundState,
  getPokemonPool as getLocalPokemonPool,
  getRoundTargetName,
  resetLocalLobby,
  startLocalRound as startLocalRoundState
} from "./features/localGameEngine";
import {
  clearLocalIdentity as clearStoredIdentity,
  getLocalIdentity as getStoredIdentity,
  getLocalSetupSettings as getStoredSetupSettings,
  setLocalIdentity as setStoredIdentity,
  setLocalSetupSettings as setStoredSetupSettings
} from "./features/localPersistence";
import { useFloatingTooltip } from "./hooks/useFloatingTooltip";
import { useNowTick as useNowTickHook } from "./hooks/useNowTick";
import { FIRST_ROUND_REVEAL_DELAY_MS, useScreenTransition } from "./hooks/useScreenTransition";
import { formatCopy, getUiCopy } from "./i18n/messages";
import { checkServerHealth, emitAck, socket } from "./socket";
import { useGameStore } from "./store";
import {
  buildAnswerMaskTemplate as buildAnswerMaskTemplateShared,
  buildAnswerMaskTokens as buildAnswerMaskTokensShared,
  countAnswerSlots as countAnswerSlotsShared,
  hydrateAnswerFromTemplate as hydrateAnswerFromTemplateShared
} from "@shared/answerUtils.js";
import {
  DEFAULT_SETTINGS as SHARED_DEFAULT_SETTINGS,
  DISPLAY_MODE_OPTIONS as SHARED_DISPLAY_MODE_OPTIONS,
  ENABLED_GENERATIONS as SHARED_ENABLED_GENERATIONS,
  GENERATION_OPTIONS as SHARED_GENERATION_OPTIONS,
  LANGUAGE_OPTIONS as SHARED_LANGUAGE_OPTIONS,
  RESULTS_DURATION_MS,
  ROUND_OPTIONS as SHARED_ROUND_OPTIONS,
  SCORING_MODE_OPTIONS as SHARED_SCORING_MODE_OPTIONS,
  TIMER_OPTIONS_SEC as SHARED_TIMER_OPTIONS_SEC,
  VOTING_DURATION_MS
} from "@shared/gameConstants.js";
import { sanitizeSettings as sanitizeSettingsShared } from "@shared/settings.js";
import { timeLeftMs as timeLeftMsShared } from "@shared/time.js";

const ROUND_OPTIONS = SHARED_ROUND_OPTIONS;
const TIMER_OPTIONS_SEC = SHARED_TIMER_OPTIONS_SEC;
const LANGUAGE_OPTIONS = SHARED_LANGUAGE_OPTIONS;
const DISPLAY_MODE_OPTIONS = SHARED_DISPLAY_MODE_OPTIONS;
const SCORING_MODE_OPTIONS = SHARED_SCORING_MODE_OPTIONS;
const GENERATION_OPTIONS = SHARED_GENERATION_OPTIONS;
const ENABLED_GENERATIONS = SHARED_ENABLED_GENERATIONS;
const DEFAULT_SETTINGS = SHARED_DEFAULT_SETTINGS;

function sanitizeSettings(nextSettings = {}, fallback = DEFAULT_SETTINGS) {
  return sanitizeSettingsShared(nextSettings, fallback);
}

function getLocalIdentity() {
  return getStoredIdentity();
}

function setLocalIdentity(value) {
  setStoredIdentity(value);
}

function clearLocalIdentity() {
  clearStoredIdentity();
}

function getLocalSetupSettings() {
  return getStoredSetupSettings();
}

function setLocalSetupSettings(value) {
  setStoredSetupSettings(value);
}

function timeLeftMs(ts, currentNow) {
  return timeLeftMsShared(ts, currentNow);
}

function clonePlayers(players) {
  return cloneRoomPlayers(players);
}

function pickRandomAvatar(excludeAvatarId) {
  return pickRandomAvatarFromList(excludeAvatarId);
}

function buildAnswerMaskTemplate(targetName) {
  return buildAnswerMaskTemplateShared(targetName);
}

function buildAnswerMaskTokens(template, typedValue) {
  return buildAnswerMaskTokensShared(template, typedValue);
}

function countAnswerSlots(template) {
  return countAnswerSlotsShared(template);
}

function hydrateAnswerFromTemplate(template, typedValue) {
  return hydrateAnswerFromTemplateShared(template, typedValue);
}

function getPokemonPool(selectedGenerations = [1]) {
  return getLocalPokemonPool(selectedGenerations);
}

function startLocalRound(room, { startDelayMs = 0 } = {}) {
  return startLocalRoundState(room, { startDelayMs });
}

function finishLocalRound(room) {
  return finishLocalRoundState(room);
}

function advanceLocalGame(room) {
  return advanceLocalGameState(room);
}

function createLocalRoom({ playerId, nickname, avatar, settings }) {
  return createLocalRoomState({ playerId, nickname, avatar, settings });
}

function useNowTick() {
  return useNowTickHook(300);
}

function PokemonCanvas({ sprite, hidden }) {
  return <PokemonCanvasView sprite={sprite} hidden={hidden} />;
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
  const isMainMenuView = !roomId || !playerId || !room || room.state === "lobby";
  const isRoundStarted = !!(room?.state === "round" && (!room?.roundStartsAt || now >= room.roundStartsAt));
  const uiLanguage = room?.settings?.language || formSettings.language || DEFAULT_SETTINGS.language;
  const copy = useMemo(() => getUiCopy(uiLanguage), [uiLanguage]);
  const floatingTooltip = useFloatingTooltip();
  const { screenTransition, renderedMainMenuView } = useScreenTransition(isMainMenuView);
  const roomClosedMessageRef = useRef(copy.roomClosedByHost);

  useEffect(() => {
    roomClosedMessageRef.current = copy.roomClosedByHost;
  }, [copy.roomClosedByHost]);

  const DISPLAY_MODE_LABELS = useMemo(() => ({
    normal: copy.roomDisplayNormal,
    whosthat: copy.roomDisplayWhosthat
  }), [copy]);
  const LANGUAGE_LABELS = useMemo(() => ({
    fr: copy.languageFrench,
    en: copy.languageEnglish
  }), [copy]);
  const DISPLAY_MODE_PICKER_LABELS = useMemo(() => ({
    normal: copy.displayNormal,
    whosthat: copy.displaySilhouette
  }), [copy]);
  const SCORING_MODE_PICKER_LABELS = useMemo(() => ({
    exact: copy.scoringExact,
    voting: copy.scoringVoting,
    approx: copy.scoringApprox
  }), [copy]);
  const SETTINGS_TOOLTIPS = useMemo(() => ({
    rounds: copy.roundsTooltip,
    language: copy.languageTooltip,
    generations: copy.generationsTooltip,
    displayMode: copy.displayModeTooltip,
    scoring: copy.scoringTooltip,
    timer: copy.timerTooltip
  }), [copy]);
  const LANGUAGE_OPTION_TOOLTIPS = useMemo(() => ({
    en: copy.languageEnglishTooltip,
    fr: copy.languageFrenchTooltip
  }), [copy]);
  const DISPLAY_MODE_OPTION_TOOLTIPS = useMemo(() => ({
    normal: copy.displayNormalTooltip,
    whosthat: copy.displayWhosThatTooltip
  }), [copy]);
  const SCORING_OPTION_TOOLTIPS = useMemo(() => ({
    exact: copy.scoringExactTooltip,
    approx: copy.scoringApproxTooltip,
    voting: copy.scoringVotingTooltip
  }), [copy]);

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
      setError(payload?.reason || roomClosedMessageRef.current);
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
    if (room?.state !== "round" || me?.hasSubmitted || !isRoundStarted) return;
    const focusId = requestAnimationFrame(() => {
      answerInputRef.current?.focus();
      answerInputRef.current?.select();
    });
    return () => cancelAnimationFrame(focusId);
  }, [room?.state, room?.roundIndex, me?.hasSubmitted, isRoundStarted]);

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
      if (!res.ok) setError(res.error || copy.failedToUpdateSettings);
    });
  }

  function startSoloLocal() {
    const cleanName = (formName || copy.playerLabel).slice(0, 20);
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
      setError(copy.serverUnavailable);
      return;
    }

    const cleanName = (formName || copy.playerLabel).slice(0, 20);
    const settings = sanitizeSettings(formSettings, DEFAULT_SETTINGS);
    const previous = getLocalIdentity();
    const res = await emitAck("room:create", {
      nickname: cleanName,
      avatar: formAvatar,
      playerId: previous?.playerId,
      settings
    });
    if (!res.ok) {
      setError(res.error || copy.failedToCreateRoom);
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
    const inviteText = formatCopy(copy.inviteMessage, {
      roomCode,
      joinUrl
    });

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
      setError(copy.failedToCopyInvite);
    }
  }

  async function joinRoom() {
    const cleanName = (formName || copy.playerLabel).slice(0, 20);
    const code = joinRoomId.trim().toUpperCase();
    const previous = getLocalIdentity();
    const res = await emitAck("room:join", {
      roomId: code,
      nickname: cleanName,
      avatar: formAvatar,
      playerId: previous?.playerId
    });
    if (!res.ok) {
      setError(res.error || copy.failedToJoinRoom);
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
        setError(formatCopy(copy.notEnoughPokemon, { rounds: room.settings.rounds }));
        return;
      }
      const players = clonePlayers(room.players).map((p) => ({ ...p, score: 0, isReady: false, hasSubmitted: false, answer: "" }));
      setRoom(startLocalRound({ ...room, players, roundIndex: 0, winners: [], usedPokemonIds: [] }, { startDelayMs: FIRST_ROUND_REVEAL_DELAY_MS }));
      return;
    }

    const connectedPlayers = room.players.filter((p) => p.connected);
    if (!connectedPlayers.every((p) => p.isReady)) {
      setError(copy.allPlayersMustBeReady);
      return;
    }

    const res = await emitAck("game:start", { roomId: room.id, playerId });
    if (!res.ok) setError(res.error || copy.failedToStart);
  }

  async function nextRoundNow() {
    if (!room || room.state !== "roundResults") return;

    if (isLocalRoom) {
      if (!isHost) return;
      setRoom(advanceLocalGame(room));
      return;
    }

    const res = await emitAck("game:nextRound", { roomId: room.id, playerId });
    if (!res.ok) setError(res.error || copy.failedToNextRound);
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
    if (!res.ok) setError(res.error || copy.failedTogglePause);
  }

  async function submitAnswer() {
    if (!room) return;
    if (room.state === "round" && room.roundStartsAt && now < room.roundStartsAt) return;
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
    if (!res.ok) setError(res.error || copy.failedSubmitAnswer);
  }

  async function submitVote(targetPlayerId, accepted) {
    if (!room) return;

    if (isLocalRoom) {
      setRoom(applyLocalVote(room, playerId, targetPlayerId, accepted));
      return;
    }

    const res = await emitAck("vote:submit", {
      roomId: room.id,
      playerId,
      targetPlayerId,
      accepted
    });
    if (!res.ok) setError(res.error || copy.failedSubmitVote);
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
    if (!res.ok) setError(res.error || copy.failedReadyState);
  }

  async function returnToLobby() {
    if (!room) return;

    if (isLocalRoom) {
      setRoom(resetLocalLobby(room));
      return;
    }

    const res = await emitAck("game:returnLobby", { roomId: room.id, playerId });
    if (!res.ok) setError(res.error || copy.failedReturnLobby);
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
      setError(res.error || copy.failedQuitRoom);
      return;
    }

    clearLocalIdentity();
    resetAll();
  }

  const roundMs = room?.state === "round" ? timeLeftMs(room?.roundEndsAt, now) : 0;
  const displayedRoundMs = room?.state === "round"
    ? (isRoundStarted ? roundMs : ((room?.settings?.roundDurationSec || 0) * 1000))
    : 0;
  const phaseMs = room?.state !== "round" ? timeLeftMs(room?.phaseEndsAt, now) : 0;

  const timerTotalMs = room?.state === "round"
    ? (room.settings.roundDurationSec * 1000)
    : (room?.state === "voting" ? VOTING_DURATION_MS : RESULTS_DURATION_MS);
  const liveRemainingMs = room?.state === "round" ? displayedRoundMs : phaseMs;
  const timerRemainingMs = room?.isPaused ? Math.max(0, room?.pausedRemainingMs || 0) : liveRemainingMs;
  const timerProgress = Math.max(0, Math.min(1, timerRemainingMs / Math.max(1, timerTotalMs)));
  const timerFillProgress = 1 - timerProgress;
  const timerLabel = room?.isPaused
    ? copy.timerPaused
    : (!isRoundStarted && room?.state === "round" ? copy.timerReady : `${Math.ceil(timerRemainingMs / 1000)}`);
  const canEditSettings = !isInLobby || isHost;
  const roomDisplayLabel = room
    ? (DISPLAY_MODE_LABELS[room.settings.displayMode] || DISPLAY_MODE_LABELS.normal)
    : "";
  const roomGenerationsLabel = room
    ? formatCopy(copy.generationSummary, {
      value: [...(room.settings.generations || [1])].sort((a, b) => a - b).join(", ")
    })
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
    ? copy.timerNext
    : (room?.isPaused ? copy.timerResume : copy.timerPause);
  const confettiPieces = useMemo(() => {
    if (room?.state !== "finalResults") return null;

    return createFinalConfetti();
  }, [room?.state, room?.id, room?.roundIndex]);

  const transitionOverlay = screenTransition.visible ? (
    <div
      className={`screen-transition-overlay ${screenTransition.phase} ${screenTransition.toGame ? "to-game" : "to-menu"}`.trim()}
      aria-hidden="true"
    >
      <div className="screen-transition-card">
        <p className="screen-transition-kicker">{copy.transitionKicker}</p>
        <h2>{screenTransition.toGame ? copy.transitionToGameTitle : copy.transitionToMenuTitle}</h2>
        <p>{screenTransition.toGame ? copy.transitionToGameText : copy.transitionToMenuText}</p>
      </div>
    </div>
  ) : null;

  const floatingTooltipNode = floatingTooltip ? (
    <div
      className="global-tooltip"
      style={{
        left: `${floatingTooltip.x}px`,
        top: `${floatingTooltip.y}px`
      }}
      role="tooltip"
      aria-hidden="true"
    >
      {floatingTooltip.text}
    </div>
  ) : null;

  if (!renderedMainMenuView && (!roomId || !playerId || !room)) {
    return (
      <main className="page page-home">
        {transitionOverlay}
        {floatingTooltipNode}
      </main>
    );
  }

  if (renderedMainMenuView && screenTransition.visible && screenTransition.toGame) {
    return (
      <main className="page page-home">
        {transitionOverlay}
        {floatingTooltipNode}
      </main>
    );
  }

  if (renderedMainMenuView) {
    return (
      <main className="page page-home">
        <section className="party-shell ultra-menu">
          <header className="menu-topbar">
            <div className="brand-block">
              <h1>{copy.gameTitle}</h1>
            </div>
            <div className="menu-status">
              <span className={serverOnline ? "status-pill online" : "status-pill offline"}>
                <span className={serverOnline ? "network-icon online" : "network-icon offline"} aria-hidden="true" />
                <span>{serverOnline ? copy.serverOnline : copy.serverOffline}</span>
                {serverChecking ? <span className="status-spinner" aria-hidden="true" /> : null}
              </span>
              {isInLobby ? <p className="room-code">{formatCopy(copy.activeCode, { roomId: room.id })}</p> : null}
            </div>
          </header>

          <div className="menu-tile-grid">
            <section className="menu-tile playopedia">
              <h3>{copy.trainerProfile}</h3>
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
                      aria-label={copy.changeAvatar}
                      title={copy.changeAvatar}
                    >
                      <span aria-hidden="true">⇄</span>
                    </button>
                  </div>
                </div>
                <label className="profile-name-field">
                  {copy.whatIsYourName}
                  <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={copy.nicknamePlaceholder} />
                </label>
              </div>
            </section>

            <section className="menu-tile crew">
              <h3>{copy.gameSettings}</h3>
              <div className="settings">
                <div className="setting-block range-setting">
                  <div className="setting-head">
                    <span className="has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.rounds}>{copy.rounds}</span>
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
                      <span
                        key={value}
                        className={`${value === formSettings.rounds ? "active" : ""} has-tooltip`.trim()}
                        data-tooltip={formatCopy(copy.roundsCountLabel, { value })}
                      >
                        {value}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="setting-block">
                  <span className="setting-title has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.language}>{copy.language}</span>
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
                  <span className="setting-title has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.generations}>{copy.generation}</span>
                  <div className="toggle-group generations">
                    {GENERATION_OPTIONS.map((value) => {
                      const isSelected = formSettings.generations.includes(value);
                      const isEnabled = ENABLED_GENERATIONS.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          className={`${isSelected ? "toggle-pill active" : "toggle-pill"} has-tooltip`.trim()}
                          data-tooltip={formatCopy(copy.includeGenerationTooltip, { value })}
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
                  <span className="setting-title has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.displayMode}>{copy.displayMode}</span>
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
                  <span className="setting-title has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.scoring}>{copy.scoring}</span>
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
                    <span className="has-tooltip" data-tooltip={SETTINGS_TOOLTIPS.timer}>{copy.timer}</span>
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
                        data-tooltip={formatCopy(copy.timerPerRoundLabel, { value })}
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
                  <h3>{copy.lobbyTitle}</h3>
                  <div className="salon-actions">
                    <button className="primary big-cta" onClick={createRoom} disabled={!serverOnline}>{copy.createLobby}</button>
                    <button className="big-cta" onClick={startSoloLocal}>{copy.playLocalSolo}</button>
                  </div>
                  <p className="join-label">{copy.alreadyHaveRoomCode}</p>
                  <div className="join">
                    <input
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                      placeholder={copy.roomCodePlaceholder}
                      maxLength={5}
                    />
                      <button onClick={joinRoom}>{copy.join}</button>
                  </div>
                </div>
              ) : (
                <div className="lobby-stage">
                  <div className="lobby-head">
                    <h3>{formatCopy(copy.roomLabel, { roomId: room.id })}</h3>
                    <span>{room.players.length}/8</span>
                  </div>
                  <div className="lobby-summary">
                    <span>{formatCopy(copy.roundsSummary, { value: room.settings.rounds })}</span>
                    <span>{formatCopy(copy.timerSummary, { value: room.settings.roundDurationSec })}</span>
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
                            {isLocalRoom ? (p.isHost ? copy.hostLabel : copy.playerLabel) : (p.isReady ? copy.ready : copy.notReady)}
                          </span>
                        </li>
                      ))}
                  </ul>
                  <div className="cta-row lobby-actions">
                    {!isLocalRoom ? (
                      <button className={me?.isReady ? "primary" : ""} onClick={toggleReadyState}>
                        {me?.isReady ? copy.unready : copy.ready}
                      </button>
                    ) : null}
                    <button onClick={quitRoom}>{copy.leave}</button>
                    {room.id !== "LOCAL" ? (
                      <button className="share-btn" onClick={() => copyRoomInvite(room.id)}>{copy.copyRoomLink}</button>
                    ) : null}
                    {isHost ? (
                      <button className="primary big-cta" onClick={startGame} disabled={!isLocalRoom && !allConnectedReady}>{copy.startGame}</button>
                    ) : (
                      <button className="big-cta" disabled>{copy.startGame}</button>
                    )}
                  </div>
                  {!isLocalRoom ? <p className="waiting-text">{formatCopy(copy.readyPlayers, { ready: readyPlayersCount, connected: connectedPlayersCount })}</p> : null}
                  {inviteCopied ? <p className="waiting-text">{copy.inviteCopied}</p> : null}
                  {!isHost ? <p className="waiting-text">{copy.waitingForHost}</p> : null}
                </div>
              )}
            </section>
          </div>

          {error ? <p className="error home-error">{error}</p> : null}
        </section>
        {transitionOverlay}
        {floatingTooltipNode}
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
        <button className="quit-btn" onClick={quitRoom}>{copy.leave}</button>
        {room.state !== "finalResults" ? (
          <div className="top-salon">
            <h3>{formatCopy(copy.roomSmall, { players: room.players.length })}</h3>
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
                  <span className="player-score">{formatCopy(copy.pointsShort, { value: p.score })}</span>
                  {p.isHost ? <span className="host-chip">{copy.hostLabel}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : <div className="top-salon spacer" />}
        <div className="topbar-right">
          {room.id !== "LOCAL" ? (
            <button className="share-btn" onClick={() => copyRoomInvite(room.id)}>{copy.copyRoomLink}</button>
          ) : null}
          {inviteCopied ? <span className="copied-pill">{copy.copied}</span> : null}
          <div className="round-counter">{room.roundIndex}/{room.totalRounds}</div>
        </div>
      </header>

      <section className="layout">
        {room.state === "round" && (
          <section className="panel panel-round fade-in">
            <div className="round-focus-zone">
              <h3>{copy.whosThatPokemon}</h3>
              <div className="pokemon-stage">
                <PokemonCanvas
                  sprite={isRoundStarted ? room.currentPokemon?.sprite : null}
                  hidden={room.settings.displayMode === "whosthat"}
                />
              </div>
              <p className="panel-hint">
                {isRoundStarted ? copy.typeBestGuess : copy.getReadyRound}
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
                    disabled={me?.hasSubmitted || !isRoundStarted}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitAnswer();
                    }}
                    aria-label={copy.pokemonNameAria}
                  />
                </div>
                <button onClick={submitAnswer} disabled={me?.hasSubmitted || !answer.trim() || !isRoundStarted}>
                  {copy.submit}
                </button>
              </div>
            </div>
          </section>
        )}

        {room.state === "voting" && (
          <section className="card panel fade-in">
            <h3>{copy.votingPhase}</h3>
            <p>{copy.votingSubtitle}</p>
            <div className="votes">
              {room.recentRoundResults.map((result) => {
                const mine = result.playerId === playerId;
                const targetVotes = room.votes?.[result.playerId] || {};
                const eligibleVoters = room.players.filter((p) => p.id !== result.playerId && p.connected);
                return (
                  <article key={result.playerId} className="vote-card">
                    <div className="vote-head">
                      <strong>{result.nickname}</strong>
                      <span>{formatCopy(copy.potentialPoints, { value: result.provisionalScore })}</span>
                    </div>
                    <p>{result.answer || copy.noAnswer}</p>
                    {mine ? (
                      <em>{copy.yourAnswer}</em>
                    ) : (
                      <div className="row">
                        <button onClick={() => submitVote(result.playerId, true)}>{copy.approve}</button>
                        <button onClick={() => submitVote(result.playerId, false)}>{copy.reject}</button>
                      </div>
                    )}
                    <div className="vote-state-grid">
                      {eligibleVoters.map((voter) => {
                        const vote = targetVotes[voter.id];
                        const stateLabel = vote === true ? copy.voteYes : (vote === false ? copy.voteNo : copy.votePending);
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
            <h3>{copy.answerTitle}</h3>
            <div key={`reveal-${room.roundIndex}`} className="result-pokemon-reveal">
              <img src={room.currentPokemon?.sprite} alt={room.expectedName || copy.revealPokemonAlt} loading="lazy" />
              <p className="reveal-name">{room.expectedName}</p>
            </div>
            <div className="result-table-card">
              <ul className="result-list">
                {room.recentRoundResults.map((result) => (
                  <li key={result.playerId}>
                    <span className="result-main">{result.nickname}: {result.answer || copy.noAnswer}</span>
                    <span className="result-side">
                      <span className="result-accuracy">{result.exact ? copy.exact : `${result.provisionalScore}%`}</span>
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
              <h3>{copy.hallOfFame}</h3>
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
                  <strong>{formatCopy(copy.pointsShort, { value: p.score })}</strong>
                </li>
              ))}
            </ol>

            <div className="final-footer">
              <p className="panel-subtitle final-note">{copy.finalSessionComplete}</p>
              {isHost ? (
                <button className="primary" onClick={returnToLobby}>{copy.backToLobby}</button>
              ) : (
                <p>{copy.waitingForHost}</p>
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
              room.state === "roundResults" ? <span className="timer-action-note">{copy.timerWaitingHost}</span> : null
            )}
          </div>
        </section>
      ) : null}

      {error ? <p className="error fixed-error">{error}</p> : null}
      {transitionOverlay}
      {floatingTooltipNode}
    </main>
  );
}

export default App;
