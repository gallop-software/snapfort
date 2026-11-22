import { describe, expect, it } from "vitest";
import { BuildState, type BuildOp } from "../src/game/buildState";
import { History } from "../src/game/history";
import { MATERIALS, PIECE_TYPES, type Piece, type PieceSpec, type Rot } from "../src/game/pieces";
import { findLooseAfterRemoval, findUnsupported } from "../src/game/structure";
import { applyAction } from "../src/net/authority";
import { chunkOf, cleanName, decodeOp, decodePiece, encodeOp, encodePiece } from "../src/net/protocol";
import { SyncedState } from "../src/net/sync";

const spec = (type: PieceSpec["type"], x: number, y: number, z: number, rot: Rot = 0): PieceSpec => ({ type, x, y, z, rot });
const piece = (s: PieceSpec, id: string, extra: Partial<Piece> = {}): Piece => ({ ...s, id, material: "wood", edit: 0, ...extra });
const place = (p: Piece): BuildOp => ({ kind: "place", piece: p });

const dump = (state: BuildState) =>
  [...state.all()].map((p) => `${p.id}:${p.type}:${p.x},${p.y},${p.z},${p.rot}:${p.material}:${p.edit}`).sort().join("\n");

/**
 * A tiny stand-in for the World Durable Object: applies each action in arrival
 * order with the same rules (support checked once the whole action is in, then
 * collapse), and tells everyone.
 */
class FakeServer {
  readonly state = new BuildState();
  private readonly clients: FakeClient[] = [];

  connect(client: FakeClient): void {
    this.clients.push(client);
    client.synced.reset([...this.state.all()]);
  }

  receive(from: FakeClient, seq: number, ops: BuildOp[]): void {
    const result = applyAction(this.state, ops);
    const done = result.done;
    const rejected = result.rejected;
    const extra = result.extra.map((e) => e.op);
    // Deliver through the wire format, as the real thing does.
    const wire = (list: BuildOp[]) => list.map((op) => decodeOp(JSON.parse(JSON.stringify(encodeOp(op))))!);
    from.inbox.push(() => from.synced.ack(seq, rejected, wire(extra)));
    const accepted = [...done.map((d) => d.op), ...extra];
    if (accepted.length === 0) return;
    for (const c of this.clients) if (c !== from) c.inbox.push(() => c.synced.remote(wire(accepted)));
  }
}

class FakeClient {
  readonly state = new BuildState();
  readonly synced = new SyncedState(this.state);
  readonly history = new History(this.synced);
  /** Messages from the server not yet delivered (the network is slow). */
  readonly inbox: (() => void)[] = [];

  constructor(private readonly server: FakeServer) {
    server.connect(this);
  }

  /** Sends what was applied since the last send. */
  send(): void {
    const action = this.synced.takeAction();
    if (action) this.server.receive(this, action.seq, action.ops);
  }

  deliver(): void {
    while (this.inbox.length) this.inbox.shift()!();
  }
}

