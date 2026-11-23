import type { BuildOp } from "../game/buildState";
import type { Fall } from "../game/fall";
import type { Piece } from "../game/pieces";
import type { Identity } from "../identity";
import type { ChatTo } from "./chat";
import {
  BUILD_ID,
  decodeOps,
  decodePieces,
  encodeOp,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type WireMove,
  type WirePlayer,
  type WireSaid,
  type WireTower,
  type WireVec,
} from "./protocol";

export interface WelcomeExtras {
  crews: [string, string][];
  damage: [string, number][];
  towers: WireTower[];
  /** World-wide chat lines from the last few seconds. */
  chat: WireSaid[];
  /** May you build here (false: visiting a paid world without the Full Game). */
  builder: boolean;
}

export type NetStatus = "connecting" | "online" | "offline" | "full" | "outdated";

export interface NetHandlers {
  status(status: NetStatus): void;
  /** Joined (or joined again): your id, the whole world and who is here. */
  welcome(you: string, pieces: Piece[], players: WirePlayer[], moves: WireMove[], extras: WelcomeExtras): void;
  /** The whole world again (after an admin reset or rollback, or when asked for). */
  snapshot(pieces: Piece[]): void;
  ops(by: string, ops: BuildOp[]): void;
  ack(seq: number, rejected: number[], extra: BuildOp[]): void;
  join(player: WirePlayer): void;
  leave(id: string): void;
  moves(moves: WireMove[]): void;
  crew(id: string, by: string | null): void;
  shot(shot: number, id: string, by: string, from: WireVec, to: WireVec): void;
  /** `ops` are applied like anyone's changes; this is told which pieces they remove first. */
  impact(shot: number, point: WireVec, ops: BuildOp[], fallen: string[], damage: [string, number][]): void;
  towers(list: WireTower[]): void;
  /** Builder `id` is thrown or falls along a planned flight. */
  thrown(id: string, fall: Fall): void;
  denied(reason: string): void;
  /** Someone (perhaps you) said something. */
  said(said: WireSaid): void;
  /** Your message was not passed on. */
  hush(reason: "flood", wait: number): void;
  /** Whether you may build here, after sending a key. */
  access(builder: boolean): void;
  /** A newer version of SnapFort is live: this page should restart. */
  update(): void;
}

/** How often this builder's position goes out while they move, ms. */
const MOVE_INTERVAL = 100;
/**
 * Heartbeat: a "ping" goes out this often (the server's edge answers "pong"
 * without waking the world), and a connection that has heard nothing for
 * DEAD_AFTER is taken for dead (a laptop that slept, a Wi-Fi switch) and
 * replaced.
 */
const PING_EVERY = 15_000;
const DEAD_AFTER = 45_000;
/** After coming back to the tab or the network, a pong must arrive this fast. */
const CHECK_WITHIN = 5_000;

