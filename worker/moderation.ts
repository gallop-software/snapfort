import { DurableObject } from "cloudflare:workers";
import { REPORT_AGAIN_MS, REPORTS_PER_HOUR, type ReportReason } from "../src/net/moderation";
import type { ChatTo } from "../src/net/chat";

/** Something a reported builder said shortly before the report: when (ms), what, and to whom. */
export interface SaidLine {
  at: number;
  text: string;
  to: ChatTo;
}

/** A report, as the owner's admin panel sees it. */
export interface Report {
  id: number;
  at: number;
  /** The world's room it was made in. */
  room: string;
  /** Who reported (their public id and name). */
  byUid: string;
  byName: string;
  /** Who was reported: their public id, their name then, and their player id in that room. */
  uid: string;
  name: string;
  player: string;
  why: ReportReason;
  /** What they said in the last few minutes before the report, oldest first. */
  said: SaidLine[];
  /** "open" until the owner deals with it: "dismissed", or "banned" (they were banned, from this report or another). */
  status: "open" | "dismissed" | "banned";
}

/** A banned device: its public id, the name it had, why, and when. */
export interface Ban {
  uid: string;
  name: string;
  why: string;
  at: number;
}

interface ReportRow extends Record<string, SqlStorageValue> {
  id: number;
  at: number;
  room: string;
  by_uid: string;
  by_name: string;
  uid: string;
  name: string;
  player: string;
  why: string;
  said: string;
  status: string;
}

/** Reports kept, at most (the oldest closed ones go first). */
const MOST_REPORTS = 5_000;

/**
 * Reports from players, and the devices the owner has banned. One instance
 * for the whole site. A world asks it whether a joining device is banned, and
 * passes reports on to it; the owner's admin panel reads the reports and bans
 * or dismisses (worker/admin.ts). Only what a report needs is kept: public ids
 * and names, never a device id, an email or an address.
 */
export class Moderation extends DurableObject<object> {
  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, room TEXT NOT NULL, by_uid TEXT NOT NULL, by_name TEXT NOT NULL,
      uid TEXT NOT NULL, name TEXT NOT NULL, player TEXT NOT NULL, why TEXT NOT NULL, said TEXT NOT NULL, status TEXT NOT NULL)`);
    sql.exec("CREATE INDEX IF NOT EXISTS reports_by ON reports (by_uid, at)");
    sql.exec("CREATE INDEX IF NOT EXISTS reports_uid ON reports (uid)");
    sql.exec("CREATE TABLE IF NOT EXISTS bans (uid TEXT PRIMARY KEY, name TEXT NOT NULL, why TEXT NOT NULL, at INTEGER NOT NULL)");
  }

  /**
   * Takes a report. False (and nothing kept) when the reporter has sent
   * REPORTS_PER_HOUR in the last hour, or reported this builder within
   * REPORT_AGAIN_MS: a report is a request for the owner to look, and one is
   * enough.
   */
  report(r: Omit<Report, "id" | "status">): boolean {
    const sql = this.ctx.storage.sql;
    const hour = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE by_uid = ? AND at > ?", r.byUid, r.at - 3_600_000).one().n;
    if (hour >= REPORTS_PER_HOUR) return false;
    const again = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE by_uid = ? AND uid = ? AND at > ?", r.byUid, r.uid, r.at - REPORT_AGAIN_MS).one().n;
    if (again > 0) return false;
    const status = this.banned(r.uid) ? "banned" : "open";
    sql.exec(
      "INSERT INTO reports (at, room, by_uid, by_name, uid, name, player, why, said, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      r.at, r.room, r.byUid, r.byName, r.uid, r.name, r.player, r.why, JSON.stringify(r.said), status,
    );
    const over = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM reports").one().n - MOST_REPORTS;
    if (over > 0) sql.exec("DELETE FROM reports WHERE id IN (SELECT id FROM reports WHERE status != 'open' ORDER BY id LIMIT ?)", over);
    return true;
  }

  /** Whether this device's public id is banned. */
  banned(uid: string): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 FROM bans WHERE uid = ?", uid).toArray().length > 0;
  }

  /** Reports for the admin panel, newest first: the open ones, or all. */
  reports(which: "open" | "all" = "open", limit = 100): Report[] {
    const n = Math.min(500, Math.max(1, Math.floor(limit) || 100));
    const rows =
      which === "open"
        ? this.ctx.storage.sql.exec<ReportRow>("SELECT * FROM reports WHERE status = 'open' ORDER BY id DESC LIMIT ?", n).toArray()
        : this.ctx.storage.sql.exec<ReportRow>("SELECT * FROM reports ORDER BY id DESC LIMIT ?", n).toArray();
    return rows.map(toReport);
  }

  /** How many reports are open (waiting for the owner). */
  openCount(): number {
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").one().n;
  }

  /** The owner looked at report `id` and did nothing: it is closed. False when there is no such open report. */
  dismiss(id: number): boolean {
    return this.ctx.storage.sql.exec("UPDATE reports SET status = 'dismissed' WHERE id = ? AND status = 'open'", id).rowsWritten > 0;
  }

  /** Bans a device by its public id; its open reports are closed as "banned". */
  ban(uid: string, name: string, why: string): Ban {
    const at = Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec("INSERT OR REPLACE INTO bans (uid, name, why, at) VALUES (?, ?, ?, ?)", uid, name.slice(0, 40), why.slice(0, 200), at);
    sql.exec("UPDATE reports SET status = 'banned' WHERE uid = ? AND status = 'open'", uid);
    return { uid, name, why, at };
  }

  /** Lifts a ban. False when that device was not banned. */
  unban(uid: string): boolean {
    return this.ctx.storage.sql.exec("DELETE FROM bans WHERE uid = ?", uid).rowsWritten > 0;
  }

  /** Every ban, newest first. */
  bans(): Ban[] {
    return this.ctx.storage.sql.exec<{ uid: string; name: string; why: string; at: number }>("SELECT * FROM bans ORDER BY at DESC").toArray().map((b) => ({ ...b }));
  }

  /** The name a device last had in a report (for banning it from the admin panel), or "". */
  nameOf(uid: string): string {
    return this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM reports WHERE uid = ? ORDER BY id DESC LIMIT 1", uid).toArray()[0]?.name ?? "";
  }
}

function toReport(r: ReportRow): Report {
  let said: SaidLine[] = [];
  try {
    said = JSON.parse(r.said) as SaidLine[];
  } catch {
    // Unreadable: shown with nothing said.
  }
  const status = r.status === "dismissed" || r.status === "banned" ? r.status : "open";
  return { id: r.id, at: r.at, room: r.room, byUid: r.by_uid, byName: r.by_name, uid: r.uid, name: r.name, player: r.player, why: r.why as ReportReason, said, status };
}
