import { DurableObject } from "cloudflare:workers";
import { BuildState, type BuildOp } from "../src/game/buildState";
import { LEVEL, MAX_LEVEL } from "../src/game/constants";
import { findLooseAfterRemoval, findUnsupported } from "../src/game/structure";
import { measureTowers } from "../src/game/towers";
import { fallEnd, planFall, type Fall } from "../src/game/fall";
import type { Room } from "../src/worlds/serverDoors";
import { checkRange, findImpact, launchPoint, pieceBounds, planFlight, strike, throwVelocity, trebuchetBase, type Flight, type Vec } from "../src/game/trebuchet";
import { materialAllowed, type Piece } from "../src/game/pieces";
import type { Environment } from "../src/game/environments";
import { DEFAULT_WORLD, serverOf, worldOf } from "../src/worlds";
import { cleanKey } from "../src/net/keys";
import type { Ledger } from "./ledger";
import { stripeLive, type StripeEnv } from "./stripe";
import type { MailBinding } from "./mail";
import { applyAction } from "../src/net/authority";
import { cleanChat, FEED_LINES, FLOOD_MS, flooding, NEAR_RANGE, PIN_RANGE, RECENT_MS } from "../src/net/chat";
import {
  chunkOf,
  cleanColor,
  cleanName,
  decodeOp,
  decodePieces,
  encodeOp,
  encodePiece,
  BUILD_ID,
  olderBuild,
  PROTOCOL_VERSION,
  type ServerMessage,
  type WireMove,
  type WireOp,
  type WirePiece,
  type WirePlayer,
  type WireSaid,
  type WireTower,
} from "../src/net/protocol";

export interface Env extends StripeEnv {
  WORLD: DurableObjectNamespace<World>;
  LEDGER: DurableObjectNamespace<Ledger>;
  ASSETS: Fetcher;
  ADMIN_SECRET?: string;
  /** Cloudflare Email Service: sends buyers their keys. */
  EMAIL?: MailBinding;
}

/** Kept with each socket, so it survives the object hibernating. */
interface Attachment extends WirePlayer {
  move?: WireMove;
  /** The trebuchet they are on, and when it can throw again (ms): kept here so they survive the object sleeping. */
  crew?: string;
  readyAt?: number;
  /** May build and work trebuchets here (in a paid world: has a seat on a Full Game key; else a visitor). */
  builder?: boolean;
  /** The Full Game key they have a seat on (in any world, free ones too): freed when they leave. Without one they play free. */
  key?: string;
  /** The browser tab (the same across reloads): joining again from it replaces this connection. */
  tab?: string;
  /** The page's build; when it is not this server's, the page is "outdated": it can watch, not move or build. */
  build?: string;
  outdated?: boolean;
  /** When they joined (ms): until their first heartbeat, that counts as heard from. */
  joined?: number;
}

/** How often silent connections are looked for, and how long silence lasts before one is dropped, ms. */
const SWEEP_MS = 30_000;
const STALE_MS = 90_000;
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
/** Positions accepted, in centimetres: the building area plus a margin, and as high as a world's own flying can take a builder. */
const MAX_COORD = 60_000;
const MAX_HEIGHT = 150_000;

/** Tower heights go out this long after the build changes (they take a full search to work out). */
const TOWERS_MS = 1_500;

/** One logged change: time, who, the operation and what undoes it. */
type LogEntry = [number, string, WireOp, WireOp];

