/**
 * SnapFort keys: what buying the Full Game gives you, like SNAP-7K2M-Q9XD-4RTW.
 * Saved in the browser and typed (or pasted) on another device to unlock it
 * there. Letters and digits that look alike (0/O, 1/I/L) are left out.
 */

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const GROUPS = 3;
const GROUP = 4;

/** A new random key. */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GROUPS * GROUP));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i++) groups.push(chars.slice(i * GROUP, (i + 1) * GROUP).join(""));
  return `SNAP-${groups.join("-")}`;
}

/**
 * A key as typed, made tidy: any case, spaces or dashes, with or without
 * SNAP-. null when it cannot be a key.
 */
export function cleanKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let s = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("SNAP")) s = s.slice(4);
  if (s.length !== GROUPS * GROUP || /[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/.test(s)) return null;
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i++) groups.push(s.slice(i * GROUP, (i + 1) * GROUP));
  return `SNAP-${groups.join("-")}`;
}
