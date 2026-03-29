import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../src/gameEngine.js";
import { DEFAULT_SETTINGS } from "../src/config.js";

function createMockIo() {
  const emissions = [];
  return {
    emissions,
    to(socketId) {
      return {
        emit(event, payload) {
          emissions.push({ socketId, event, payload });
        }
      };
    }
  };
}

function createRoomWithHost(engine, overrides = {}) {
  const created = engine.createRoom({
    nickname: overrides.nickname || "Host",
    avatar: overrides.avatar || "red",
    preferredPlayerId: overrides.preferredPlayerId || null,
    socketId: overrides.socketId || "socket_host",
    initialSettings: overrides.initialSettings || {}
  });

  return {
    room: created.room,
    hostId: created.playerId
  };
}

test("createRoom sanitizes invalid settings via shared rules", (t) => {
  const io = createMockIo();
  const engine = new GameEngine(io);
  const { room } = createRoomWithHost(engine, {
    initialSettings: {
      rounds: 999,
      language: "de",
      displayMode: "mystery",
      scoringMode: "chaos",
      roundDurationSec: 999,
      generations: [42]
    }
  });
  t.after(() => {
    engine.clearRoomTimers(room);
  });

  assert.deepEqual(room.settings, DEFAULT_SETTINGS);
});

test("startGame requires all connected players ready", (t) => {
  const io = createMockIo();
  const engine = new GameEngine(io);
  const { room, hostId } = createRoomWithHost(engine);
  t.after(() => {
    engine.clearRoomTimers(room);
  });

  const joined = engine.joinRoom({
    roomId: room.id,
    nickname: "Guest",
    avatar: "misty",
    preferredPlayerId: null,
    socketId: "socket_guest"
  });

  assert.equal(joined.error, undefined);

  const failStart = engine.startGame(room.id, hostId);
  assert.equal(failStart.error, "All players must be ready");

  const guestId = joined.playerId;
  engine.setReadyState(room.id, hostId, true);
  engine.setReadyState(room.id, guestId, true);

  const okStart = engine.startGame(room.id, hostId);
  assert.equal(okStart.error, undefined);
  assert.equal(room.state, "round");
});

test("voting mode awards points after approvals", (t) => {
  const io = createMockIo();
  const engine = new GameEngine(io);
  const { room, hostId } = createRoomWithHost(engine, {
    initialSettings: {
      scoringMode: "voting",
      rounds: 10,
      language: "en",
      displayMode: "normal",
      roundDurationSec: 30,
      generations: [1]
    }
  });
  t.after(() => {
    engine.clearRoomTimers(room);
  });

  const joined = engine.joinRoom({
    roomId: room.id,
    nickname: "Guest",
    avatar: "misty",
    preferredPlayerId: null,
    socketId: "socket_guest"
  });
  const guestId = joined.playerId;

  engine.setReadyState(room.id, hostId, true);
  engine.setReadyState(room.id, guestId, true);

  const started = engine.startGame(room.id, hostId);
  assert.equal(started.error, undefined);
  assert.equal(room.state, "round");

  room.roundStartsAt = Date.now() - 1;

  const expected = room.settings.language === "fr"
    ? room.currentPokemon.fr
    : room.currentPokemon.en;

  const hostSubmit = engine.submitAnswer({
    roomId: room.id,
    playerId: hostId,
    answer: expected
  });
  assert.equal(hostSubmit.error, undefined);

  const guestSubmit = engine.submitAnswer({
    roomId: room.id,
    playerId: guestId,
    answer: expected
  });
  assert.equal(guestSubmit.error, undefined);

  assert.equal(room.state, "voting");

  const hostVote = engine.submitVote({
    roomId: room.id,
    voterId: hostId,
    targetPlayerId: guestId,
    accepted: true
  });
  assert.equal(hostVote.error, undefined);

  const guestVote = engine.submitVote({
    roomId: room.id,
    voterId: guestId,
    targetPlayerId: hostId,
    accepted: true
  });
  assert.equal(guestVote.error, undefined);

  assert.equal(room.state, "roundResults");

  const hostPlayer = room.players.find((player) => player.id === hostId);
  const guestPlayer = room.players.find((player) => player.id === guestId);
  assert.equal(hostPlayer.score, 100);
  assert.equal(guestPlayer.score, 100);
});

test("engine does not create periodic setInterval ticker", (t) => {
  const io = createMockIo();
  const engine = new GameEngine(io);
  const { room, hostId } = createRoomWithHost(engine);
  t.after(() => {
    engine.clearRoomTimers(room);
  });

  let intervalCalls = 0;
  const originalSetInterval = global.setInterval;

  global.setInterval = () => {
    intervalCalls += 1;
    return 0;
  };

  try {
    engine.setReadyState(room.id, hostId, true);
    const result = engine.startGame(room.id, hostId);
    assert.equal(result.error, undefined);
    assert.equal(intervalCalls, 0);
  } finally {
    global.setInterval = originalSetInterval;
  }
});
