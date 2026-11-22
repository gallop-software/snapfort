/** Player preferences, kept in this browser between visits. */
export interface Settings {
  /** Mouse look speed, as a multiple of the default. */
  mouseSpeed: number;
}

const KEY = "snapfort.settings";
const DEFAULTS: Settings = { mouseSpeed: 1 };
export const MOUSE_SPEED_MIN = 0.25;
export const MOUSE_SPEED_MAX = 3;

export function loadSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const speed = (raw as Partial<Settings> | null)?.mouseSpeed;
    if (typeof speed === "number" && speed >= MOUSE_SPEED_MIN && speed <= MOUSE_SPEED_MAX) return { mouseSpeed: speed };
  } catch {
    // Unreadable or blocked storage: use the defaults.
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked (private mode): the setting lasts for this visit only.
  }
}
