import { DurableObject } from "cloudflare:workers";
import { newKey } from "../src/net/keys";
import { seating, type Seat } from "./seats";
import type { World } from "./world";

interface LedgerEnv {
  WORLD: DurableObjectNamespace<World>;
}

/** How long a "replace my key" link works, ms. */
const TOKEN_MS = 60 * 60_000;

/** One SnapFort key, as kept by the Ledger. */
export interface KeyRecord {
  key: string;
  /** The Stripe Checkout session it was bought in. */
  session: string | null;
  /** The buyer's email, kept only to find a lost key. */
  email: string | null;
  /** Bought with real money (false: Stripe's test mode). */
  live: boolean;
  /** "retired": replaced by a new key (it was leaked); it no longer works. */
  status: "pending" | "paid" | "retired";
  /** How many people can build with it at once. */
  seats: number;
  created: number;
}

/** What paying for a checkout did: a new key, more seats on one, or nothing (it was already counted). */
export interface Paid {
  key: string;
  /** The seats the key has now. */
  seats: number;
  /** The seats this purchase was for. */
  bought: number;
  kind: "new" | "added" | "again";
  /** The purchase was seats for a key already owned (true also when counted "again"). */
  adds: boolean;
  /** The key's email (the buyer's, or for added seats whoever first bought the key). */
  email: string | null;
}

interface Row extends Record<string, SqlStorageValue> {
  key: string;
  session: string | null;
  email: string | null;
  live: number;
  status: string;
  seats: number;
  created: number;
}

/**
 * Who owns the Full Game: a list of keys, each made just before a purchase
 * and marked paid once Stripe says so (by the page coming back from checkout,
 * or by Stripe's webhook, whichever is first; both are safe to repeat). One
 * instance for the whole site. A key bought in Stripe's test mode only works
 * while the site is in test mode, so trying the purchase out never gives away
 * the real thing.
 *
 * A key has seats: as many people can build with it at once as it has seats
 * (one, unless more were bought with it or added later). The Ledger knows
 * where each key is being played. When every seat is taken, one more device
 * stays a visitor until it takes a seat ("Use it here": whoever has played
 * longest goes back to visiting) or a seat is added. And it holds the one-time
 * links that replace a leaked key, sent to the buyer's email.
 */
