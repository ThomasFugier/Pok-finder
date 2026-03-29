import { useEffect, useRef, useState } from "react";

export const SCREEN_TRANSITION_PREP_MS = 24;
export const SCREEN_TRANSITION_ENTER_MS = 1000;
export const SCREEN_TRANSITION_HOLD_MS = 1000;
export const SCREEN_TRANSITION_EXIT_MS = 1000;
export const SCREEN_TRANSITION_SWITCH_MS = SCREEN_TRANSITION_ENTER_MS + Math.round(SCREEN_TRANSITION_HOLD_MS / 2);
export const FIRST_ROUND_REVEAL_DELAY_MS = SCREEN_TRANSITION_ENTER_MS + SCREEN_TRANSITION_HOLD_MS + SCREEN_TRANSITION_EXIT_MS;

export function useScreenTransition(isMainMenuView) {
  const [screenTransition, setScreenTransition] = useState({
    visible: false,
    phase: "idle",
    toGame: true
  });
  const [renderedMainMenuView, setRenderedMainMenuView] = useState(isMainMenuView);

  const previousMainMenuViewRef = useRef(null);
  const transitionTimersRef = useRef([]);

  useEffect(() => {
    if (previousMainMenuViewRef.current === null) {
      previousMainMenuViewRef.current = isMainMenuView;
      setRenderedMainMenuView(isMainMenuView);
      return;
    }

    if (previousMainMenuViewRef.current === isMainMenuView) return;
    previousMainMenuViewRef.current = isMainMenuView;

    transitionTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    transitionTimersRef.current = [];

    const toGame = !isMainMenuView;
    setScreenTransition({
      visible: true,
      phase: "pre",
      toGame
    });

    const enterTimerId = setTimeout(() => {
      setScreenTransition((current) => (current.visible ? { ...current, phase: "enter" } : current));
    }, SCREEN_TRANSITION_PREP_MS);
    const holdTimerId = setTimeout(() => {
      setScreenTransition((current) => (current.visible ? { ...current, phase: "hold" } : current));
    }, SCREEN_TRANSITION_PREP_MS + SCREEN_TRANSITION_ENTER_MS);
    const switchTimerId = setTimeout(() => {
      setRenderedMainMenuView(isMainMenuView);
    }, SCREEN_TRANSITION_PREP_MS + SCREEN_TRANSITION_SWITCH_MS);
    const exitTimerId = setTimeout(() => {
      setScreenTransition((current) => (current.visible ? { ...current, phase: "exit" } : current));
    }, SCREEN_TRANSITION_PREP_MS + SCREEN_TRANSITION_ENTER_MS + SCREEN_TRANSITION_HOLD_MS);
    const doneTimerId = setTimeout(() => {
      setScreenTransition({
        visible: false,
        phase: "idle",
        toGame
      });
    }, SCREEN_TRANSITION_PREP_MS + SCREEN_TRANSITION_ENTER_MS + SCREEN_TRANSITION_HOLD_MS + SCREEN_TRANSITION_EXIT_MS);

    transitionTimersRef.current = [enterTimerId, holdTimerId, switchTimerId, exitTimerId, doneTimerId];

    return () => {
      transitionTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      transitionTimersRef.current = [];
    };
  }, [isMainMenuView]);

  return {
    screenTransition,
    renderedMainMenuView
  };
}
