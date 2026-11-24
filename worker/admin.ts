import { WorkerEntrypoint } from "cloudflare:workers";
import { cleanKey } from "../src/net/keys";
import { BUILD_ID } from "../src/net/protocol";
import { WORLDS } from "../src/worlds";
import type { KeyRecord } from "./ledger";
import { looksLikeEmail, sendKeyEmail } from "./mail";
import { cleanSeats } from "./seats";
import { stripeLive } from "./stripe";
import type { Env } from "./world";

/** Someone in a world right now, as the owner's admin panel sees them. */
export interface AdminPlayer {
  id: string;
  name: string;
  color: string;
  /** When they joined (ms). */
  joined: number | null;
  /** "paid": on a seat of a Full Game key; "waiting": has a good key, every seat of it in use; "free": no key. */
  status: "paid" | "waiting" | "free";
  /** Their key (paid or waiting), with its buyer's email and its seats. The email is the buyer's: everyone sharing the key shows the same one. */
  key: string | null;
  email: string | null;
  seats: number | null;
  /** May build here (a visitor to a paid world may not). */
  builder: boolean;
  /** Their page is an older version, waiting to restart. */
  outdated: boolean;
}

/** One world's room, right now. */
export interface AdminWorld {
  /** The room's name (what the Ledger and the Worker call it). */
  room: string;
  /** Which world it is (its id and its name on the menu), and whether building there needs the Full Game. */
  id: string;
  name: string;
  paid: boolean;
  /** Pieces standing, and how many times anyone has ever joined. */
  pieces: number;
  joins: number;
  players: AdminPlayer[];
}

/** Everything the admin panel's first page shows, in one call. */
export interface AdminOverview {
  /** When this was worked out (ms), the site's build, and whether it takes real money (false: Stripe's test mode). */
  at: number;
  build: string;
  live: boolean;
  /** Paid keys and the seats on them (in this mode); and of everyone here now, how many are paid (on a seat), waiting for one, or free. */
  totals: { keys: number; seats: number; players: number; paid: number; waiting: number; free: number };
  worlds: AdminWorld[];
  /** The newest paid keys, newest first. */
  recent: KeyRecord[];
}

const ledger = (env: Env) => env.LEDGER.get(env.LEDGER.idFromName("keys"));

/** Who is where, who is paid, and the totals. Light on every world: one short question each. */
export async function overview(env: Env): Promise<AdminOverview> {
  const live = stripeLive(env);
  const book = ledger(env);
  // Every world's own room, and any other with someone in it (a dev server's test worlds).
  const rooms = [...new Set([...WORLDS.map((w) => w.room), ...(await book.rooms())])];
  const rosters = await Promise.all(
    rooms.map(async (room) => {
      try {
        return { room, ...(await env.WORLD.get(env.WORLD.idFromName(room)).roster()) };
      } catch {
        return null;
      }
    }),
  );
  const found = rosters.filter((r) => r !== null);
  const keys = [...new Set(found.flatMap((r) => r.players.flatMap((p) => p.key ?? p.spare ?? [])))];
  const [owners, summary] = await Promise.all([book.owners(keys), book.summary(live, 25)]);
  const worlds = found.map((r): AdminWorld => {
    const known = WORLDS.find((w) => w.room === r.room) ?? WORLDS.find((w) => w.id === r.env);
    return {
      room: r.room,
      id: known?.id ?? r.env,
      name: known?.name ?? r.env,
      paid: known?.paid ?? false,
      pieces: r.pieces,
      joins: r.joins,
      players: r.players.map((p): AdminPlayer => {
        const key = p.key ?? p.spare;
        const owner = key ? owners[key] : undefined;
        return { id: p.id, name: p.name, color: p.color, joined: p.joined, status: p.key ? "paid" : p.spare ? "waiting" : "free", key, email: owner?.email ?? null, seats: owner?.seats ?? null, builder: p.builder, outdated: p.outdated };
      }),
    };
  });
  const everyone = worlds.flatMap((w) => w.players);
  const count = (status: AdminPlayer["status"]) => everyone.filter((p) => p.status === status).length;
  return {
    at: Date.now(),
    build: BUILD_ID,
    live,
    totals: { keys: summary.keys, seats: summary.seats, players: everyone.length, paid: count("paid"), waiting: count("waiting"), free: count("free") },
    worlds,
    recent: summary.recent,
  };
}

/**
 * The owner's admin panel talks to the game through this, and nothing else
 * can: it has no address. Only a Worker bound to it by name (a service binding
 * with `entrypoint: "AdminApi"`, on the same Cloudflare account) can call it,
 * so who may use the panel is the panel's own business (its login). Everything
 * here answers from what the worlds and the Ledger already hold.
 */
export class AdminApi extends WorkerEntrypoint<Env> {
  /** Who is in each world now, who is paid (and the buyer's email), and the totals. */
  overview(): Promise<AdminOverview> {
    return overview(this.env);
  }

  /** The keys bought with (or given to) an email, newest first. */
  async keysOf(email: string): Promise<KeyRecord[]> {
    return looksLikeEmail(email?.trim().toLowerCase()) ? ledger(this.env).findByEmail(email.trim()) : [];
  }

  /** One key, however it is typed; null when there is none. */
  async key(key: string): Promise<KeyRecord | null> {
    const clean = cleanKey(key);
    return clean ? ledger(this.env).get(clean) : null;
  }

  /** Gives `email` a paid key with so many seats, with no purchase; `send`: emails it to them too. */
  async grant(email: string, seats = 1, send = false): Promise<{ key: string; email: string; seats: number; emailed: boolean } | { error: string }> {
    const to = email?.trim().toLowerCase();
    if (!looksLikeEmail(to)) return { error: "That does not look like an email address." };
    const n = cleanSeats(seats);
    if (!n) return { error: "seats must be a number from 1 to 10." };
    const key = await ledger(this.env).grant(to, stripeLive(this.env), n);
    const emailed = send && (await sendKeyEmail(this.env.EMAIL, to, [{ key, seats: n }], "given", "https://snapfort.io"));
    return { key, email: to, seats: n, emailed };
  }

  /** Sets a key's seats (after a refund, or as a gift). Fewer: whoever has played longest loses their seat. */
  async setSeats(key: string, seats: number): Promise<KeyRecord | { error: string }> {
    const clean = cleanKey(key);
    const n = cleanSeats(seats);
    if (!clean || !n) return { error: "Give a key and seats from 1 to 10." };
    return (await ledger(this.env).setSeats(clean, n)) ?? { error: "No such key." };
  }
}
