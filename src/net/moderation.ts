/**
 * Reporting and blocking players, shared by the game and the server.
 *
 * Every browser keeps a random device id of its own (in localStorage, never
 * shown to anyone). The server turns it into a short public id, the `uid`,
 * which travels with each builder and what they say: a player blocks a uid
 * (their own device stops showing that builder's chat), reports one (to the
 * owner), and the owner bans one (that device can no longer join). Builders
 * get a new player id every time they join; the uid stays the same, so a block
 * or a ban lasts. Clearing the browser's storage makes a new device id: that is
 * the limit of what a game without accounts can do, and enough against the
 * passing troublemaker.
 */

/** Why a player is reported. */
export const REPORT_REASONS = ["chat", "name", "wrecking", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** How each reason reads on the button. */
export const REPORT_LABELS: Record<ReportReason, string> = {
  chat: "Rude or unsafe chat",
  name: "Bad name",
  wrecking: "Wrecking builds",
  other: "Something else",
};

/** A reporter may send this many reports an hour, and reports the same builder at most once in REPORT_AGAIN_MS. */
export const REPORTS_PER_HOUR = 10;
export const REPORT_AGAIN_MS = 10 * 60_000;
/** The last few things each builder said, kept in memory only, so a report can show the owner what was said. */
export const SAID_KEPT = 6;
/** ...and only this long, ms. */
export const SAID_KEPT_MS = 10 * 60_000;

export const cleanReason = (value: unknown): ReportReason | null =>
  typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value) ? (value as ReportReason) : null;

/** A device id as the page makes it (lower-case letters and digits), or null. */
export const cleanDevice = (value: unknown): string | null => (typeof value === "string" && /^[a-z0-9]{16,40}$/.test(value) ? value : null);

/** A public id (12 hex digits), or null. */
export const cleanUid = (value: unknown): string | null => (typeof value === "string" && /^[0-9a-f]{12}$/.test(value) ? value : null);

/**
 * The public id for a device id: the first 12 hex digits of its SHA-256. It
 * cannot be turned back into the device id, so showing it to everyone lets
 * nobody pretend to be that device.
 */
export async function uidOf(device: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`snapfort:${device}`));
  return Array.from(new Uint8Array(hash).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}
