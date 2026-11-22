import { DurableObject } from "cloudflare:workers";
import { BuildState, type BuildOp } from "../src/game/buildState";
import { LEVEL, MAX_LEVEL } from "../src/game/constants";
import { findLooseAfterRemoval, findUnsupported } from "../src/game/structure";
import { measureTowers } from "../src/game/towers";
import { DOWN_TIME, planFall, RISE_TIME } from "../src/game/fall";
import { checkRange, findImpact, launchPoint, planFlight, strike, throwVelocity, TREBUCHET, trebuchetBase, type Flight, type Vec } from "../src/game/trebuchet";
import { materialAllowed, type Piece } from "../src/game/pieces";
import { applyAction } from "../src/net/authority";
import {
  chunkOf,
  cleanColor,
  cleanName,
  decodeOp,
  decodePieces,
  encodeOp,
  encodePiece,
  PROTOCOL_VERSION,
  type ServerMessage,
  type WireMove,
  type WireOp,
  type WirePiece,
  type WirePlayer,
  type WireTower,
} from "../src/net/protocol";

export interface Env {
  WORLD: DurableObjectNamespace<World>;
  ASSETS: Fetcher;
  ADMIN_SECRET?: string;
}

/** Kept with each socket, so it survives the object hibernating. */
interface Attachment extends WirePlayer {
  move?: WireMove;
}

/** Most builders connected at once. */
const MAX_PLAYERS = 120;
/** Most pieces in the world. */
const MAX_PIECES = 60_000;
/** Most pieces in one chunk, so a chunk's row stays well under SQLite's 2 MB limit. */
const MAX_CHUNK_PIECES = 8_000;
/** Log entries per saved row, for the same reason. */
const LOG_ROW_ENTRIES = 4_000;
/** Largest message accepted, in characters. */
const MAX_MESSAGE = 64 * 1024;
/** Most operations in one action (a big collapse, or undoing one, is a single action). */
const MAX_OPS = 5_000;
/**
 * Pieces a builder may place or edit per second, with room for a burst (undoing
 * the collapse of a big building puts it all back at once). Removing costs
 * little: knocking down a base brings the rest down anyway, and vandalism is
 * undone with the admin rollback.
 */
const OPS_PER_SECOND = 40;
const OPS_BURST = 2_000;
const REMOVE_COST = 0.1;
/** Messages a builder may send per second (positions included). */
const MESSAGES_PER_SECOND = 60;
/** Changes are saved this long after the first unsaved one. */
const FLUSH_MS = 5_000;
/** Builder positions go out this often while anyone is moving. */
const TICK_MS = 100;
/** The position broadcast stops after this many quiet ticks. */
const IDLE_TICKS = 20;
/** How long the change log is kept, for rolling back vandalism. */
const LOG_MS = 7 * 24 * 3600_000;
/** Positions accepted, in centimetres: the building area plus a margin. */
const MAX_COORD = 60_000;

/** Tower heights go out this long after the build changes (they take a full search to work out). */
const TOWERS_MS = 1_500;

/** One logged change: time, who, the operation and what undoes it. */
type LogEntry = [number, string, WireOp, WireOp];

/**
 * The one shared world. Holds the build in memory with the same rules the game
 * uses, saves it to this object's SQLite database in chunks a few seconds after
 * it changes, and relays every change and every builder's position to everyone
 * connected.
 *
 * Uses the WebSocket Hibernation API: with nobody moving and nothing left to
 * save, there are no timers, so the object can sleep. On waking, the
 * constructor reloads the build from the database (everything was saved
 * before it could sleep) and the builders from their sockets.
 */
export class World extends DurableObject<Env> {
  private readonly build = new BuildState();
  /** Piece ids by chunk, so a changed chunk can be saved as one row. */
  private readonly chunks = new Map<string, Set<string>>();
  private readonly dirty = new Set<string>();
  private unsavedLog: LogEntry[] = [];
  private loading = true;

