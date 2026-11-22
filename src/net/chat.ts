/**
 * Chat rules shared by the game and the server: how long a message may be, who
 * hears it, how often a builder may talk, and the filter every message passes.
 * Nothing said is ever saved: the server passes messages on and keeps only the
 * last few seconds of world-wide lines in memory, for builders who just arrived.
 */

/** Who a message is for: builders near the speaker, or everyone in the world. */
export type ChatTo = "near" | "all";

/** Longest message, in characters. */
export const CHAT_MAX = 80;
/** A nearby message reaches builders within this many metres of the speaker. */
export const NEAR_RANGE = 80;
/** A ping (or a nearby message pinned to a spot) may mark a spot this far from the speaker, m. */
export const PIN_RANGE = 150;
/** Typed nearby messages are pinned to the built piece the crosshair is on, when it is this close, m. */
export const PIN_AIM_RANGE = 60;
/** Shortest time between one builder's nearby messages (and pings), ms. */
export const NEAR_EVERY = 2_000;
/** Shortest time between one builder's messages to everyone, ms. */
export const ALL_EVERY = 10_000;
/** Shortest time between any two messages to everyone in the whole world, ms. */
export const WORLD_ALL_EVERY = 1_000;
/** The same message twice within this long is refused, ms. */
export const REPEAT_MS = 30_000;
/** How long bubbles, pins and world-wide lines stay on screen, ms. */
export const CHAT_SHOW_MS = 8_000;
/** World-wide lines this recent are shown to a builder who just arrived, ms. */
export const RECENT_MS = 30_000;
/** At most this many world-wide lines on screen (and kept for newcomers). */
export const FEED_LINES = 3;

/** What replaces a filtered word, link, address or phone number. */
const MASK = "♥♥♥";

/**
 * Words filtered wherever they appear (also inside longer words), and words
 * filtered only on their own (they hide inside harmless words: "class",
 * "grape", "cockpit"). Matched with look-alike characters and stretched
 * letters folded ("sh1iiit"), and with dots, dashes, stars or underscores
 * between the letters ("f.u.c.k").
 */
const ANYWHERE = [
  "fuck", "fuk", "fck", "shit", "nigger", "nigga", "faggot", "bitch", "asshole", "arsehole", "dickhead",
  "motherf", "bastard", "wanker", "whore", "slut", "retard", "dildo", "porn", "penis", "vagina", "pussy",
  "kike", "tranny", "wetback", "killyourself",
];
const ON_ITS_OWN = [
  "ass", "arse", "cunt", "cunts", "dick", "dicks", "cock", "cocks", "cum", "tit", "tits", "boob", "boobs", "fag", "fags", "rape", "raped",
  "spic", "chink", "coon", "dyke", "twat", "nazi", "sex", "piss", "kys",
];

/** Look-alike characters folded to the letter they imitate. */
const FOLD: Record<string, string> = { "0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a", "5": "s", $: "s", "7": "t", "+": "t", "8": "b", "9": "g" };
/** What may sit between the letters of a filtered word. */
const GAP = "[._*\\-~]*";
const pattern = (word: string) => [...word].map((c) => `${c}+`).join(GAP);
const ANYWHERE_RE = new RegExp(ANYWHERE.map(pattern).join("|"), "g");
// "Own word" means not touching other letters on either side. (No lookbehind:
// iPhones before iOS 16.4 cannot read it, and this file loads in the page too.)
const ON_ITS_OWN_RE = new RegExp(`(^|[^a-z])(${ON_ITS_OWN.map(pattern).join("|")})(?![a-z])`, "g");

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|gg|co|me|tv|xyz|ru|uk|de|app|dev|link|ly|info|biz|us|site|online|shop|live|fun|club)\b(?:\/\S*)?/gi;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
/** Seven or more digits close together, however they are spaced or punctuated: a phone number. */
const PHONE = /\+?\d(?:[\s().-]{0,2}\d){6,}/g;

/**
 * Makes a message safe to show: plain text on one line, at most CHAT_MAX
 * characters, with swear words, slurs, links, email addresses and phone
 * numbers masked. Returns "" for nothing worth sending.
 */
export function cleanChat(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value
    .normalize("NFD")
    // Control and invisible formatting characters (zero-width, right-to-left overrides).
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    // Stacks of accents ("zalgo" text): keep two per letter (Vietnamese needs two).
    .replace(/(\p{M}\p{M})\p{M}+/gu, "$1")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
  text = [...text].slice(0, CHAT_MAX).join("").trim();
  if (!text) return "";
  text = text.replace(EMAIL, MASK).replace(LINK, MASK).replace(PHONE, MASK);
  return maskWords(text);
}

/** Masks filtered words, matching on a folded copy of the text that lines up with it character for character. */
function maskWords(text: string): string {
  const chars = [...text];
  const folded = chars
    .map((c) => {
      const lower = c.toLowerCase();
      const plain = lower.normalize("NFD").replace(/\p{M}/gu, "");
      const one = plain.length === 1 ? plain : lower.length === 1 ? lower : "?";
      return FOLD[one] ?? one;
    })
    .join("");
  // `folded` has one UTF-16 unit per character of `chars` (astral characters fold to "?").
  const hits: [number, number][] = [];
  for (const re of [ANYWHERE_RE, ON_ITS_OWN_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(folded); m; m = re.exec(folded)) {
      // For own words, group 1 is the character before the word, group 2 the word.
      const lead = m.length > 2 ? m[1]!.length : 0;
      const word = m.length > 2 ? m[2]! : m[0];
      hits.push([m.index + lead, m.index + lead + word.length]);
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  if (hits.length === 0) return text;
  hits.sort((a, b) => b[0] - a[0]);
  let end = Infinity;
  for (const [from, to] of hits) {
    if (to > end) continue; // overlaps a later hit already masked
    chars.splice(from, to - from, MASK);
    end = from;
  }
  return chars.join("");
}
