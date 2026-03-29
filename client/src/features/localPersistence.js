import { DEFAULT_SETTINGS } from "@shared/gameConstants.js";
import { sanitizeSettings } from "@shared/settings.js";

const IDENTITY_KEY = "pokefinder.identity";
const SETTINGS_KEY = "pokefinder.setupSettings";

export function getLocalIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setLocalIdentity(value) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(value));
}

export function clearLocalIdentity() {
  localStorage.removeItem(IDENTITY_KEY);
}

export function getLocalSetupSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitizeSettings(JSON.parse(raw), DEFAULT_SETTINGS);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function setLocalSetupSettings(value) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
}