/** Whether a player may build here, and the key they have a seat on (paid: in any world); `full`: their key is good but every seat is in use. */
interface Access {
  builder: boolean;
  key?: string;
  full?: boolean;
  seats?: number;
}

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
  private damageDirty = false;
  private nextShot = 1;
  /** Builders in the air or getting up, until when (ms). */
  private readonly downUntil = new Map<string, number>();
  private towers: WireTower[] = [];
  private towersTimer: ReturnType<typeof setTimeout> | null = null;
  /** How long the last tower measurement took (ms). */
  private towersCost = 0;

  /**
   * Chat, in memory only (nothing said is ever saved): when each builder sent
   * their last few messages (against floods), and the last few world-wide
   * lines for builders who just arrived.
   */
  private readonly talk = new Map<string, number[]>();
  private recentLines: { at: number; said: WireSaid }[] = [];

  /** Which world this is: set once, by the Worker, and saved. Until then, the first world. */
  private environment: Environment = DEFAULT_WORLD;
  /** Whether that has been settled (saved, or told by the Worker). */
  private environmentKnown = false;
  /** This world's name ("main", "moon", a test world's): set once, by the Worker, and saved. */
  private name = "";
  /** When each socket last sent anything (heartbeats aside, which Cloudflare answers and times itself). */
  private readonly heard = new Map<WebSocket, number>();
  /** Sockets whose hello is being answered (their key is being checked). */
  private readonly greeting = new Set<WebSocket>();

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private quietTicks = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.build.subscribe((op, piece) => this.track(op, piece));
    // Heartbeats are answered by Cloudflare without waking (or billing) the world.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    void ctx.blockConcurrencyWhile(async () => {
      this.load();
      for (const ws of ctx.getWebSockets()) {
        const player = ws.deserializeAttachment() as Attachment | null;
        if (!player) continue;
        this.players.set(ws, player);
        // A new version went live while they stayed connected: they should restart.
        if (player.build && olderBuild(player.build, BUILD_ID) && !player.outdated) {
          player.outdated = true;
          ws.serializeAttachment(player);
          send(ws, { t: "update" });
        }
        // Back from sleep: who was on which trebuchet, and its reload.
        if (player.crew && this.build.get(player.crew)?.type === "trebuchet") {
          this.crews.set(player.crew, player.id);
          this.crewOf.set(player.id, player.crew);
          if (player.readyAt) this.readyAt.set(player.crew, player.readyAt);
        } else if (player.crew) {
          delete player.crew;
          ws.serializeAttachment(player);
        }
      }
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      this.learnEnvironment(request.headers.get("x-snapfort-env"));
      this.learnName(request.headers.get("x-snapfort-world"));
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
    this.heard.set(ws, Date.now());
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
        if (player.outdated) return this.refuseAll(ws, msg.seq, msg.ops);
        if (!player.builder) return this.locked(ws, msg.seq, msg.ops);
        return this.act(ws, player, msg.seq, msg.ops);
      case "key": {
        // A key bought, typed in, or taken back ("Use it here") while here: building opens without
        // joining again (and, one player at a time, moves here from wherever the key was). No key:
        // it was removed from this device, so its seat is free and they play free from here on.
        const before = player.key;
        const access = await this.mayBuild(msg.key, player.id, player.tab, msg.take === true);
        // Switched to another key (their own, after sharing one): the old one is free for whoever
        // else plays with it, and taking it over there no longer sends this player back to visiting.
        if (before && before !== access.key) this.ledger().release(before, this.name, player.id).catch(() => {});
        player.builder = access.builder;
        if (access.key) player.key = access.key;
        else delete player.key;
        ws.serializeAttachment(player);
        if (!player.builder) this.release(player.id);
        return send(ws, { t: "access", builder: player.builder, ...(access.full ? { reason: "full" as const } : {}), ...(access.seats ? { seats: access.seats } : {}) });
      }
      case "move":
        // An outdated page stands still where it is, until it restarts.
        if (player.outdated) return;
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
        if (player.outdated) return send(ws, { t: "update" });
        if (!player.builder) return send(ws, { t: "denied", reason: "locked" });
        return this.board(ws, player, msg.id, msg.at);
      case "leave":
        return this.release(player.id);
      case "fire":
        if (player.outdated) return send(ws, { t: "update" });
        if (!player.builder) return send(ws, { t: "denied", reason: "locked" });
        return this.fire(ws, player, msg.id, msg.to);
      case "say":
        return this.say(ws, player, msg.text, msg.to, msg.at);
      case "w":
        // A message of the world's own: its server half deals with it.
        if (player.outdated) return;
        return serverOf(this.environment).message?.(this.room(), player.id, msg.d);
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  // ── Joining and leaving ────────────────────────────────────────────────

  private async hello(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    if (msg.v !== PROTOCOL_VERSION) {
      send(ws, { t: "error", reason: "version", v: PROTOCOL_VERSION });
      return ws.close(1008, "Another version: reload the page");
    }
    if (this.players.has(ws) || this.greeting.has(ws)) return;
    this.greeting.add(ws);
    // A fresh id on every join, never used before, so piece ids made with it never clash.
    const n = this.ctx.storage.sql.exec<{ value: number }>(
      "INSERT INTO meta (key, value) VALUES ('players', 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value",
    ).one().value;
    const id = `p${n.toString(36)}`;
    const tab = typeof msg.tab === "string" && /^[a-z0-9]{8,32}$/.test(msg.tab) ? msg.tab : undefined;
    let access: Access;
    try {
      access = await this.mayBuild(msg.key, id, tab, false);
    } finally {
      this.greeting.delete(ws);
    }
    const builder = access.builder;
    if (this.players.has(ws) || ws.readyState !== WebSocket.OPEN) {
      if (access.key) this.ledger().release(access.key, this.name, id).catch(() => {});
      return;
    }
    // The same tab joining again (a reload, a dropped connection, a world switch and back):
    // its old connection goes first, so nobody is ever seen twice.
    if (tab) {
      for (const [other, p] of this.players) {
        if (other === ws || p.tab !== tab) continue;
        try {
          other.close(4000, "Replaced by a new connection from the same tab");
        } catch {
          // Already closing.
        }
        this.drop(other);
      }
    }
    const build = typeof msg.build === "string" ? msg.build.slice(0, 40) : undefined;
    const outdated = !!build && olderBuild(build, BUILD_ID);
    const player: Attachment = { id, name: cleanName(msg.name) || "Builder", color: cleanColor(msg.color), builder, tab, build, outdated, joined: Date.now() };
    if (access.key) player.key = access.key;
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
      chat: this.recent(),
      env: this.environment.id,
      builder,
      ...(access.full ? { full: true } : {}),
      ...(access.seats ? { seats: access.seats } : {}),
    });
    if (outdated) send(ws, { t: "update" });
    void this.keepWatch();
    this.broadcast({ t: "join", player: publicPlayer(player) }, ws);
    this.tellCount();
    serverOf(this.environment).joined?.(this.room(), player.id);
  }

  private drop(ws: WebSocket): void {
    const player = this.players.get(ws);
    this.players.delete(ws);
    this.heard.delete(ws);
    this.budgets.delete(ws);
    this.messageCounts.delete(ws);
    if (!player) return;
    this.moves.delete(player.id);
    this.downUntil.delete(player.id);
    this.talk.delete(player.id);
    // Their key is free for their other devices.
    if (player.key) this.ledger().release(player.key, this.name, player.id).catch(() => {});
    this.release(player.id);
    serverOf(this.environment).left?.(this.room(), player.id);
    this.broadcast({ t: "leave", id: player.id });
    this.tellCount();
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
    const { done, rejected, extra } = applyAction(this.build, wire.map(decodeOp), (piece) => !this.isFull(piece) && materialAllowed(piece.type, piece.material, piece.y, this.environment));

    for (const d of [...done, ...extra]) this.unsavedLog.push([now, player.id, encodeOp(d.op), encodeOp(d.inverse)]);
    const extraWire = extra.map((e) => encodeOp(e.op));
    send(ws, { t: "ack", seq: seq as number, rejected, extra: extraWire });
    if (done.length + extra.length > 0) {
      this.broadcast({ t: "ops", by: player.id, ops: [...done.map((d) => encodeOp(d.op)), ...extraWire] }, ws);
      this.scheduleFlush();
      this.scheduleTowers();
      const gone = [...done, ...extra].flatMap((d) => (d.inverse.kind === "place" ? [d.inverse.piece] : []));
      if (gone.length > 0) this.knock(null, gone);
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
    const removed: Piece[] = [];
    for (const op of ops) {
      const inverse = this.build.apply(op);
      if (!inverse) continue;
      count++;
      if (inverse.kind === "place") removed.push(inverse.piece);
      this.unsavedLog.push([now, "admin", encodeOp(op), encodeOp(inverse)]);
    }
    this.flush();
    this.broadcast({ t: "snap", pieces: this.allPieces() });
    this.scheduleTowers();
    this.knock(null, removed);
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

  // ── Which world, and who may build in it ──────────────────────────────

  /** Takes this world's name (as the Worker knows it), the first time, and saves it. */
  private learnName(name: string | null): void {
    if (this.name || !name || !/^[a-z0-9-]{1,60}$/.test(name)) return;
    this.name = name;
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO state (key, value) VALUES ('name', ?)", name);
  }

  /**
   * Takes the world the Worker says this is, the first time, and saves it (it
   * never changes). Rooms saved before every world wrote this down have nothing
   * saved: they take it from the Worker the next time someone joins.
   */
  private learnEnvironment(id: string | null): void {
    if (this.environmentKnown || !id) return;
    this.environment = worldOf(id);
    this.environmentKnown = true;
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO state (key, value) VALUES ('environment', ?)", this.environment.id);
  }

  /** Tells the ledger how many builders are here now, for the world cards on everyone's menu. */
  private tellCount(): void {
    if (this.name) this.ledger().present(this.name, this.players.size).catch(() => {});
  }

  private ledger() {
    return this.env.LEDGER.get(this.env.LEDGER.idFromName("keys"));
  }

  /**
   * Who is paid is worked out the same way in every world: a key that is paid
   * for, with a seat free, seats the player (a key has as many seats as were
   * bought for it), wherever they are. With every seat in use they have none
   * (`full`), unless they `take` one: then whoever has played longest loses
   * theirs. What a seat is for is the world's own: a paid world lets only the
   * seated build (the rest visit); a free one lets everyone, and just knows
   * who is paid (`key`) and who plays free.
   */
  private async mayBuild(rawKey: unknown, playerId: string, tab: string | undefined, take: boolean): Promise<Access> {
    const free = !this.environment.paid;
    const key = cleanKey(rawKey);
    if (!key) return { builder: free };
    try {
      const live = stripeLive(this.env);
      const seats = await this.ledger().claim(key, live, this.name, playerId, tab ?? null, take);
      if (seats === "full") return { builder: free, full: true, seats: await this.ledger().seatsOf(key, live) };
      return seats > 0 ? { builder: true, key, seats } : { builder: free };
    } catch {
      return { builder: free };
    }
  }

  /** The key ledger asks: is this player still here, on a seat of this key? (A seat nobody sits on is freed.) */
  builds(playerId: string, key: string): boolean {
    for (const player of this.players.values()) if (player.id === playerId) return player.builder === true && player.key === key;
    return false;
  }

  /**
   * The key ledger takes a player's seat away: it was taken by another device
   * (or the key was replaced). In a paid world they go back to visiting, and
   * their page shows why, with a way to take it back; in a free one they play
   * on, free.
   */
  async demote(playerId: string): Promise<void> {
    for (const [ws, player] of this.players) {
      if (player.id !== playerId) continue;
      player.builder = !this.environment.paid;
      delete player.key;
      ws.serializeAttachment(player);
      if (!player.builder) this.release(player.id);
      send(ws, { t: "access", builder: player.builder, reason: "elsewhere" });
    }
  }

  /** An outdated page tried to build: everything in the action is refused (it is told to restart). */
  private refuseAll(ws: WebSocket, seq: unknown, list: unknown): void {
    if (!Number.isInteger(seq) || !Array.isArray(list)) return;
    send(ws, { t: "ack", seq: seq as number, rejected: list.map((_, i) => i), extra: [] });
    send(ws, { t: "update" });
  }

  // ── Who is really here ─────────────────────────────────────────────────

  /** Makes sure the sweep for silent connections is scheduled while anyone is connected. */
  private async keepWatch(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  /**
   * Every SWEEP_MS while anyone is connected: a connection not heard from for
   * STALE_MS (no heartbeat: the tab crashed, the laptop slept, the network
   * went) is closed and its builder leaves, so the count is right and nobody
   * lingers as a ghost. Heartbeats are answered by Cloudflare without waking
   * the world; it keeps when it last answered each socket.
   */
  override async alarm(): Promise<void> {
    const now = Date.now();
    for (const [ws, player] of [...this.players]) {
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      if (now - Math.max(pinged, player.joined ?? 0, this.heard.get(ws) ?? 0) <= STALE_MS) continue;
      try {
        ws.close(4001, "No heartbeat");
      } catch {
        // Already gone.
      }
      this.drop(ws);
    }
    if (this.players.size > 0) await this.ctx.storage.setAlarm(now + SWEEP_MS);
  }

  /** A visitor tried to build: everything in the action is refused. */
  private locked(ws: WebSocket, seq: unknown, list: unknown): void {
    if (!Number.isInteger(seq) || !Array.isArray(list)) return;
    send(ws, { t: "ack", seq: seq as number, rejected: list.map((_, i) => i), extra: [] });
    send(ws, { t: "denied", reason: "locked" });
  }

  // ── Chat ───────────────────────────────────────────────────────────────

  /**
   * Passes a message on, filtered: to builders within NEAR_RANGE of the
   * speaker, or to everyone. The speaker gets it back too, as others see it.
   * An empty text with a spot is a ping. Nothing is saved.
   */
  private say(ws: WebSocket, player: Attachment, rawText: unknown, rawTo: unknown, rawAt: unknown): void {
    const to = rawTo === "all" ? "all" : "near";
    const text = cleanChat(rawText);
    const from = player.move ? ([player.move[1] / 100, player.move[2] / 100, player.move[3] / 100] as Vec) : null;
    // A spot only for nearby messages, and not too far from the speaker.
    let at = to === "near" ? readVec(rawAt) : null;
    if (at && (!from || Math.hypot(at[0] - from[0], at[1] - from[1], at[2] - from[2]) > PIN_RANGE)) at = null;
    if (!text && !at) return;

    const now = Date.now();
    const times = this.talk.get(player.id) ?? [];
    this.talk.set(player.id, times);
    if (flooding(times, now)) return send(ws, { t: "hush", reason: "flood", wait: Math.ceil((times[0]! + FLOOD_MS - now) / 1000) });
    times.push(now);

    const said: WireSaid = { by: player.id, name: player.name, color: player.color, text, to };
    if (at) said.at = round(at);
    const message = JSON.stringify({ t: "said", ...said } satisfies ServerMessage);
    if (to === "all") {
      this.recentLines = [...this.recentLines.filter((l) => now - l.at < RECENT_MS), { at: now, said }].slice(-FEED_LINES);
    }
    for (const [other, p] of this.players) {
      if (to === "near" && other !== ws) {
        const m = p.move;
        if (!from || !m || Math.hypot(m[1] / 100 - from[0], m[2] / 100 - from[1], m[3] / 100 - from[2]) > NEAR_RANGE) continue;
      }
      try {
        other.send(message);
      } catch {
        // Closing; webSocketClose tidies up.
      }
    }
  }

  /** World-wide lines from the last RECENT_MS, oldest first. */
  private recent(): WireSaid[] {
    const now = Date.now();
    return this.recentLines.filter((l) => now - l.at < RECENT_MS).map((l) => l.said);
  }

  // ── Trebuchets ─────────────────────────────────────────────────────────

  /** Puts a builder on a trebuchet, if it is free and they are standing by it. */
  private board(ws: WebSocket, player: Attachment, id: unknown, at: unknown): void {
    const t = typeof id === "string" ? this.build.get(id) : undefined;
    if (!t || t.type !== "trebuchet") return send(ws, { t: "denied", reason: "gone" });
    const crew = this.crews.get(t.id);
    if (crew && crew !== player.id) return send(ws, { t: "denied", reason: "busy" });
    // Thrown or getting up: no climbing aboard until back on their feet.
    if (Date.now() < (this.downUntil.get(player.id) ?? 0)) return send(ws, { t: "denied", reason: "far" });
    const pos = readVec(at);
    const base = trebuchetBase(t);
    if (!pos || Math.hypot(pos[0] - base[0], pos[2] - base[2]) > this.environment.siege.boardReach + 1 || Math.abs(pos[1] - base[1]) > 4) {
      return send(ws, { t: "denied", reason: "far" });
    }
    if (crew === player.id) return;
    this.release(player.id);
    this.crews.set(t.id, player.id);
    this.crewOf.set(player.id, t.id);
    player.crew = t.id;
    player.readyAt = this.readyAt.get(t.id);
    ws.serializeAttachment(player);
    this.broadcast({ t: "crew", id: t.id, by: player.id });
  }

  /** Takes a builder off whatever trebuchet they are on. */
  private release(playerId: string): void {
    const id = this.crewOf.get(playerId);
    if (id === undefined) return;
    this.crewOf.delete(playerId);
    this.crews.delete(id);
    for (const [ws, player] of this.players) {
      if (player.id !== playerId) continue;
      delete player.crew;
      delete player.readyAt;
      ws.serializeAttachment(player);
    }
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
    const range = checkRange(t, target, this.environment);
    if (range !== "ok") return send(ws, { t: "denied", reason: range === "near" ? "near" : "range" });
    this.readyAt.set(t.id, now + this.environment.siege.reload * 1000);
    player.readyAt = now + this.environment.siege.reload * 1000;
    ws.serializeAttachment(player);
    const from = launchPoint(t, this.environment);
    const flight = planFlight(from, target, this.environment);
    const shot = this.nextShot++;
    this.broadcast({ t: "shot", shot, id: t.id, by: player.id, from: round(from), to: round(target) });
    this.followStone(shot, flight, t.id, player.id, this.whereItLands(flight, t.id).time, now);
  }

  /**
   * Waits for the stone to arrive, then checks again (the build may have
   * changed in flight): if what it was heading for has gone, it flies on.
   */
  private followStone(shot: number, flight: Flight, ignore: string, by: string, at: number, launched: number): void {
    const wait = Math.max(0, launched + at * 1000 - Date.now());
    setTimeout(() => {
      const impact = this.whereItLands(flight, ignore);
      if (impact.time > at + 0.02) return this.followStone(shot, flight, ignore, by, impact.time, launched);
      this.land(shot, impact.point, by);
    }, wait);
  }

  /** Where a shot comes down: the first piece or the ground (the shared rules), or something of the world's own before that. */
  private whereItLands(flight: Flight, ignore: string): { time: number; point: Vec } {
    const impact = findImpact(this.build, flight, ignore, this.environment);
    const own = serverOf(this.environment).shotHits?.(this.room(), flight);
    return own && own.time < impact.time ? own : impact;
  }

  /** A stone lands: everything in the blast takes a hit, what breaks goes, and what that strands falls. */
  private land(shot: number, point: Vec, by: string): void {
    const now = Date.now();
    const { broken, damaged } = strike(this.build, point, this.damage, this.environment);
    if (damaged.length > 0 || broken.length > 0) {
      this.damageDirty = true;
      this.scheduleFlush();
    }
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
    this.knock(point, [...gone, ...fallen]);
    serverOf(this.environment).struck?.(this.room(), point);
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
  private knock(point: Vec | null, gone: readonly Piece[]): void {
    const now = Date.now();
    if (gone.length > 0) serverOf(this.environment).removed?.(this.room(), gone);
    for (const player of this.players.values()) {
      const m = this.moves.get(player.id) ?? player.move;
      if (!m || now < (this.downUntil.get(player.id) ?? 0)) continue;
      const centre: Vec = [m[1] / 100, m[2] / 100, m[3] / 100];
      const v = point ? throwVelocity(point, centre, this.environment) : null;
      // Not thrown: only someone who was standing on (or right by) a piece that went can fall.
      // (Anyone else, mid-jump say, is left alone.)
      if (!v && !gone.some((p) => wasStandingOn(p, centre, this.environment))) continue;
      let fall = planFall(this.build, centre, v ?? [0, 0, 0], this.environment);
      // Still standing on something: no fall.
      // A small drop (a step, a trebuchet's base) is left to the builder's own physics:
      // only a real fall knocks them down.
      if (!v && centre[1] - fall.land[1] < this.environment.knockdownDrop) continue;
      // Thrown: the world may have a flight of its own for that (out into space and back, say).
      if (v) fall = serverOf(this.environment).thrown?.({ build: this.build, env: this.environment, playerId: player.id, from: centre, v, fall }, this.room()) ?? fall;
      this.fly(player, fall);
    }
  }

  /** Sends a builder along a flight: every page plays it, and where it ends is where they are. */
  private fly(player: Attachment, planned: Fall): void {
    const fall = { ...planned, path: planned.path.map(round), land: round(planned.land) };
    const yaw = (this.moves.get(player.id) ?? player.move)?.[4] ?? 0;
    this.release(player.id);
    this.downUntil.set(player.id, Date.now() + fallEnd(fall) * 1000);
    this.broadcast({ t: "thrown", id: player.id, path: fall.path, time: Math.round(fall.time * 1000) / 1000, land: fall.land, ...(fall.glideFrom === undefined ? {} : { glide: fall.glideFrom }) });
    // Where they come to rest is where they are (for anyone joining, and if their tab is asleep).
    setTimeout(() => {
      const move: WireMove = [player.id, Math.round(fall.land[0] * 100), Math.round(fall.land[1] * 100), Math.round(fall.land[2] * 100), yaw, 1];
      player.move = move;
      this.moves.set(player.id, move);
      this.quietTicks = 0;
      this.tickTimer ??= setInterval(() => this.tick(), TICK_MS);
      // The flight was planned when it began. If what they were to land on has gone since (shot
      // away while they were in the air), they are not left standing on nothing: on down they
      // go, to whatever is under them now, the same way they were coming down.
      if (![...this.players.values()].includes(player)) return;
      // (A flight that ends in the air on purpose leaves them there: from then on they fly themselves.)
      const on = planFall(this.build, fall.land, [0, 0, 0], this.environment);
      if (!planned.aloft && fall.land[1] - on.land[1] > 0.3) this.fly(player, fall.glideFrom === undefined ? on : { ...on, glideFrom: 0 });
    }, fall.time * 1000);
  }

  // ── The world's own rules ──────────────────────────────────────────────

  private theRoom: Room | null = null;

  /**
   * This room as its world's own server code sees it (see WorldServer): made
   * the first time it is needed, once the Worker has said which world this is.
   */
  private room(): Room {
    if (this.theRoom) return this.theRoom;
    const find = (id: string) => {
      for (const [ws, player] of this.players) if (player.id === id) return { ws, player };
      return null;
    };
    const room: Room = {
      env: this.environment,
      build: this.build,
      memory: undefined,
      players: () => [...this.players.values()].map((p) => p.id),
      positionOf: (id) => {
        const m = this.moves.get(id) ?? find(id)?.player.move;
        return m ? [m[1] / 100, m[2] / 100, m[3] / 100] : null;
      },
      isDown: (id) => Date.now() < (this.downUntil.get(id) ?? 0),
      send: (id, data) => {
        const to = find(id);
        if (to) send(to.ws, { t: "w", d: data });
      },
      broadcast: (data, exceptId) => this.broadcast({ t: "w", d: data }, exceptId === undefined ? undefined : find(exceptId)?.ws),
      fly: (id, fall) => {
        const who = find(id);
        if (who) this.fly(who.player, fall);
      },
      later: (ms, fn) => void setTimeout(fn, ms),
      mayBuild: (id) => find(id)?.player.builder === true,
      save: (name, value) => {
        if (/^[a-z0-9-]{1,40}$/.test(name)) this.ctx.storage.sql.exec("INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)", `world:${name}`, JSON.stringify(value));
      },
      load: (name) => {
        const row = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM state WHERE key = ?", `world:${name}`).toArray()[0];
        try {
          return row ? JSON.parse(row.value) : undefined;
        } catch {
          return undefined;
        }
      },
    };
    this.theRoom = room;
    room.memory = serverOf(this.environment).open?.(room);
    return room;
  }

  // ── Towers ─────────────────────────────────────────────────────────────

  /**
   * Measures the towers a moment after the build changes. Measuring searches
   * the whole world, so in a huge world it waits longer between measurements
   * (about 20 times as long as the last one took): the tower board then
   * updates less often instead of slowing everything else down.
   */
  private scheduleTowers(): void {
    this.towersTimer ??= setTimeout(() => {
      this.towersTimer = null;
      const started = Date.now();
      const next = this.measure();
      this.towersCost = Date.now() - started;
      if (JSON.stringify(next) === JSON.stringify(this.towers)) return;
      this.towers = next;
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO state (key, value) VALUES ('towers', ?)", JSON.stringify(next));
      this.broadcast({ t: "towers", list: next });
    }, Math.max(TOWERS_MS, this.towersCost * 20));
  }

  private measure(): WireTower[] {
    return measureTowers(this.build, 5).map((t) => [Math.round(t.height * 100) / 100, ...round(t.top), t.pieces]);
  }

  // ── Movement ───────────────────────────────────────────────────────────

  private move(player: Attachment, m: unknown): void {
    if (!Array.isArray(m) || m.length !== 5 || !m.every((v) => Number.isInteger(v))) return;
    const [x, y, z, yaw, flags] = m as number[];
    if (Math.abs(x!) > MAX_COORD || Math.abs(z!) > MAX_COORD || y! < -5_000 || y! > MAX_HEIGHT) return;
    const move: WireMove = [player.id, x!, y!, z!, yaw! % 6284, flags! & 7];
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
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    const env = sql.exec<{ value: string }>("SELECT value FROM state WHERE key = 'environment'").toArray()[0];
    if (env) {
      this.environment = worldOf(env.value);
      this.environmentKnown = true;
    }
    this.name = sql.exec<{ value: string }>("SELECT value FROM state WHERE key = 'name'").toArray()[0]?.value ?? "";
    // Hits taken by pieces that have not broken yet.
    const saved = sql.exec<{ value: string }>("SELECT value FROM state WHERE key = 'damage'").toArray()[0];
    if (saved) for (const [id, hits] of JSON.parse(saved.value) as [string, number][]) this.damage.set(id, hits);
    for (const row of sql.exec<{ data: string }>("SELECT data FROM chunks").toArray()) {
      for (const piece of decodePieces(JSON.parse(row.data) as WirePiece[])) this.build.apply({ kind: "place", piece });
    }
    this.loading = false;
    // Building rules change now and then: whatever no longer stands under the
    // current ones comes down when the world loads (and is saved that way).
    const now = Date.now();
    let cleaned = 0;
    for (const piece of findUnsupported(this.build)) {
      const op: BuildOp = { kind: "remove", id: piece.id };
      const inverse = this.build.apply(op);
      if (!inverse) continue;
      this.unsavedLog.push([now, "rules", encodeOp(op), encodeOp(inverse)]);
      cleaned++;
    }
    this.flush();
    // The last tower list saved, so waking up does not mean searching the whole world
    // (unless the clean-up just changed it, or there is none yet).
    const savedTowers = sql.exec<{ value: string }>("SELECT value FROM state WHERE key = 'towers'").toArray()[0];
    if (savedTowers && cleaned === 0) this.towers = JSON.parse(savedTowers.value) as WireTower[];
    else {
      this.towers = this.measure();
      sql.exec("INSERT OR REPLACE INTO state (key, value) VALUES ('towers', ?)", JSON.stringify(this.towers));
    }
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
      if (this.damage.delete(piece.id)) this.damageDirty = true;
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
    if (this.dirty.size === 0 && this.unsavedLog.length === 0 && !this.damageDirty) return;
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
      if (this.damageDirty) {
        // Only pieces still standing.
        const damage = [...this.damage].filter(([id]) => this.build.get(id));
        sql.exec("INSERT OR REPLACE INTO state (key, value) VALUES ('damage', ?)", JSON.stringify(damage));
      }
    });
    this.damageDirty = false;
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

/** True when a builder with body centre `c` was standing on, or right at the edge of, piece `p`. */
function wasStandingOn(p: Piece, c: Vec, env: Environment): boolean {
  const [x0, y0, z0, x1, y1, z1] = pieceBounds(p, env);
  const feet = c[1] - 0.9;
  const margin = 0.6;
  return c[0] > x0 - margin && c[0] < x1 + margin && c[2] > z0 - margin && c[2] < z1 + margin && feet > y0 - 0.5 && feet < y1 + 1.5;
}

/** A point in metres from a message, or null when malformed or far outside the world. */
function readVec(v: unknown): Vec | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [x, y, z] = v as number[];
  if (Math.abs(x!) > MAX_COORD / 100 || Math.abs(z!) > MAX_COORD / 100 || y! < -10 || y! > (MAX_LEVEL + 3) * LEVEL * 2) return null;
  return [x!, y!, z!];
}

const round = (v: Vec): [number, number, number] => [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100, Math.round(v[2] * 100) / 100];
