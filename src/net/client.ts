import type { BuildOp } from "../game/buildState";
import type { Piece } from "../game/pieces";
import type { Identity } from "../identity";
import {
  decodeOps,
  decodePieces,
  encodeOp,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type WireMove,
  type WirePlayer,
  type WireTower,
  type WireVec,
} from "./protocol";

export interface WelcomeExtras {
  crews: [string, string][];
  damage: [string, number][];
  towers: WireTower[];
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
  denied(reason: string): void;
}

/** How often this builder's position goes out while they move, ms. */
const MOVE_INTERVAL = 100;

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
  status: NetStatus = "connecting";

  constructor(
    private readonly url: string,
    private identity: Identity,
    private readonly handlers: NetHandlers,
  ) {}

  get online(): boolean {
    return this.status === "online";
  }

  connect(): void {
    this.setStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.raw({ t: "hello", v: PROTOCOL_VERSION, name: this.identity.name, color: this.identity.color });
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") this.receive(event.data);
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

  /** Sends one action (operations applied together). */
  sendAction(seq: number, ops: readonly BuildOp[]): void {
    this.raw({ t: "act", seq, ops: ops.map(encodeOp) });
  }

  /** Sends where this builder is, at most every 100 ms and only when it changed. */
  sendMove(x: number, y: number, z: number, yaw: number, onGround: boolean, now: number): void {
    if (!this.online || now - this.lastMoveAt < MOVE_INTERVAL) return;
    const yawMilli = Math.round((((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 1000);
    const m: [number, number, number, number, number] = [Math.round(x * 100), Math.round(y * 100), Math.round(z * 100), yawMilli, onGround ? 1 : 0];
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
        return h.welcome(msg.you, decodePieces(msg.pieces), msg.players, msg.moves, { crews: msg.crews ?? [], damage: msg.damage ?? [], towers: msg.towers ?? [] });
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
      case "denied":
        return h.denied(msg.reason);
      case "error":
        if (msg.reason === "full") this.setStatus("full");
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

/** The shared world's address on this site. */
export function worldUrl(): string {
  // A local dev server can open a separate world with ?world=<name> (the server ignores it elsewhere).
  const world = new URLSearchParams(location.search).get("world");
  const query = world ? `?world=${encodeURIComponent(world)}` : "";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${query}`;
}
