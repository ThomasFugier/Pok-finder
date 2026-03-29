import { useEffect, useRef } from "react";

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

export function PokemonCanvas({ sprite, hidden }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!sprite || !ref.current) return;

    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    const pixelBuffer = document.createElement("canvas");
    const pixelCtx = pixelBuffer.getContext("2d");
    let frameId = null;
    let cancelled = false;

    const drawFrame = ({ pixelFactor, maskOpacity, offsetY, distortFactor }) => {
      const width = canvas.width;
      const height = canvas.height;
      const fit = width * 0.86;
      const ratio = img.width / img.height;
      const baseWidth = ratio >= 1 ? fit : fit * ratio;
      const baseHeight = ratio >= 1 ? fit / ratio : fit;
      const drawWidth = baseWidth * (1 + (0.2 * distortFactor));
      const drawHeight = baseHeight * (1 - (0.14 * distortFactor));
      const wobbleX = Math.sin((1 - distortFactor) * Math.PI * 3) * 4 * distortFactor;
      const x = ((width - drawWidth) / 2) + wobbleX;
      const y = (height - drawHeight) / 2 + offsetY;

      const sampleWidth = Math.max(1, Math.round(drawWidth * pixelFactor));
      const sampleHeight = Math.max(1, Math.round(drawHeight * pixelFactor));
      pixelBuffer.width = sampleWidth;
      pixelBuffer.height = sampleHeight;
      pixelCtx.clearRect(0, 0, sampleWidth, sampleHeight);
      pixelCtx.imageSmoothingEnabled = false;
      pixelCtx.drawImage(img, 0, 0, sampleWidth, sampleHeight);

      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pixelBuffer, x, y, drawWidth, drawHeight);
      ctx.imageSmoothingEnabled = true;

      if (maskOpacity > 0) {
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = `rgba(6, 8, 15, ${maskOpacity})`;
        ctx.fillRect(x, y, drawWidth, drawHeight);
        ctx.globalCompositeOperation = "source-over";
      }
    };

    const animateReveal = (timestamp, startTime) => {
      if (cancelled) return;

      const elapsed = timestamp - startTime;
      const revealDurationMs = 1000;
      const travelProgress = Math.min(1, elapsed / revealDurationMs);
      const pixelProgress = Math.min(1, elapsed / revealDurationMs);
      const maskProgress = Math.min(1, elapsed / revealDurationMs);

      const offsetY = (1 - easeOutCubic(travelProgress)) * 34;
      const pixelFactor = 0.03 + (0.97 * easeOutCubic(pixelProgress));
      const maskOpacity = hidden ? 1 : (1 - easeOutCubic(maskProgress));
      const distortFactor = 1 - easeOutCubic(pixelProgress);

      drawFrame({ pixelFactor, maskOpacity, offsetY, distortFactor });

      if (travelProgress < 1 || pixelProgress < 1 || (!hidden && maskProgress < 1)) {
        frameId = requestAnimationFrame((nextTs) => animateReveal(nextTs, startTime));
        return;
      }

      drawFrame({ pixelFactor: 1, maskOpacity: hidden ? 1 : 0, offsetY: 0, distortFactor: 0 });
    };

    img.crossOrigin = "anonymous";
    img.onload = () => {
      frameId = requestAnimationFrame((ts) => animateReveal(ts, ts));
    };
    img.src = sprite;

    return () => {
      cancelled = true;
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [sprite, hidden]);

  return <canvas className="pokemon-canvas" width="220" height="220" ref={ref} />;
}
