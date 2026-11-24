import { DurableObject } from "cloudflare:workers";
import { newKey } from "../src/net/keys";
import type { World } from "./world";

interface LedgerEnv {
  WORLD: DurableObjectNamespace<World>;
}

/** Where a key is being played right now: one connection (a builder in one world). */
interface Session {
  world: string;
  player: string;
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
  created: number;
}

interface Row extends Record<string, SqlStorageValue> {
  key: string;
  session: string | null;
  email: string | null;
  live: number;
  status: string;
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
 * It also knows where each key is being played: one player at a time per key.
 * A new device taking it over sends the old one back to visiting (the newest
 * wins, so nobody is stranded by a game left open elsewhere). And it holds the
 * one-time links that replace a leaked key, sent to the buyer's email.
 */
export class Ledger extends DurableObject<LedgerEnv> {
  constructor(ctx: DurableObjectState, env: LedgerEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS keys (
      key TEXT PRIMARY KEY, session TEXT, email TEXT, live INTEGER NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL)`);
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS keys_email ON keys (email)");
    // When keys were emailed, to whom (an address, or "ip:" and where a request came from): against floods.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS mail (who TEXT NOT NULL, at INTEGER NOT NULL)");
    // Where each key is being played (one player at a time).
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS active (key TEXT PRIMARY KEY, world TEXT NOT NULL, player TEXT NOT NULL, since INTEGER NOT NULL)");
    // One-time links (replacing a key), sent to the buyer's email.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, key TEXT NOT NULL, expires INTEGER NOT NULL)");
  }

  /** A new key, not yet paid for. */
  create(live: boolean): string {
    const key = newKey();
    this.ctx.storage.sql.exec("INSERT INTO keys (key, live, status, created) VALUES (?, ?, 'pending', ?)", key, live ? 1 : 0, Date.now());
    return key;
  }

  /** Notes the checkout session a key is being bought in. */
  attach(key: string, session: string): void {
    this.ctx.storage.sql.exec("UPDATE keys SET session = ? WHERE key = ?", session, key);
  }

  /**
   * Marks a key paid (again is fine). Returns "new" the first time (so its email
   * goes out once), "again" after that, or null when there is no such key.
   */
  paid(key: string, session: string, email: string | null, live: boolean): "new" | "again" | null {
    const row = this.get(key);
    if (!row) return null;
    this.ctx.storage.sql.exec(
      "UPDATE keys SET status = 'paid', session = ?, email = COALESCE(?, email), live = ? WHERE key = ?",
      session,
      email ? email.toLowerCase() : null,
      live ? 1 : 0,
      key,
    );
    return row.status === "paid" ? "again" : "new";
  }

  /** The paid keys bought with this email, in the site's mode (test or live). */
  paidKeys(email: string, live: boolean): string[] {
    return this.findByEmail(email)
      .filter((k) => k.status === "paid" && k.live === live)
      .map((k) => k.key);
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

  /** True when the key is paid for, in the same mode (test or live) as the site now. */
  check(key: string, live: boolean): boolean {
    const row = this.get(key);
    return !!row && row.status === "paid" && row.live === live;
  }

  // ── One player at a time ────────────────────────────────────────────────

  /**
   * Player `player` in world `world` starts building with `key`. Whoever had it
   * before (another device, or this one in another world) goes back to visiting.
   */
  async claim(key: string, world: string, player: string): Promise<void> {
    const before = this.active(key);
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO active (key, world, player, since) VALUES (?, ?, ?, ?)", key, world, player, Date.now());
    if (before && (before.world !== world || before.player !== player)) await this.demote(before);
  }

  /** That player stopped (left, or went back to visiting): the key is free. */
  release(key: string, world: string, player: string): void {
    this.ctx.storage.sql.exec("DELETE FROM active WHERE key = ? AND world = ? AND player = ?", key, world, player);
  }

  private active(key: string): Session | null {
    return this.ctx.storage.sql.exec<{ world: string; player: string }>("SELECT world, player FROM active WHERE key = ?", key).toArray()[0] ?? null;
  }

  /** Sends a session back to visiting (its world tells the page why). */
  private async demote(session: Session): Promise<void> {
    try {
      await this.env.WORLD.get(this.env.WORLD.idFromName(session.world)).demote(session.player);
    } catch {
      // That world is gone or asleep without it: nothing to send back.
    }
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
   * Uses a replace link: the old key is retired (whoever plays with it goes
   * back to visiting) and a new paid key takes its place, with the same buyer.
   * Returns the new key and the email to send it to, or null for a used,
   * expired or unknown link.
   */
  async replace(token: string, live: boolean): Promise<{ key: string; email: string } | null> {
    const sql = this.ctx.storage.sql;
    const t = sql.exec<{ key: string; expires: number }>("SELECT key, expires FROM tokens WHERE token = ?", token).toArray()[0];
    sql.exec("DELETE FROM tokens WHERE token = ?", token);
    if (!t || t.expires < Date.now()) return null;
    const old = this.get(t.key);
    if (!old || old.status !== "paid" || old.live !== live || !old.email) return null;
    const key = newKey();
    sql.exec("INSERT INTO keys (key, session, email, live, status, created) VALUES (?, ?, ?, ?, 'paid', ?)", key, old.session, old.email, live ? 1 : 0, Date.now());
    sql.exec("UPDATE keys SET status = 'retired' WHERE key = ?", old.key);
    sql.exec("DELETE FROM tokens WHERE key = ?", old.key);
    const session = this.active(old.key);
    sql.exec("DELETE FROM active WHERE key = ?", old.key);
    if (session) await this.demote(session);
    return { key, email: old.email };
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
  created: r.created,
});
