import {
  DEFAULT_SETTINGS,
  DISPLAY_MODE_OPTIONS,
  ENABLED_GENERATIONS,
  GENERATION_OPTIONS,
  LANGUAGE_OPTIONS,
  ROUND_OPTIONS,
  SCORING_MODE_OPTIONS,
  TIMER_OPTIONS_SEC
} from "./gameConstants.js";

export function sanitizeSettings(nextSettings = {}, fallback = DEFAULT_SETTINGS) {
  const rounds = ROUND_OPTIONS.includes(nextSettings.rounds)
    ? nextSettings.rounds
    : fallback.rounds;
  const language = LANGUAGE_OPTIONS.includes(nextSettings.language)
    ? nextSettings.language
    : fallback.language;
  const displayMode = DISPLAY_MODE_OPTIONS.includes(nextSettings.displayMode)
    ? nextSettings.displayMode
    : (DISPLAY_MODE_OPTIONS.includes(nextSettings.mode) ? nextSettings.mode : fallback.displayMode);
  const scoringMode = SCORING_MODE_OPTIONS.includes(nextSettings.scoringMode)
    ? nextSettings.scoringMode
    : (SCORING_MODE_OPTIONS.includes(nextSettings.mode) ? nextSettings.mode : fallback.scoringMode);
  const roundDurationSec = TIMER_OPTIONS_SEC.includes(nextSettings.roundDurationSec)
    ? nextSettings.roundDurationSec
    : fallback.roundDurationSec;

  const requestedGenerations = Array.isArray(nextSettings.generations)
    ? nextSettings.generations
    : fallback.generations;
  const generations = requestedGenerations
    .filter((value) => Number.isInteger(value) && GENERATION_OPTIONS.includes(value) && ENABLED_GENERATIONS.includes(value));
  const fallbackGenerations = Array.isArray(fallback.generations)
    ? fallback.generations.filter((value) => ENABLED_GENERATIONS.includes(value))
    : [];

  return {
    rounds,
    language,
    displayMode,
    scoringMode,
    roundDurationSec,
    generations: generations.length ? generations : (fallbackGenerations.length ? fallbackGenerations : [ENABLED_GENERATIONS[0]])
  };
}
