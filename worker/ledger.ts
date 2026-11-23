import { DurableObject } from "cloudflare:workers";
import { newKey } from "../src/net/keys";

/** One SnapFort key, as kept by the Ledger. */
export interface KeyRecord {
  key: string;
  /** The Stripe Checkout session it was bought in. */
  session: string | null;
  /** The buyer's email, kept only to find a lost key. */
  email: string | null;
  /** Bought with real money (false: Stripe's test mode). */
  live: boolean;
  status: "pending" | "paid";
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
 */
export class Ledger extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS keys (
      key TEXT PRIMARY KEY, session TEXT, email TEXT, live INTEGER NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL)`);
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS keys_email ON keys (email)");
    // When keys were emailed, to whom (an address, or "ip:" and where a request came from): against floods.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS mail (who TEXT NOT NULL, at INTEGER NOT NULL)");
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

const toRecord = (r: Row): KeyRecord => ({ key: r.key, session: r.session, email: r.email, live: r.live === 1, status: r.status === "paid" ? "paid" : "pending", created: r.created });