  private readonly players = new Map<WebSocket, Attachment>();
  /** Latest position of each builder that moved since the last broadcast. */
  private readonly moves = new Map<string, WireMove>();
  private readonly budgets = new Map<WebSocket, { tokens: number; at: number }>();
  private readonly messageCounts = new Map<WebSocket, { count: number; second: number }>();

  /** Trebuchet id → id of the builder on it, and the reverse. */
  private readonly crews = new Map<string, string>();
  private readonly crewOf = new Map<string, string>();
  /** When each trebuchet may throw again (ms). */
  private readonly readyAt = new Map<string, number>();
  /** Hits taken by pieces that have not broken yet. */
  private readonly damage = new Map<string, number>();
  private nextShot = 1;
  /** Builders in the air or getting up, until when (ms). */
  private readonly downUntil = new Map<string, number>();
  private towers: WireTower[] = [];
  private towersTimer: ReturnType<typeof setTimeout> | null = null;

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private quietTicks = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.build.subscribe((op, piece) => this.track(op, piece));
    void ctx.blockConcurrencyWhile(async () => this.load());
    for (const ws of ctx.getWebSockets()) {
      const player = ws.deserializeAttachment() as Attachment | null;
      if (player) this.players.set(ws, player);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      if (this.players.size >= MAX_PLAYERS) {
        server.send(JSON.stringify({ t: "error", reason: "full" } satisfies ServerMessage));
        server.close(1013, "The world is full");
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/admin/reset" && request.method === "POST") {
      const ops = [...this.build.all()].map((p): BuildOp => ({ kind: "remove", id: p.id }));
      const count = this.applyAsAdmin(ops);
      return Response.json({ removed: count });
    }
    if (url.pathname === "/admin/rollback" && request.method === "POST") {
      const minutes = Number(url.searchParams.get("minutes"));
      if (!(minutes > 0 && minutes <= LOG_MS / 60_000)) return new Response("minutes must be between 1 and 10080", { status: 400 });
      return Response.json({ undone: this.rollback(Date.now() - minutes * 60_000) });
    }
    if (url.pathname === "/admin/stats") {
      return Response.json({ pieces: this.build.size, players: this.players.size, chunks: this.chunks.size });
    }
    return new Response("Not found", { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return ws.close(1009, "Message too big");
    if (this.flooding(ws)) return;
    let msg: { t?: unknown; [key: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const player = this.players.get(ws);
    if (msg.t === "hello") return this.hello(ws, msg);
    if (!player) return;
    switch (msg.t) {
      case "act":
        return this.act(ws, player, msg.seq, msg.ops);
      case "move":
        return this.move(player, msg.m);
      case "name": {
        player.name = cleanName(msg.name) || player.name;
        player.color = cleanColor(msg.color);
        ws.serializeAttachment(player);
        return this.broadcast({ t: "join", player: publicPlayer(player) }, ws);
      }
      case "sync":
        return send(ws, { t: "snap", pieces: this.allPieces() });
      case "board":
        return this.board(ws, player, msg.id, msg.at);
      case "leave":
        return this.release(player.id);
      case "fire":
        return this.fire(ws, player, msg.id, msg.to);
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  // ── Joining and leaving ────────────────────────────────────────────────

  private hello(ws: WebSocket, msg: Record<string, unknown>): void {
    if (msg.v !== PROTOCOL_VERSION) {
      send(ws, { t: "error", reason: "version" });
      return ws.close(1008, "Old version: reload the page");
    }
    if (this.players.has(ws)) return;
    // A fresh id on every join, never used before, so piece ids made with it never clash.
    const n = this.ctx.storage.sql.exec<{ value: number }>(
      "INSERT INTO meta (key, value) VALUES ('players', 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value",
    ).one().value;
    const player: Attachment = { id: `p${n.toString(36)}`, name: cleanName(msg.name) || "Builder", color: cleanColor(msg.color) };
    ws.serializeAttachment(player);
    this.players.set(ws, player);
    const others = [...this.players.values()].filter((p) => p !== player);
    send(ws, {
      t: "welcome",
      you: player.id,
      pieces: this.allPieces(),
      players: others.map(publicPlayer),
      moves: others.map((p) => this.moves.get(p.id) ?? p.move).filter((m): m is WireMove => m !== undefined),
      crews: [...this.crews],
      damage: [...this.damage],
      towers: this.towers,
    });
    this.broadcast({ t: "join", player: publicPlayer(player) }, ws);
  }

  private drop(ws: WebSocket): void {
    const player = this.players.get(ws);
    this.players.delete(ws);
    this.budgets.delete(ws);
    this.messageCounts.delete(ws);
    if (!player) return;
    this.moves.delete(player.id);
    this.downUntil.delete(player.id);
    this.release(player.id);
    this.broadcast({ t: "leave", id: player.id });
    if (this.players.size === 0) this.flush();
  }

  // ── Building ───────────────────────────────────────────────────────────

  private act(ws: WebSocket, player: Attachment, seq: unknown, list: unknown): void {
    if (!Number.isInteger(seq) || !Array.isArray(list)) return;
    const wire = list.slice(0, MAX_OPS) as unknown[];
    const cost = wire.reduce<number>((sum, w) => sum + (Array.isArray(w) && w[0] === "r" ? REMOVE_COST : 1), 0);
    if (!this.spend(ws, cost)) {
      return send(ws, { t: "ack", seq: seq as number, rejected: wire.map((_, i) => i), extra: [] });
    }

    const now = Date.now();
    const { done, rejected, extra } = applyAction(this.build, wire.map(decodeOp), (piece) => !this.isFull(piece) && materialAllowed(piece.type, piece.material, piece.y));

    for (const d of [...done, ...extra]) this.unsavedLog.push([now, player.id, encodeOp(d.op), encodeOp(d.inverse)]);
    const extraWire = extra.map((e) => encodeOp(e.op));
    send(ws, { t: "ack", seq: seq as number, rejected, extra: extraWire });
    if (done.length + extra.length > 0) {
      this.broadcast({ t: "ops", by: player.id, ops: [...done.map((d) => encodeOp(d.op)), ...extraWire] }, ws);
      this.scheduleFlush();
      this.scheduleTowers();
      if (done.some((d) => d.op.kind === "remove") || extra.length > 0) this.knock(null);
    }
  }

  /** True when this socket has sent more than MESSAGES_PER_SECOND this second; those messages are dropped. */
  private flooding(ws: WebSocket): boolean {
    const second = Math.floor(Date.now() / 1000);
    const entry = this.messageCounts.get(ws);
    if (!entry || entry.second !== second) {
      this.messageCounts.set(ws, { count: 1, second });
      return false;
    }
    return ++entry.count > MESSAGES_PER_SECOND;
  }

  /** True when the world, or the chunk the piece would go in, has no room for another piece. */
  private isFull(piece: Piece): boolean {
    return this.build.size >= MAX_PIECES || (this.chunks.get(chunkOf(piece.x, piece.z))?.size ?? 0) >= MAX_CHUNK_PIECES;
  }

  /** Takes `cost` operations from the builder's allowance; false when they are sending too fast. */
  private spend(ws: WebSocket, cost: number): boolean {
    const now = Date.now();
    const budget = this.budgets.get(ws) ?? { tokens: OPS_BURST, at: now };
    budget.tokens = Math.min(OPS_BURST, budget.tokens + ((now - budget.at) / 1000) * OPS_PER_SECOND);
    budget.at = now;
    this.budgets.set(ws, budget);
    if (budget.tokens < cost) return false;
    budget.tokens -= cost;
    return true;
  }

  /** Applies operations for the admin (reset, rollback), saves at once and sends everyone the new world. */
  private applyAsAdmin(ops: readonly BuildOp[]): number {
    const now = Date.now();
    let count = 0;
    for (const op of ops) {
      const inverse = this.build.apply(op);
      if (!inverse) continue;
      count++;
      this.unsavedLog.push([now, "admin", encodeOp(op), encodeOp(inverse)]);
    }
    this.flush();
    this.broadcast({ t: "snap", pieces: this.allPieces() });
    this.scheduleTowers();
    this.knock(null);
    return count;
  }

  /** Undoes every change made since `since` (newest first). */
  private rollback(since: number): number {
    this.flush();
    const rows = this.ctx.storage.sql.exec<{ ops: string }>("SELECT ops FROM log WHERE at >= ? ORDER BY seq DESC", since).toArray();
    const undo: BuildOp[] = [];
    for (const row of rows) {
      const entries = JSON.parse(row.ops) as LogEntry[];
      for (let i = entries.length - 1; i >= 0; i--) {
        const [at, , , inverse] = entries[i]!;
        const op = at >= since ? decodeOp(inverse) : null;
        if (op) undo.push(op);
      }
    }
    return this.applyAsAdmin(undo);
  }

  // ── Trebuchets ─────────────────────────────────────────────────────────

  /** Puts a builder on a trebuchet, if it is free and they are standing by it. */
  private board(ws: WebSocket, player: Attachment, id: unknown, at: unknown): void {
    const t = typeof id === "string" ? this.build.get(id) : undefined;
    if (!t || t.type !== "trebuchet") return send(ws, { t: "denied", reason: "gone" });
    const crew = this.crews.get(t.id);
    if (crew && crew !== player.id) return send(ws, { t: "denied", reason: "busy" });
    const pos = readVec(at);
    const base = trebuchetBase(t);
    if (!pos || Math.hypot(pos[0] - base[0], pos[2] - base[2]) > TREBUCHET.boardReach + 1 || Math.abs(pos[1] - base[1]) > 4) {
      return send(ws, { t: "denied", reason: "far" });
    }
    if (crew === player.id) return;
    this.release(player.id);
    this.crews.set(t.id, player.id);
    this.crewOf.set(player.id, t.id);
    this.broadcast({ t: "crew", id: t.id, by: player.id });
  }

  /** Takes a builder off whatever trebuchet they are on. */
  private release(playerId: string): void {
    const id = this.crewOf.get(playerId);
    if (id === undefined) return;
    this.crewOf.delete(playerId);
    this.crews.delete(id);
    this.broadcast({ t: "crew", id, by: null });
  }

  /** Throws a stone from the trebuchet the builder is on at point `to`. */
  private fire(ws: WebSocket, player: Attachment, id: unknown, to: unknown): void {
    const t = typeof id === "string" ? this.build.get(id) : undefined;
    if (!t || t.type !== "trebuchet" || this.crews.get(t.id) !== player.id) return send(ws, { t: "denied", reason: "gone" });
    const target = readVec(to);
    if (!target) return;
    const now = Date.now();
    if (now < (this.readyAt.get(t.id) ?? 0) - 150) return send(ws, { t: "denied", reason: "reload" });
    const range = checkRange(t, target);
    if (range !== "ok") return send(ws, { t: "denied", reason: range === "near" ? "near" : "range" });
    this.readyAt.set(t.id, now + TREBUCHET.reload * 1000);
    const from = launchPoint(t);
    const flight = planFlight(from, target);
    const shot = this.nextShot++;
    this.broadcast({ t: "shot", shot, id: t.id, by: player.id, from: round(from), to: round(target) });
    this.followStone(shot, flight, t.id, player.id, findImpact(this.build, flight, t.id).time, now);
  }

  /**
   * Waits for the stone to arrive, then checks again (the build may have
   * changed in flight): if what it was heading for has gone, it flies on.
   */
  private followStone(shot: number, flight: Flight, ignore: string, by: string, at: number, launched: number): void {
    const wait = Math.max(0, launched + at * 1000 - Date.now());
    setTimeout(() => {
      const impact = findImpact(this.build, flight, ignore);
      if (impact.time > at + 0.02) return this.followStone(shot, flight, ignore, by, impact.time, launched);
      this.land(shot, impact.point, by);
    }, wait);
  }

  /** A stone lands: everything in the blast takes a hit, what breaks goes, and what that strands falls. */
  private land(shot: number, point: Vec, by: string): void {
    const now = Date.now();
    const { broken, damaged } = strike(this.build, point, this.damage);
    const ops: WireOp[] = [];
    const remove = (piece: Piece) => {
      const op: BuildOp = { kind: "remove", id: piece.id };
      const inverse = this.build.apply(op);
      if (!inverse) return false;
      ops.push(encodeOp(op));
      this.unsavedLog.push([now, by, encodeOp(op), encodeOp(inverse)]);
      return true;
    };
    const gone = broken.filter(remove);
    const fallen = gone.length > 0 ? findLooseAfterRemoval(this.build, gone).filter(remove) : [];
    this.broadcast({ t: "impact", shot, point: round(point), ops, fallen: fallen.map((p) => p.id), damage: damaged });
    this.knock(point);
    if (ops.length > 0) {
      this.scheduleFlush();
      this.scheduleTowers();
    }
  }

  /**
   * Builders near an impact at `point` are thrown; builders left standing on
   * nothing (what held them was removed) fall. Each flight is planned here,
   * from where the server last knew them to be, and sent to everyone.
   */
  private knock(point: Vec | null): void {
    const now = Date.now();
    for (const player of this.players.values()) {
      const m = this.moves.get(player.id) ?? player.move;
      if (!m || now < (this.downUntil.get(player.id) ?? 0)) continue;
      const centre: Vec = [m[1] / 100, m[2] / 100, m[3] / 100];
      const v = point ? throwVelocity(point, centre) : null;
      let fall = v ? planFall(this.build, centre, v) : planFall(this.build, centre, [0, 0, 0]);
      // Still standing on something: no fall.
      if (!v && fall.time < 0.12) continue;
      if (!v && fall.land[1] > centre[1] - 0.3) continue;
      fall = { ...fall, path: fall.path.map(round), land: round(fall.land) };
      this.release(player.id);
      this.downUntil.set(player.id, now + (fall.time + DOWN_TIME + RISE_TIME) * 1000);
      this.broadcast({ t: "thrown", id: player.id, path: fall.path, time: Math.round(fall.time * 1000) / 1000, land: fall.land });
      // Where they come to rest is where they are (for anyone joining, and if their tab is asleep).
      setTimeout(() => {
        const move: WireMove = [player.id, Math.round(fall.land[0] * 100), Math.round(fall.land[1] * 100), Math.round(fall.land[2] * 100), m[4], 1];
        player.move = move;
        this.moves.set(player.id, move);
        this.quietTicks = 0;
        this.tickTimer ??= setInterval(() => this.tick(), TICK_MS);
      }, fall.time * 1000);
    }
  }

  // ── Towers ─────────────────────────────────────────────────────────────

  private scheduleTowers(): void {
    this.towersTimer ??= setTimeout(() => {
      this.towersTimer = null;
      const next = this.measure();
      if (JSON.stringify(next) === JSON.stringify(this.towers)) return;
      this.towers = next;
      this.broadcast({ t: "towers", list: next });
    }, TOWERS_MS);
  }

  private measure(): WireTower[] {
    return measureTowers(this.build, 5).map((t) => [Math.round(t.height * 100) / 100, ...round(t.top), t.pieces]);
  }

  // ── Movement ───────────────────────────────────────────────────────────

  private move(player: Attachment, m: unknown): void {
    if (!Array.isArray(m) || m.length !== 5 || !m.every((v) => Number.isInteger(v))) return;
    const [x, y, z, yaw, flags] = m as number[];
    if (Math.abs(x!) > MAX_COORD || Math.abs(z!) > MAX_COORD || y! < -5_000 || y! > (MAX_LEVEL + 3) * LEVEL * 100) return;
    const move: WireMove = [player.id, x!, y!, z!, yaw! % 6284, flags! & 3];
    player.move = move;
    this.moves.set(player.id, move);
    this.quietTicks = 0;
    this.tickTimer ??= setInterval(() => this.tick(), TICK_MS);
  }

  /** Sends everyone the builders who moved since the last tick; stops when nobody has moved for a while. */
  private tick(): void {
    if (this.moves.size > 0) {
      this.broadcast({ t: "moves", m: [...this.moves.values()] });
      this.moves.clear();
      return;
    }
    if (++this.quietTicks < IDLE_TICKS) return;
    clearInterval(this.tickTimer!);
    this.tickTimer = null;
    // Keep where everyone stopped with their socket, so it survives hibernation.
    for (const [ws, player] of this.players) ws.serializeAttachment(player);
  }

  // ── Saving ─────────────────────────────────────────────────────────────

  private load(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS chunks (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, ops TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);`);
    for (const row of sql.exec<{ data: string }>("SELECT data FROM chunks").toArray()) {
      for (const piece of decodePieces(JSON.parse(row.data) as WirePiece[])) this.build.apply({ kind: "place", piece });
    }
    this.loading = false;
    // Building rules change now and then: whatever no longer stands under the
    // current ones comes down when the world loads (and is saved that way).
    const now = Date.now();
    for (const piece of findUnsupported(this.build)) {
      const op: BuildOp = { kind: "remove", id: piece.id };
      const inverse = this.build.apply(op);
      if (inverse) this.unsavedLog.push([now, "rules", encodeOp(op), encodeOp(inverse)]);
    }
    this.flush();
    this.towers = this.measure();
  }

  /** Keeps the chunk index up to date and marks the chunk as needing a save. */
  private track(op: BuildOp, piece: Piece): void {
    const key = chunkOf(piece.x, piece.z);
    let ids = this.chunks.get(key);
    if (op.kind === "place") {
      if (!ids) this.chunks.set(key, (ids = new Set()));
      ids.add(piece.id);
    } else if (op.kind === "remove" && ids) {
      ids.delete(piece.id);
      if (ids.size === 0) this.chunks.delete(key);
    }
    if (op.kind === "remove") {
      this.damage.delete(piece.id);
      // A trebuchet taken away (removed, broken or fallen) drops whoever was on it.
      const crew = this.crews.get(piece.id);
      if (crew !== undefined) this.release(crew);
      this.readyAt.delete(piece.id);
    }
    if (!this.loading) this.dirty.add(key);
  }

  /** A pending timer also keeps the object from hibernating before the save. */
  private scheduleFlush(): void {
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Writes every changed chunk as one row each, and the log since the last save as one row. */
  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.dirty.size === 0 && this.unsavedLog.length === 0) return;
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      for (const key of this.dirty) {
        const ids = this.chunks.get(key);
        if (!ids || ids.size === 0) sql.exec("DELETE FROM chunks WHERE key = ?", key);
        else {
          const data = [...ids].map((id) => encodePiece(this.build.get(id)!));
          sql.exec("INSERT OR REPLACE INTO chunks (key, data) VALUES (?, ?)", key, JSON.stringify(data));
        }
      }
      for (let i = 0; i < this.unsavedLog.length; i += LOG_ROW_ENTRIES) {
        sql.exec("INSERT INTO log (at, ops) VALUES (?, ?)", now, JSON.stringify(this.unsavedLog.slice(i, i + LOG_ROW_ENTRIES)));
      }
      sql.exec("DELETE FROM log WHERE at < ?", now - LOG_MS);
    });
    this.dirty.clear();
    this.unsavedLog = [];
  }

  // ── Sending ────────────────────────────────────────────────────────────

  private allPieces(): WirePiece[] {
    return [...this.build.all()].map(encodePiece);
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    const text = JSON.stringify(msg);
    for (const ws of this.players.keys()) {
      if (ws === except) continue;
      try {
        ws.send(text);
      } catch {
        // Closing; webSocketClose tidies up.
      }
    }
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Closing; webSocketClose tidies up.
  }
}

const publicPlayer = (p: Attachment): WirePlayer => ({ id: p.id, name: p.name, color: p.color });

/** A point in metres from a message, or null when malformed or far outside the world. */
function readVec(v: unknown): Vec | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [x, y, z] = v as number[];
  if (Math.abs(x!) > MAX_COORD / 100 || Math.abs(z!) > MAX_COORD / 100 || y! < -10 || y! > (MAX_LEVEL + 3) * LEVEL * 2) return null;
  return [x!, y!, z!];
}

const round = (v: Vec): [number, number, number] => [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100, Math.round(v[2] * 100) / 100];
