export function timeLeftMs(ts, currentNow) {
  if (!ts) return 0;
  return Math.max(0, ts - currentNow);
}
