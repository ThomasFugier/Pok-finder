import { useEffect, useRef, useState } from "react";

export function useFloatingTooltip() {
  const [floatingTooltip, setFloatingTooltip] = useState(null);
  const tooltipTargetRef = useRef(null);

  useEffect(() => {
    const tooltipSelector = "[data-tooltip]";

    const updateTooltipPosition = (target, textOverride) => {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const text = textOverride ?? target.getAttribute("data-tooltip") ?? "";
      if (!text) return;
      setFloatingTooltip({
        text,
        x: rect.left + (rect.width / 2),
        y: rect.top - 10
      });
    };

    const closeTooltip = () => {
      tooltipTargetRef.current = null;
      setFloatingTooltip(null);
    };

    const openFromTarget = (target) => {
      if (!target) return;
      tooltipTargetRef.current = target;
      updateTooltipPosition(target);
    };

    const onMouseOver = (event) => {
      const target = event.target?.closest?.(tooltipSelector);
      if (!target) return;
      openFromTarget(target);
    };

    const onMouseOut = (event) => {
      if (!tooltipTargetRef.current) return;
      const nextTarget = event.relatedTarget?.closest?.(tooltipSelector);
      if (nextTarget === tooltipTargetRef.current) return;
      if (nextTarget) {
        openFromTarget(nextTarget);
        return;
      }
      closeTooltip();
    };

    const onFocusIn = (event) => {
      const target = event.target?.closest?.(tooltipSelector);
      if (!target) return;
      openFromTarget(target);
    };

    const onFocusOut = () => {
      closeTooltip();
    };

    const onScrollOrResize = () => {
      if (!tooltipTargetRef.current) return;
      updateTooltipPosition(tooltipTargetRef.current);
    };

    const onPointerMove = () => {
      if (!tooltipTargetRef.current) return;
      updateTooltipPosition(tooltipTargetRef.current);
    };

    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("pointermove", onPointerMove);

    return () => {
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return floatingTooltip;
}
