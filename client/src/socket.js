import { io } from "socket.io-client";

const FALLBACK_SERVER_URL = "https://pok-finder.onrender.com";

function resolveServerUrl() {
  const raw = (import.meta.env.VITE_SERVER_URL || "").trim();
  if (!raw || raw.includes("TON-BACKEND")) {
    return FALLBACK_SERVER_URL;
  }
  return raw.replace(/\/+$/, "");
}

const SERVER_URL = resolveServerUrl();

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
