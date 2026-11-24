/**
 * Seats: how many people can build with one key at once, and who gets a seat.
 * Plain rules, apart from the Ledger that keeps them (so they can be tested).
 */

/** Where a key is being played right now: one connection (a builder in one world), on one seat of the key. */
export interface Seat {
  world: string;
  player: string;
  /** The browser tab it is (the same across reloads and world switches), when known. */
  tab: string | null;
  since: number;
}

/** The most seats one purchase can buy. */
export const MOST_SEATS = 10;

/** A number of seats someone asked for, as a whole number from 1 to the most, or null. */
export function cleanSeats(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MOST_SEATS ? n : null;
}

/**
 * What happens when `who` starts building with a key that has `seats` seats,
 * `seated` being who plays with it now:
 * - already seated (the same connection): nothing changes;
 * - the same tab seated under an older connection (a reload, a world switch):
 *   it takes that seat over, and the old connection `leaves`;
 * - a free seat: seated;
 * - no free seat: "full", unless they `take` one, when whoever has played
 *   longest leaves.
 */
export function seating(seated: readonly Seat[], seats: number, who: { world: string; player: string; tab: string | null }, take: boolean): { leaves: Seat[] } | "full" {
  if (seated.some((s) => s.world === who.world && s.player === who.player)) return { leaves: [] };
  const mine = who.tab ? seated.filter((s) => s.tab === who.tab) : [];
  if (mine.length > 0) return { leaves: mine };
  if (seated.length < seats) return { leaves: [] };
  if (!take) return "full";
  // Room for one: the longest seated go first (more than one only if the key lost seats).
  const oldestFirst = [...seated].sort((a, b) => a.since - b.since);
  return { leaves: oldestFirst.slice(0, seated.length - seats + 1) };
}
