export {
  normalizeAnswer,
  levenshtein,
  similarityScore
} from "../../shared/answerUtils.js";

export function createRoomId(existingRooms) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  do {
    id = "";
    for (let i = 0; i < 5; i += 1) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (existingRooms.has(id));

  return id;
}

export function createPlayerId() {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}