describe("protocol", () => {
  it("round-trips pieces and operations", () => {
    const p = piece(spec("wall", -3, 2, 7, 1), "p1-a", { material: "metal", edit: 5 });
    expect(decodePiece(JSON.parse(JSON.stringify(encodePiece(p))))).toEqual(p);
    for (const op of [place(p), { kind: "remove", id: "p1-a" }, { kind: "edit", id: "p1-a", edit: 3 }] as BuildOp[]) {
      expect(decodeOp(JSON.parse(JSON.stringify(encodeOp(op))))).toEqual(op);
    }
  });

  it("rejects malformed input", () => {
    expect(decodePiece(["x", 9, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(decodePiece(["x", 0, 0.5, 0, 0, 0, 0, 0])).toBeNull();
    expect(decodePiece(["BAD ID", 0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(decodeOp(["e", "a", "1"])).toBeNull();
    expect(decodeOp(["z", "a"])).toBeNull();
    expect(decodeOp(null)).toBeNull();
  });

  it("cleans names and finds chunks", () => {
    expect(cleanName("  <b>Bob</b>   the  Builder!!  ")).toBe("bBobb the Builder");
    expect(cleanName("x".repeat(40))).toHaveLength(20);
    expect(chunkOf(0, 0)).toBe("0,0");
    expect(chunkOf(-1, 16)).toBe("-1,1");
  });
});

describe("collapse near removed pieces", () => {
  it("matches the full-world search on random builds", () => {
    let seed = 7;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let round = 0; round < 40; round++) {
      const state = new BuildState();
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const s = spec(PIECE_TYPES[Math.floor(r() * 4)]!, Math.floor(r() * 8) - 4, Math.floor(r() * 4), Math.floor(r() * 8) - 4, Math.floor(r() * 4) as Rot);
        if (state.canPlace(s).ok) state.apply(place(piece(s, `t-${n++}`, { material: MATERIALS[i % 3]! })));
      }
      // Start from a fully grounded world, as the real one is.
      for (const p of findUnsupported(state)) state.apply({ kind: "remove", id: p.id });
      const all = [...state.all()];
      const victims = all.filter(() => r() < 0.08);
      for (const v of victims) state.apply({ kind: "remove", id: v.id });
      const quick = findLooseAfterRemoval(state, victims).map((p) => p.id).sort();
      const full = findUnsupported(state).map((p) => p.id).sort();
      expect(quick).toEqual(full);
    }
  });
});

describe("building together", () => {
  it("shows one player's pieces to the other", () => {
    const server = new FakeServer();
    const a = new FakeClient(server);
    const b = new FakeClient(server);
    a.history.do(place(piece(spec("floor", 0, 0, 0), "a-0")));
    a.history.do(place(piece(spec("wall", 0, 0, 0), "a-1")));
    a.send();
    a.deliver();
    b.deliver();
    expect(dump(b.state)).toBe(dump(server.state));
    expect(dump(a.state)).toBe(dump(server.state));
    expect(server.state.size).toBe(2);
  });

  it("settles a race for the same slot on the server's choice", () => {
    const server = new FakeServer();
    const a = new FakeClient(server);
    const b = new FakeClient(server);
    // Both place a floor in the same spot before hearing from each other.
    a.history.do(place(piece(spec("floor", 1, 0, 1), "a-0", { material: "brick" })));
    b.history.do(place(piece(spec("floor", 1, 0, 1), "b-0", { material: "metal" })));
    a.send();
    b.send();
    // B hears about A's floor before the answer to its own.
    b.deliver();
    a.deliver();
    expect(dump(a.state)).toBe(dump(server.state));
    expect(dump(b.state)).toBe(dump(server.state));
    expect(server.state.get("a-0")).toBeDefined();
    expect(b.state.get("b-0")).toBeUndefined();
  });

  it("keeps edits in server order when two players edit one wall", () => {
    const server = new FakeServer();
    const a = new FakeClient(server);
    const b = new FakeClient(server);
    a.history.do(place(piece(spec("wall", 0, 0, 0), "a-0")));
    a.send();
    a.deliver();
    b.deliver();
    b.history.do({ kind: "edit", id: "a-0", edit: 2 });
    b.send();
    a.history.do({ kind: "edit", id: "a-0", edit: 16 });
    a.send();
    // A hears B's edit (which the server took first) before its own answer.
    a.deliver();
    b.deliver();
    expect(server.state.get("a-0")!.edit).toBe(16);
    expect(dump(a.state)).toBe(dump(server.state));
    expect(dump(b.state)).toBe(dump(server.state));
  });

  it("brings down what someone else's removal strands, everywhere", () => {
    const server = new FakeServer();
    const a = new FakeClient(server);
    const b = new FakeClient(server);
    a.history.do(place(piece(spec("wall", 0, 0, 0), "a-0")));
    a.history.do(place(piece(spec("floor", 0, 1, 0), "a-1")));
    a.history.do(place(piece(spec("wall", 0, 1, 0), "a-2")));
    a.send();
    a.deliver();
    b.deliver();
    // B removes the bottom wall but (being out of date) does not send the collapse itself.
    b.history.do({ kind: "remove", id: "a-0" });
    b.send();
    b.deliver();
    a.deliver();
    expect(server.state.size).toBe(0);
    expect(a.state.size).toBe(0);
    expect(b.state.size).toBe(0);
  });

  it("undoes a collapse in one action, top pieces first, without the server refusing them", () => {
    const server = new FakeServer();
    const a = new FakeClient(server);
    const b = new FakeClient(server);
    a.history.do(place(piece(spec("wall", 0, 0, 0), "a-0")));
    a.history.do(place(piece(spec("floor", 0, 1, 0), "a-1")));
    a.send();
    // Remove the wall and, in the same undo step, the floor it held up.
    a.history.do({ kind: "remove", id: "a-0" });
    a.history.extend({ kind: "remove", id: "a-1" });
    a.send();
    a.history.undo();
    a.send();
    a.deliver();
    b.deliver();
    expect(server.state.size).toBe(2);
    expect(dump(a.state)).toBe(dump(server.state));
    expect(dump(b.state)).toBe(dump(server.state));
  });

  it("puts a refused piece back out and reports it", () => {
    const server = new FakeServer();
    const a = new FakeClient(server);
    // Floating floor: fine to put back by undo locally, but the server needs support.
    a.synced.apply(place(piece(spec("floor", 3, 2, 3), "a-0")));
    a.send();
    let refused: BuildOp[] = [];
    const deliver = a.inbox.shift()!;
    const original = a.synced.ack.bind(a.synced);
    a.synced.ack = (seq, rejected, extra) => (refused = original(seq, rejected, extra));
    deliver();
    expect(refused).toHaveLength(1);
    expect(a.state.size).toBe(0);
  });

  it("resets to the server's world, changing only what differs", () => {
    const state = new BuildState();
    const synced = new SyncedState(state);
    const keep = piece(spec("floor", 0, 0, 0), "k");
    synced.apply(place(keep));
    synced.apply(place(piece(spec("floor", 1, 0, 0), "gone")));
    let changes = 0;
    state.subscribe(() => changes++);
    synced.reset([keep, piece(spec("wall", 2, 0, 2), "new")]);
    expect([...state.all()].map((p) => p.id).sort()).toEqual(["k", "new"]);
    expect(changes).toBe(2);
    expect(synced.inFlight).toBe(0);
  });

  it("stays in agreement through random play by three builders", () => {
    let seed = 99;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const server = new FakeServer();
    const clients = [0, 1, 2].map(() => new FakeClient(server));
    let n = 0;
    for (let step = 0; step < 3000; step++) {
      const c = clients[Math.floor(r() * clients.length)]!;
      const roll = r();
      if (roll < 0.5) {
        const s = spec(PIECE_TYPES[Math.floor(r() * 4)]!, Math.floor(r() * 6) - 3, Math.floor(r() * 3), Math.floor(r() * 6) - 3, Math.floor(r() * 4) as Rot);
        if (c.state.canPlace(s).ok) c.history.do(place(piece(s, `c${clients.indexOf(c)}-${n++}`)));
      } else if (roll < 0.7) {
        const all = [...c.state.all()];
        const victim = all[Math.floor(r() * all.length)];
        if (victim && c.history.do({ kind: "remove", id: victim.id })) {
          for (const p of findLooseAfterRemoval(c.state, [victim])) c.history.extend({ kind: "remove", id: p.id });
        }
      } else if (roll < 0.8) c.history.undo();
      else if (roll < 0.85) c.history.redo();
      else if (roll < 0.93) c.send();
      else c.deliver();
    }
    for (let i = 0; i < 3; i++) for (const c of clients) {
      c.send();
      c.deliver();
    }
    for (const c of clients) {
      c.deliver();
      expect(dump(c.state)).toBe(dump(server.state));
      expect(c.synced.inFlight).toBe(0);
    }
  });
});
