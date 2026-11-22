/** Player preferences, kept in this browser between visits. */
import { GRAPHICS_MODES, type GraphicsMode } from "./render/graphics";

export interface Settings {
  /** Mouse look speed, as a multiple of the default. */
  mouseSpeed: number;
  graphics: GraphicsMode;
  /** All game sounds off. */
  muted: boolean;
}

const KEY = "snapfort.settings";
const DEFAULTS: Settings = { mouseSpeed: 2, graphics: "auto", muted: false };
export const MOUSE_SPEED_MIN = 0.25;
export const MOUSE_SPEED_MAX = 3;

export function loadSettings(): Settings {
  const settings = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Settings> | null;
    const speed = raw?.mouseSpeed;
    if (typeof speed === "number" && speed >= MOUSE_SPEED_MIN && speed <= MOUSE_SPEED_MAX) settings.mouseSpeed = speed;
    if (typeof raw?.muted === "boolean") settings.muted = raw.muted;
    if (GRAPHICS_MODES.includes(raw?.graphics as GraphicsMode)) settings.graphics = raw!.graphics!;
  } catch {
    // Unreadable or blocked storage: use the defaults.
  }
  return settings;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked (private mode): the setting lasts for this visit only.
  }
}