export class Ledger extends DurableObject<LedgerEnv> {
  constructor(ctx: DurableObjectState, env: LedgerEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS keys (
      key TEXT PRIMARY KEY, session TEXT, email TEXT, live INTEGER NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL)`);
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS keys_email ON keys (email)");
    // When keys were emailed, to whom (an address, or "ip:" and where a request came from): against floods.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS mail (who TEXT NOT NULL, at INTEGER NOT NULL)");
    // Keys made before seats have one.
    if (!ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(keys)").toArray().some((c) => c.name === "seats")) {
      ctx.storage.sql.exec("ALTER TABLE keys ADD COLUMN seats INTEGER NOT NULL DEFAULT 1");
    }
    // What each checkout is for (a new key with so many seats, or seats added to a key), and
    // whether it has been counted: payment is reported twice (the page coming back, and Stripe).
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS purchases (session TEXT PRIMARY KEY, key TEXT NOT NULL, seats INTEGER NOT NULL, adds INTEGER NOT NULL, done INTEGER NOT NULL, created INTEGER NOT NULL)");
    // Where each key is being played: a row for every seat in use. (Before seats, one row a key, in "active".)
    ctx.storage.sql.exec("DROP TABLE IF EXISTS active");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS playing (key TEXT NOT NULL, world TEXT NOT NULL, player TEXT NOT NULL, tab TEXT, since INTEGER NOT NULL, PRIMARY KEY (world, player))");
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS playing_key ON playing (key)");
    // How many builders are in each world's room right now (each room says so whenever that changes).
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS present (room TEXT PRIMARY KEY, builders INTEGER NOT NULL, at INTEGER NOT NULL)");
    // One-time links (replacing a key), sent to the buyer's email.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, key TEXT NOT NULL, expires INTEGER NOT NULL)");
  }

  /** A room says how many builders are in it now. */
  present(room: string, builders: number): void {
    if (builders > 0) this.ctx.storage.sql.exec("INSERT OR REPLACE INTO present (room, builders, at) VALUES (?, ?, ?)", room, builders, Date.now());
    else this.ctx.storage.sql.exec("DELETE FROM present WHERE room = ?", room);
  }

  /** How many builders are in each of these rooms (0 for one that has said nothing). */
  builders(rooms: readonly string[]): number[] {
    const counts = new Map(this.ctx.storage.sql.exec<{ room: string; builders: number }>("SELECT room, builders FROM present").toArray().map((r) => [r.room, r.builders]));
    return rooms.map((room) => counts.get(room) ?? 0);
  }

  /** For the owner's admin panel: the rooms with anyone in them now. */
  rooms(): string[] {
    return this.ctx.storage.sql.exec<{ room: string }>("SELECT room FROM present ORDER BY room").toArray().map((r) => r.room);
  }

  /** For the owner's admin panel: the buyer's email and the seats of each of these keys. */
  owners(keys: readonly string[]): Record<string, { email: string | null; seats: number }> {
    const found: Record<string, { email: string | null; seats: number }> = {};
    for (const key of keys.slice(0, 500)) {
      const row = this.get(key);
      if (row) found[key] = { email: row.email, seats: row.seats };
    }
    return found;
  }

  /** For the owner's admin panel: paid keys and their seats in this mode (test or live), and the newest paid keys. */
  summary(live: boolean, recent: number): { keys: number; seats: number; recent: KeyRecord[] } {
    const sql = this.ctx.storage.sql;
    const mode = live ? 1 : 0;
    const sold = sql.exec<{ keys: number; seats: number | null }>("SELECT COUNT(*) AS keys, SUM(seats) AS seats FROM keys WHERE status = 'paid' AND live = ?", mode).one();
    const latest = sql.exec<Row>("SELECT * FROM keys WHERE status = 'paid' AND live = ? ORDER BY created DESC LIMIT ?", mode, Math.min(200, Math.max(0, recent))).toArray().map(toRecord);
    return { keys: sold.keys, seats: sold.seats ?? 0, recent: latest };
  }

  /** A new key with so many seats, not yet paid for. */
  create(live: boolean, seats = 1): string {
    const key = newKey();
    this.ctx.storage.sql.exec("INSERT INTO keys (key, live, status, seats, created) VALUES (?, ?, 'pending', ?, ?)", key, live ? 1 : 0, seats, Date.now());
    return key;
  }

  /**
   * A paid key made by the owner for `email`, with no purchase (no checkout
   * session). The address can get it again with "Lost your key?" and replace it.
   */
  grant(email: string, live: boolean, seats = 1): string {
    const key = newKey();
    this.ctx.storage.sql.exec("INSERT INTO keys (key, email, live, status, seats, created) VALUES (?, ?, ?, 'paid', ?, ?)", key, email.toLowerCase(), live ? 1 : 0, seats, Date.now());
    return key;
  }

  /**
   * Notes what a checkout session is for: a new key (`adds` false; `seats` is
   * how many it comes with) or `seats` more seats on a key already paid for.
   */
  order(session: string, key: string, seats: number, adds: boolean): void {
    const sql = this.ctx.storage.sql;
    sql.exec("INSERT OR IGNORE INTO purchases (session, key, seats, adds, done, created) VALUES (?, ?, ?, ?, 0, ?)", session, key, seats, adds ? 1 : 0, Date.now());
    if (!adds) sql.exec("UPDATE keys SET session = ? WHERE key = ?", session, key);
  }

  /**
   * A checkout session was paid: its key becomes paid, or its seats are added
   * to the key, once however often this is called ("again" after the first
   * time, so its email goes out once). Null when the session is not one of ours.
   * `reference` is the key Stripe holds for the session: a checkout begun
   * before purchases were written down (a buyer on Stripe's page while the
   * site was updated) is known only by it, and is for that key, new.
   */
  paid(session: string, email: string | null, live: boolean, reference: string | null = null): Paid | null {
    const sql = this.ctx.storage.sql;
    const find = () => sql.exec<{ key: string; seats: number; adds: number; done: number }>("SELECT key, seats, adds, done FROM purchases WHERE session = ?", session).toArray()[0];
    let order = find();
    if (!order && reference) {
      const old = this.get(reference);
      if (old && old.session === session) {
        sql.exec("INSERT INTO purchases (session, key, seats, adds, done, created) VALUES (?, ?, ?, 0, ?, ?)", session, old.key, old.seats, old.status === "pending" ? 0 : 1, Date.now());
        order = find();
      }
    }
    if (!order) return null;
    const before = this.get(order.key);
    if (!before) return null;
    const kind = order.done ? "again" : order.adds ? "added" : "new";
    if (kind === "new") {
      sql.exec("UPDATE keys SET status = 'paid', session = ?, email = COALESCE(?, email), live = ? WHERE key = ?", session, email ? email.toLowerCase() : null, live ? 1 : 0, order.key);
    } else if (kind === "added") {
      // (A key replaced while its seats were being paid for: they go to the key that took its place.)
      sql.exec("UPDATE keys SET seats = seats + ? WHERE key = ?", order.seats, order.key);
    }
    sql.exec("UPDATE purchases SET done = 1 WHERE session = ?", session);
    const now = this.get(order.key)!;
    return { key: now.key, seats: now.seats, bought: order.seats, kind, adds: order.adds === 1, email: now.email };
  }

  /** The paid keys bought with this email, in the site's mode (test or live). */
  paidKeys(email: string, live: boolean): KeyRecord[] {
    return this.findByEmail(email).filter((k) => k.status === "paid" && k.live === live);
  }

  /**
   * True (and noted) when an email may go to `who` now: at most one every
   * `gap` ms and `perDay` a day. Stops anyone using "Lost your key?" to flood
   * an inbox, or flooding the Email Service from one place.
   */
  mayMail(who: string, gap: number, perDay: number): boolean {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM mail WHERE at < ?", now - 86_400_000);
    const sent = sql.exec<{ at: number }>("SELECT at FROM mail WHERE who = ? ORDER BY at DESC", who).toArray();
    if (sent.length >= perDay || (sent[0] && now - sent[0].at < gap)) return false;
    sql.exec("INSERT INTO mail (who, at) VALUES (?, ?)", who, now);
    return true;
  }

  /** The seats of a key that is paid for, in the same mode (test or live) as the site now; 0 when it is not. */
  seatsOf(key: string, live: boolean): number {
    const row = this.get(key);
    return row && row.status === "paid" && row.live === live ? row.seats : 0;
  }

  /** The owner sets a key's seats (after a refund, or as a gift). Fewer: whoever has played longest goes back to visiting. */
  async setSeats(key: string, seats: number): Promise<KeyRecord | null> {
    if (!this.get(key)) return null;
    this.ctx.storage.sql.exec("UPDATE keys SET seats = ? WHERE key = ?", seats, key);
    const seated = this.seated(key);
    await this.unseat(seated.slice(0, Math.max(0, seated.length - seats)));
    return this.get(key);
  }

  // ── A player on every seat ──────────────────────────────────────────────

  /**
   * Player `player` in world `world` starts building with `key` (see `seating`).
   * Returns the key's seats when they are seated, "full" when every seat is in
   * use and they did not ask to `take` one, or 0 when the key is no good.
   */
  async claim(key: string, live: boolean, world: string, player: string, tab: string | null, take: boolean): Promise<number | "full"> {
    const seats = this.seatsOf(key, live);
    if (seats === 0) return 0;
    const who = { world, player, tab };
    let outcome = seating(this.seated(key), seats, who, take);
    // Before turning anyone away (or sending anyone back to visiting), make sure the seats are
    // really in use: a world that restarted may never have said its builders left.
    if (outcome === "full" || outcome.leaves.length > 0) {
      await this.sweep(key);
      outcome = seating(this.seated(key), seats, who, take);
    }
    if (outcome === "full") return "full";
    // (The seat changes hands in one go, before anything is waited for, so two devices asking at
    // once can never both get the last seat.)
    this.free(outcome.leaves);
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO playing (key, world, player, tab, since) VALUES (?, ?, ?, ?, ?)", key, world, player, tab, Date.now());
    await this.tell(outcome.leaves);
    return seats;
  }

  /** That player stopped (left, or went back to visiting): their seat is free. */
  release(key: string, world: string, player: string): void {
    this.ctx.storage.sql.exec("DELETE FROM playing WHERE key = ? AND world = ? AND player = ?", key, world, player);
  }

  /** Who plays with a key now, longest seated first. */
  private seated(key: string): Seat[] {
    return this.ctx.storage.sql.exec<Seat & Record<string, SqlStorageValue>>("SELECT world, player, tab, since FROM playing WHERE key = ? ORDER BY since, rowid", key).toArray();
  }

  /** Frees the seats of builders their world no longer has. */
  private async sweep(key: string): Promise<void> {
    await Promise.all(
      this.seated(key).map(async (seat) => {
        let there = true;
        try {
          there = await this.env.WORLD.get(this.env.WORLD.idFromName(seat.world)).builds(seat.player, key);
        } catch {
          // That world cannot be asked just now: leave the seat as it is.
        }
        if (!there) this.release(key, seat.world, seat.player);
      }),
    );
  }

  /** Frees seats and sends whoever sat on them back to visiting. */
  private async unseat(seats: readonly Seat[]): Promise<void> {
    this.free(seats);
    await this.tell(seats);
  }

  private free(seats: readonly Seat[]): void {
    for (const seat of seats) this.ctx.storage.sql.exec("DELETE FROM playing WHERE world = ? AND player = ?", seat.world, seat.player);
  }

  /** Sends sessions back to visiting (their world tells the page why). */
  private async tell(seats: readonly Seat[]): Promise<void> {
    await Promise.all(
      seats.map(async (seat) => {
        try {
          await this.env.WORLD.get(this.env.WORLD.idFromName(seat.world)).demote(seat.player);
        } catch {
          // That world is gone or asleep without it: nothing to send back.
        }
      }),
    );
  }

  // ── Replacing a leaked key ──────────────────────────────────────────────

  /** A one-time link for replacing `key`, or null when it is not a paid key with an email. */
  replaceToken(key: string, live: boolean): { token: string; email: string } | null {
    const row = this.get(key);
    if (!row || row.status !== "paid" || row.live !== live || !row.email) return null;
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.ctx.storage.sql.exec("DELETE FROM tokens WHERE expires < ?", Date.now());
    this.ctx.storage.sql.exec("INSERT INTO tokens (token, key, expires) VALUES (?, ?, ?)", token, key, Date.now() + TOKEN_MS);
    return { token, email: row.email };
  }

  /**
   * Uses a replace link: the old key is retired (everyone playing with it goes
   * back to visiting) and a new paid key takes its place, with the same buyer
   * and the same seats.
   * Returns the new key and the email to send it to, or null for a used,
   * expired or unknown link.
   */
  async replace(token: string, live: boolean): Promise<{ key: string; email: string; seats: number } | null> {
    const sql = this.ctx.storage.sql;
    const t = sql.exec<{ key: string; expires: number }>("SELECT key, expires FROM tokens WHERE token = ?", token).toArray()[0];
    sql.exec("DELETE FROM tokens WHERE token = ?", token);
    if (!t || t.expires < Date.now()) return null;
    const old = this.get(t.key);
    if (!old || old.status !== "paid" || old.live !== live || !old.email) return null;
    const key = newKey();
    sql.exec("INSERT INTO keys (key, session, email, live, status, seats, created) VALUES (?, ?, ?, ?, 'paid', ?, ?)", key, old.session, old.email, live ? 1 : 0, old.seats, Date.now());
    // Seats being paid for on the old key right now go to the new one.
    sql.exec("UPDATE purchases SET key = ? WHERE key = ? AND done = 0", key, old.key);
    sql.exec("UPDATE keys SET status = 'retired' WHERE key = ?", old.key);
    sql.exec("DELETE FROM tokens WHERE key = ?", old.key);
    await this.unseat(this.seated(old.key));
    return { key, email: old.email, seats: old.seats };
  }

  /** Keys bought with this email, newest first (to help someone who lost theirs). */
  findByEmail(email: string): KeyRecord[] {
    return this.ctx.storage.sql
      .exec<Row>("SELECT * FROM keys WHERE email = ? ORDER BY created DESC", email.toLowerCase())
      .toArray()
      .map(toRecord);
  }

  get(key: string): KeyRecord | null {
    const row = this.ctx.storage.sql.exec<Row>("SELECT * FROM keys WHERE key = ?", key).toArray()[0];
    return row ? toRecord(row) : null;
  }
}

const toRecord = (r: Row): KeyRecord => ({
  key: r.key,
  session: r.session,
  email: r.email,
  live: r.live === 1,
  status: r.status === "paid" || r.status === "retired" ? r.status : "pending",
  seats: r.seats,
  created: r.created,
});
