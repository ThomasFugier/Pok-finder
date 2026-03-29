import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

export const socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ["websocket"]
});

export function emitAck(event, payload, timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: "Server unavailable" });
      return;
    }

    socket.timeout(timeoutMs).emit(event, payload, (err, response) => {
      if (err) {
        resolve({ ok: false, error: "Server timeout" });
        return;
      }
      resolve(response || { ok: false, error: "No response" });
    });
  });
}
