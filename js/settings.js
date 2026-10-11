// Per-browser settings. The API key never leaves this browser except in requests to Google.

const KEY = "tol.settings";
export const DEFAULT_MODEL = "gemini-3.1-flash-lite";

export function settings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
  return { apiKey: s.apiKey || "", model: s.model || DEFAULT_MODEL };
}

export function saveSettings(patch) {
  const s = { ...settings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  return s;
}