/**
 * The connection to the shared world. Reconnects on its own (waiting a little
 * longer after each failure) and joins again with the same name and colour.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private retry = 500;
  private lastMoveAt = 0;
  private lastMove = "";
  private stopped = false;
  /** When anything last arrived (performance.now()). */
  private heardAt = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  status: NetStatus = "connecting";
  /** The SnapFort key sent on joining (lets its owner build in a paid world). */
  key: string | null = null;

  constructor(
    private readonly url: string,
    private identity: Identity,
    private readonly handlers: NetHandlers,
  ) {}

  get online(): boolean {
    return this.status === "online";
  }

  connect(): void {
    this.startHeartbeat();
    this.setStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.heardAt = performance.now();
      this.raw({ t: "hello", v: PROTOCOL_VERSION, name: this.identity.name, color: this.identity.color, build: pageBuild(), tab: tabId(), ...(this.key ? { key: this.key } : {}) });
    };
    ws.onmessage = (event) => {
      this.heardAt = performance.now();
      if (typeof event.data === "string" && event.data !== "pong") this.receive(event.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      if (this.status !== "full" && this.status !== "outdated") this.setStatus("offline");
      // A full world is worth trying again later; an outdated page needs a reload.
      if (this.status === "outdated") return;
      const wait = this.status === "full" ? 15_000 : this.retry;
      this.retry = Math.min(10_000, this.retry * 2);
      setTimeout(() => this.connect(), wait);
    };
  }

  /** Starts the heartbeat, and checks the connection on coming back to the tab or the network. */
  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (performance.now() - this.heardAt > DEAD_AFTER) return this.drop(ws);
      ws.send("ping");
    }, PING_EVERY);
    const check = () => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN || document.hidden) return;
      const asked = performance.now();
      ws.send("ping");
      setTimeout(() => {
        if (this.ws === ws && this.heardAt < asked) this.drop(ws);
      }, CHECK_WITHIN);
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
  }

  /** Gives up on a connection that has gone quiet, and connects again. */
  private drop(ws: WebSocket): void {
    if (this.ws !== ws) return;
    ws.onclose = null;
    ws.close();
    this.ws = null;
    this.setStatus("offline");
    setTimeout(() => this.connect(), 200);
  }

  /** Sends one action (operations applied together). */
  sendAction(seq: number, ops: readonly BuildOp[]): void {
    this.raw({ t: "act", seq, ops: ops.map(encodeOp) });
  }

  /** Sends where this builder is, at most every 100 ms and only when it changed. */
  sendMove(x: number, y: number, z: number, yaw: number, onGround: boolean, now: number, tumbling = false): void {
    if (!this.online || now - this.lastMoveAt < MOVE_INTERVAL) return;
    const yawMilli = Math.round((((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 1000);
    const m: [number, number, number, number, number] = [Math.round(x * 100), Math.round(y * 100), Math.round(z * 100), yawMilli, (onGround ? 1 : 0) | (tumbling ? 2 : 0)];
    const key = m.join(",");
    if (key === this.lastMove) return;
    this.lastMove = key;
    this.lastMoveAt = now;
    this.raw({ t: "move", m });
  }

  setIdentity(identity: Identity): void {
    this.identity = identity;
    this.raw({ t: "name", name: identity.name, color: identity.color });
  }

  board(id: string, at: WireVec): void {
    this.raw({ t: "board", id, at });
  }

  leaveTrebuchet(): void {
    this.raw({ t: "leave" });
  }

  fire(id: string, to: WireVec): void {
    this.raw({ t: "fire", id, to });
  }

  /** Says something to builders nearby or to everyone; an empty text with a spot is a ping. */
  say(text: string, to: ChatTo, at: WireVec | null): void {
    this.raw(at ? { t: "say", text, to, at } : { t: "say", text, to });
  }

  /** A key bought or typed in: remembered for joining, and sent now so building opens at once. */
  sendKey(key: string): void {
    this.key = key;
    this.raw({ t: "key", key });
  }

  requestSnapshot(): void {
    this.raw({ t: "sync" });
  }

  close(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private raw(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private receive(text: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    const h = this.handlers;
    switch (msg.t) {
      case "welcome":
        this.retry = 500;
        this.lastMove = "";
        this.setStatus("online");
        return h.welcome(msg.you, decodePieces(msg.pieces), msg.players, msg.moves, { crews: msg.crews ?? [], damage: msg.damage ?? [], towers: msg.towers ?? [], chat: msg.chat ?? [], builder: msg.builder ?? true });
      case "snap":
        return h.snapshot(decodePieces(msg.pieces));
      case "ops":
        return h.ops(msg.by, decodeOps(msg.ops));
      case "ack":
        return h.ack(msg.seq, msg.rejected, decodeOps(msg.extra));
      case "join":
        return h.join(msg.player);
      case "leave":
        return h.leave(msg.id);
      case "moves":
        return h.moves(msg.m);
      case "crew":
        return h.crew(msg.id, msg.by);
      case "shot":
        return h.shot(msg.shot, msg.id, msg.by, msg.from, msg.to);
      case "impact":
        return h.impact(msg.shot, msg.point, decodeOps(msg.ops), msg.fallen, msg.damage);
      case "towers":
        return h.towers(msg.list);
      case "thrown":
        return h.thrown(msg.id, { from: msg.path[0] ?? msg.land, v: [0, 0, 0], time: msg.time, land: msg.land, path: msg.path });
      case "denied":
        return h.denied(msg.reason);
      case "said": {
        const { t: _t, ...said } = msg;
        return h.said(said);
      }
      case "hush":
        return h.hush(msg.reason, msg.wait ?? 0);
      case "access":
        return h.access(msg.builder);
      case "update":
        return h.update();
      case "error":
        if (msg.reason === "full") this.setStatus("full");
        // The server is on an older protocol than this page: it is about to be updated (a deploy
        // takes a minute to reach every world). Keep trying instead of asking for a restart.
        else if (msg.reason === "version" && (msg.v ?? 0) < PROTOCOL_VERSION) this.retry = 3_000;
        else if (msg.reason === "version") this.setStatus("outdated");
        return;
    }
  }

  private setStatus(status: NetStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.handlers.status(status);
  }
}

/** This page's build; on a dev server ?build=<x> pretends to be another one (to try the update notice). */
export function pageBuild(): string {
  return (import.meta.env.DEV && new URLSearchParams(location.search).get("build")) || BUILD_ID;
}

/**
 * This browser tab's id: the same across reloads and world switches (it lives
 * in sessionStorage), different in every other tab. Joining again from the
 * same tab replaces the old connection, so nobody is ever seen twice.
 */
export function tabId(): string {
  let id = sessionStorage.getItem("snapfort.tab");
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join("");
    sessionStorage.setItem("snapfort.tab", id);
  }
  return id;
}

/** The shared world's address on this site. */
export function worldUrl(env = "meadow"): string {
  const params = new URLSearchParams();
  if (env !== "meadow") params.set("env", env);
  // A local dev server can open a separate world with ?world=<name> (the server ignores it elsewhere).
  const world = new URLSearchParams(location.search).get("world");
  if (world) params.set("world", world);
  const query = params.size ? `?${params}` : "";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${query}`;
}
