import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { AVATARS } from "./config.js";
import { GameEngine } from "./gameEngine.js";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

const engine = new GameEngine(io);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/avatars", (_req, res) => {
  res.json({ avatars: AVATARS });
});

io.on("connection", (socket) => {
  socket.on("room:create", (payload, ack) => {
    const nickname = (payload?.nickname || "Player").slice(0, 20);
    const avatar = payload?.avatar || AVATARS[0];
    const preferredPlayerId = payload?.playerId || null;
    const initialSettings = payload?.settings || {};

    const result = engine.createRoom({
      nickname,
      avatar,
      preferredPlayerId,
      socketId: socket.id,
      initialSettings
    });
    socket.join(result.room.id);
    engine.broadcastRoom(result.room);
    ack?.({ ok: true, roomId: result.room.id, playerId: result.playerId });
  });

  socket.on("room:join", (payload, ack) => {
    const roomId = (payload?.roomId || "").toUpperCase();
    const nickname = (payload?.nickname || "Player").slice(0, 20);
    const avatar = payload?.avatar || AVATARS[0];
    const preferredPlayerId = payload?.playerId || null;

    const result = engine.joinRoom({ roomId, nickname, avatar, preferredPlayerId, socketId: socket.id });
    if (result.error) {
      ack?.({ ok: false, error: result.error });
      return;
    }
    socket.join(roomId);
    engine.broadcastRoom(result.room);
    ack?.({ ok: true, roomId, playerId: result.playerId });
  });

  socket.on("room:reconnect", (payload, ack) => {
    const roomId = (payload?.roomId || "").toUpperCase();
    const playerId = payload?.playerId;
    if (!roomId || !playerId) {
      ack?.({ ok: false, error: "Missing roomId or playerId" });
      return;
    }

    const result = engine.reconnectToRoom({ roomId, playerId, socketId: socket.id });
    if (result.error) {
      ack?.({ ok: false, error: result.error });
      return;
    }
    socket.join(roomId);
    engine.broadcastRoom(result.room);
    ack?.({ ok: true });
  });

  socket.on("room:updateSettings", (payload, ack) => {
    const roomId = (payload?.roomId || "").toUpperCase();
    const playerId = payload?.playerId;
    const settings = payload?.settings || {};
    const result = engine.updateSettings(roomId, playerId, settings);
    if (result?.error) {
      ack?.({ ok: false, error: result.error });
      return;
    }
    ack?.({ ok: true });
  });

  socket.on("game:start", (payload, ack) => {
    const roomId = (payload?.roomId || "").toUpperCase();
    const playerId = payload?.playerId;
    const result = engine.startGame(roomId, playerId);
    if (result?.error) {
      ack?.({ ok: false, error: result.error });
      return;
    }
    ack?.({ ok: true });
  });

  socket.on("game:nextRound", (payload, ack) => {
    const roomId = (payload?.roomId || "").toUpperCase();
    const playerId = payload?.playerId;
    const result = engine.nextRound(roomId, playerId);
    if (result?.error) {
      ack?.({ ok: false, error: result.error });
      return;
    }
    ack?.({ ok: true });
  });

  socket.on("answer:submit", (payload, ack) => {
    const roomId = (payload?.roomId || "").toUpperCase();
    const playerId = payload?.playerId;
    const answer = payload?.answer || "";
    const result = engine.submitAnswer({ roomId, playerId, answer });
    if (result?.error) {
      ack?.({ ok: false, error: result.error });
      return;
    }
    ack?.({ ok: true });
  });

  socket.on("vote:submit", (payload, ack) => {
    const roomId = (payload?.roomId || "").toUpperCase();
    const voterId = payload?.playerId;
    const targetPlayerId = payload?.targetPlayerId;
    const accepted = !!payload?.accepted;
    const result = engine.submitVote({ roomId, voterId, targetPlayerId, accepted });
    if (result?.error) {
      ack?.({ ok: false, error: result.error });
      return;
    }
    ack?.({ ok: true });
  });

  socket.on("game:returnLobby", (payload, ack) => {
    const roomId = (payload?.roomId || "").toUpperCase();
    const playerId = payload?.playerId;
    const result = engine.restartToLobby(roomId, playerId);
    if (result?.error) {
      ack?.({ ok: false, error: result.error });
      return;
    }
    ack?.({ ok: true });
  });

  socket.on("room:leave", (payload, ack) => {
    const roomId = (payload?.roomId || "").toUpperCase();
    const playerId = payload?.playerId;
    const result = engine.leaveRoom({ roomId, playerId });
    if (result?.error) {
      ack?.({ ok: false, error: result.error });
      return;
    }
    ack?.({ ok: true, roomClosed: !!result.roomClosed });
  });

  socket.on("disconnect", () => {
    engine.leaveBySocket(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
