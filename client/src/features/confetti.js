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

export function createFinalConfetti() {
  const backFlow = Array.from({ length: 92 }, (_, i) => randomConfettiPiece("back-flow", i));
  const frontFlow = Array.from({ length: 36 }, (_, i) => randomConfettiPiece("front-flow", i));
  return { backFlow, frontFlow };
}
