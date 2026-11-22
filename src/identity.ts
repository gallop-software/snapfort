import { cleanColor, cleanName } from "./net/protocol";

/** How this player appears to everyone else: a name and a jacket colour, kept in this browser. */
export interface Identity {
  name: string;
  color: string;
}

/** Jacket colours to pick from: bright enough to spot across the world. */
export const COLORS = ["#f07356", "#f2b134", "#5cb85c", "#2fa4a0", "#4a8fe0", "#8a6be0", "#e05fa8", "#8c5a3c", "#3d4a5c", "#f5f0e6"] as const;

const ADJECTIVES = ["Brave", "Busy", "Clever", "Dizzy", "Eager", "Fuzzy", "Happy", "Jolly", "Lucky", "Mighty", "Nimble", "Plucky", "Quick", "Rusty", "Sunny", "Swift", "Tiny", "Witty", "Zippy", "Bold"];
const NOUNS = ["Beaver", "Badger", "Builder", "Falcon", "Fox", "Gecko", "Hammer", "Llama", "Mason", "Otter", "Panda", "Penguin", "Rabbit", "Raccoon", "Tiger", "Turtle", "Walrus", "Wombat", "Yak", "Zebra"];

const KEY = "snapfort.identity";
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export function randomName(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

/** The saved identity, or a new random one (saved for next time). */
export function loadIdentity(): Identity {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Identity> | null;
    const name = cleanName(raw?.name);
    if (name) return { name, color: cleanColor(raw?.color) };
  } catch {
    // Unreadable or blocked storage: make a new one.
  }
  const identity = { name: randomName(), color: pick(COLORS) };
  saveIdentity(identity);
  return identity;
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // Storage blocked (private mode): it lasts for this visit only.
  }
}
