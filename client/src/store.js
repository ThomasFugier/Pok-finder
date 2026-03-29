import { create } from "zustand";

export const useGameStore = create((set) => ({
  room: null,
  roomId: "",
  playerId: "",
  nickname: "",
  avatar: "pikachu",
  error: "",
  setError: (error) => set({ error }),
  setIdentity: ({ roomId, playerId, nickname, avatar }) =>
    set({ roomId, playerId, nickname, avatar }),
  setRoom: (room) => set({ room }),
  resetAll: () =>
    set({
      room: null,
      roomId: "",
      playerId: "",
      nickname: "",
      avatar: "pikachu",
      error: ""
    })
}));
