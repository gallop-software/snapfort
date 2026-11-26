import { CELL, LEVEL } from "../../game/constants";
import { planFall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { throwVelocity, type Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { Bots } from "./ai";
import { BUILDING_KINDS, BUILDINGS, LEAVE_GRACE, MAX_UNITS, ROUTED_WAIT, UNIT_KINDS, UNITS, UPGRADES, type BuildingKind, type UnitKind } from "./kit";
import { mid, STARTS } from "./map";
import { DT, NEUTRAL, emptyHappened, Sim, T_BUILDING, T_GENERAL, T_PIECE, T_UNIT, type Building, type General, type Order, type TargetKind, type Unit } from "./sim";
import { F_DEPLOYED, F_DIGGING, F_DOWN, F_FIRING, F_HIT, F_LOADED, F_MOVING, F_STUNNED, LOOKS, type ToPage, type ToServer, type WireBuilding, type WireGeneral } from "./wire";
import { HALF_CELLS } from "./world";

/**
 * The war, in a room: this runs the simulation (sim.ts) ten times a second
 * while a person commands, takes the generals' orders, and tells each page
 * what its general can see and nothing more (an enemy out of sight is never
 * sent, so nobody can see further by tampering with their page).
 *
 * There are always eight generals. A computer plays every place no person
 * holds; a person coming in takes a computer's place over as it stands, and a
 * computer takes theirs when they go. With nobody here the war is paused,
 * kept as it stands. Someone there is no place for (eight people already, or
 * no Full Game) is told so and sent nothing of the war: nobody watches.
 */

/** A page connected to the room. */
interface Viewer {
  pid: string;
  /** The general they are, or -1 (there is no place for them: they are sent nothing of the war). */
  slot: number;
  /** What they were last told of who they are (so it is said once). */
  told: string;
  /** What was last sent of each unit they know of: two numbers that change when anything shown does. */
  sentA: Map<number, number>;
  sentB: Map<number, number>;
  /** The buildings they know of, and at what revision. */
  sentBuildings: Map<number, number>;
  /** Buildings that have gone while out of their sight: where they stood. They are told when they next look there. */
  ghosts: Map<number, [number, number, number]>;
  bank: string;
  /** For the load test only (a test room): sent every unit and building in the world, in sight or not. */
  all: boolean;
}

interface War {
  sim: Sim;
  bots: Bots;
  viewers: Map<string, Viewer>;
  running: boolean;
  /** When the last step was taken (ms). */
  last: number;
  /** The computer generals do nothing new (for checks: a quiet map). */
  quiet: boolean;
  savedAt: number;
  gens: string;
  /** What was last sent of each field. */
  fieldSent: Map<number, number>;
  /** Steps of game per step of the clock (checks may run it faster). */
  speed: number;
  swept: boolean;
  /** Since when no page has been connected to the room (ms), or 0. */
  empty: number;
  /** How long steps have been taking (for the load test): how many, the milliseconds in all, the worst, and the characters sent. */
  perf: { steps: number; ms: number; worst: number; sent: number };
}

const STEP_MS = DT * 1000;
/** Units and what happened go out every this many steps. */
const SEND_EVERY = 2;
const SAVE_MS = 10_000;
const HALF_DM = HALF_CELLS * 50;

const war = (room: Room) => room.memory as War;

export function openWar(room: Room): War {
  const sim = new Sim(room.build, room.env, {
    positionOf: (pid) => room.positionOf(pid),
    isDown: (pid) => room.isDown(pid),
    throwBuilder: (pid, from) => {
      const at = room.positionOf(pid);
      if (!at) return;
      // Thrown as by a stone landing there; from further off than a stone throws, a smaller toss the same way.
      const flat = Math.hypot(at[0] - from[0], at[2] - from[2]) || 1;
      const v: Vec = throwVelocity(from, at, room.env) ?? [((at[0] - from[0]) / flat) * 9, 16, ((at[2] - from[2]) / flat) * 9];
      room.fly(pid, planFall(room.build, at, v, room.env));
    },
    wear: (point, hits, by) => room.wear?.(point, hits, by),
    removePieces: (ids, by) => room.remove?.(ids, by),
  });
  const w: War = { sim, bots: new Bots(sim), viewers: new Map(), running: false, last: 0, quiet: false, savedAt: 0, gens: "", fieldSent: new Map(), speed: 1, swept: false, empty: 0, perf: { steps: 0, ms: 0, worst: 0, sent: 0 } };
  // The war is taken up where it was left, however long ago: it has no end.
  const saved = room.load("war") as { at?: number; sim?: unknown } | undefined;
  if (saved && typeof saved.at === "number" && sim.restore(saved.sim)) {
    // Whoever commanded when the room went to sleep and is no longer connected has left: a computer has their place.
    const here = new Set(room.players());
    for (const g of sim.generals) if (g?.pid && !here.has(g.pid)) sim.leave(g.pid);
    w.swept = true;
  } else sim.postSentries(true);
  // Eight generals, always: a computer on every place that has none.
  sim.fill();
  return w;
}

const newViewer = (pid: string): Viewer => ({ pid, slot: -1, told: "", sentA: new Map(), sentB: new Map(), sentBuildings: new Map(), ghosts: new Map(), bank: "", all: false });
const fieldsFor = (w: War): ToPage => ({ m: "fields", f: w.sim.fields.map((f) => [f.id, f.kind === "crystal" ? 0 : 1, f.cx, f.cz, Math.round(f.amount), f.full]) });

/**
 * Everyone connected has a viewer. (A room that slept, or was moved onto new
 * code, wakes with its pages still connected and no memory of them.)
 */
function everyoneViews(room: Room): void {
  const w = war(room);
  for (const pid of room.players()) {
    if (w.viewers.has(pid)) continue;
    const viewer = newViewer(pid);
    viewer.slot = w.sim.generalOf(pid)?.slot ?? -1;
    w.viewers.set(pid, viewer);
    enlist(room, viewer);
    w.gens = "";
  }
  for (const pid of [...w.viewers.keys()]) if (!room.players().includes(pid)) w.viewers.delete(pid);
}

/** A builder has joined: a general at once, in a computer's place, if they may command and a person does not hold every place. */
export function warJoined(room: Room, pid: string): void {
  const w = war(room);
  if (!w.swept) {
    // A war begun afresh: nothing built before it is left standing (it would be nobody's).
    w.swept = true;
    const left = [...room.build.all()].map((p) => p.id);
    if (left.length > 0) room.remove?.(left, "left");
  }
  // (Nobody builds a siege engine here any more: one left standing from before is taken away.)
  const engines = [...room.build.all()].filter((p) => p.type === "trebuchet").map((p) => p.id);
  if (engines.length > 0) room.remove?.(engines, "left");
  const viewer = newViewer(pid);
  w.viewers.set(pid, viewer);
  enlist(room, viewer);
  w.gens = "";
  everyoneViews(room);
  run(room);
}

/** Where a general stands on arriving: before their Core, on the side toward the middle of the map. */
function arrival(sim: Sim, g: General): [number, number] {
  let core: Building | null = null;
  for (const b of sim.buildings.values()) if (b.owner === g.slot && !b.dead && b.kind === "core" && (!core || b.id < core.id)) core = b;
  if (!core) return [...STARTS[g.start]!.spawn] as [number, number];
  const c = sim.centreOf(core);
  const d = Math.hypot(c[0], c[2]) || 1;
  // (Four cells from its middle: clear of its walls, with the whole of it in view.)
  return [c[0] - (c[0] / d) * 4 * CELL, c[2] - (c[2] / d) * 4 * CELL];
}

/**
 * Makes someone a general if they may command and there is a place, and tells
 * them who they are (once: again only when that changes).
 */
function enlist(room: Room, viewer: Viewer): void {
  const w = war(room);
  let why: "full" | "visitor" | undefined;
  if (viewer.slot < 0) {
    if (!room.mayBuild(viewer.pid)) why = "visitor";
    else {
      const g = w.sim.join(viewer.pid, room.who?.(viewer.pid)?.name ?? "General", room.tabOf?.(viewer.pid) ?? null);
      if (g) viewer.slot = g.slot;
      else why = "full";
    }
  }
  const g = viewer.slot >= 0 ? w.sim.generals[viewer.slot] : null;
  const told = `${viewer.slot}|${why ?? ""}`;
  if (told === viewer.told) return;
  viewer.told = told;
  room.send(viewer.pid, { m: "you", slot: viewer.slot, ...(why ? { why } : {}), ...(g ? { start: arrival(w.sim, g), pids: g.pids } : {}) } satisfies ToPage);
  // A new side: everything it may see is sent afresh.
  viewer.sentA.clear();
  viewer.sentB.clear();
  viewer.sentBuildings.clear();
  viewer.ghosts.clear();
  viewer.bank = "";
  if (g) {
    room.send(viewer.pid, fieldsFor(w));
    w.gens = "";
  }
}

export function warLeft(room: Room, pid: string): void {
  const w = war(room);
  w.viewers.delete(pid);
  w.sim.leave(pid);
  w.gens = "";
}

/** Runs the war while a person commands. With nobody, it is paused: kept exactly as it stands. */
function run(room: Room): void {
  const w = war(room);
  if (w.running) return;
  if (!w.sim.generals.some((g) => g?.pid)) return;
  w.running = true;
  w.last = Date.now();
  w.empty = 0;
  const stop = () => {
    w.running = false;
    w.sim.forgetPaths();
    w.sim.happened = emptyHappened();
    save(room);
  };
  const loop = () => {
    try {
      const now = Date.now();
      // With no page connected at all for longer than anyone is given to come back, there is nobody to run it for,
      // whatever the war itself believes (a room moved onto new code can be left holding generals who never "left").
      if (room.players().length > 0) w.empty = 0;
      else if (w.empty === 0) w.empty = now;
      else if (now - w.empty > (LEAVE_GRACE + 30) * 1000) for (const g of w.sim.generals) if (g?.pid) w.sim.leave(g.pid);
      if (!w.sim.generals.some((g) => g?.pid)) return stop();
      const due = Math.floor(((now - w.last) / STEP_MS) * w.speed);
      let steps = Math.min(4, due);
      // (Far behind, after a hiccup: the lost time is let go.)
      if (due > 8) w.last = now;
      else w.last += (steps * STEP_MS) / w.speed;
      for (; steps > 0; steps--) step(room);
      if (now - w.savedAt > SAVE_MS) save(room);
    } catch (error) {
      // A fault in the war must never leave it running wild, or hold the room up: it is written down, and the war begins afresh.
      console.error("The war stopped on a fault:", error);
      w.running = false;
      try {
        for (const g of w.sim.generals) if (g) w.sim.wipe(g.slot);
        w.sim.fill();
        for (const v of w.viewers.values()) {
          v.slot = -1;
          v.told = "";
          enlist(room, v);
        }
        save(room);
        room.broadcast({ m: "note", kind: "attack", text: "The war was stopped by a fault on the server, and has begun afresh. Sorry!" } satisfies ToPage);
        room.later(STEP_MS, () => run(room));
      } catch {
        // Nothing more to be done.
      }
      return;
    }
    room.later(STEP_MS / 2, loop);
  };
  room.later(STEP_MS, loop);
}

function save(room: Room): void {
  const w = war(room);
  w.savedAt = Date.now();
  room.save("war", { at: w.savedAt, sim: w.sim.snapshot() });
}

function step(room: Room): void {
  const w = war(room);
  const sim = w.sim;
  const began = performance.now();
  sim.tick();
  if (sim.step % 10 === 0) everySecond(room);
  if (sim.step % 20 === 5 && !w.quiet) w.bots.think();
  if (sim.step % SEND_EVERY === 0) {
    sendAll(room);
    sim.happened = emptyHappened();
  }
  const took = performance.now() - began;
  w.perf.steps++;
  w.perf.ms += took;
  w.perf.worst = Math.max(w.perf.worst, took);
}

/** Once a second: places that have opened, names that have changed, the list of generals. */
function everySecond(room: Room): void {
  const w = war(room);
  const sim = w.sim;
  // (A place emptied, by a check or a fault, has a computer again.)
  sim.fill();
  for (const v of w.viewers.values()) {
    // Their general is someone else's now (they were away too long): they wait for a place like anyone.
    if (v.slot >= 0 && sim.generals[v.slot]?.pid !== v.pid) v.slot = -1;
    // Someone waiting for a place takes the first that opens.
    if (v.slot < 0) enlist(room, v);
    const g = v.slot >= 0 ? sim.generals[v.slot] : null;
    const who = g ? room.who?.(v.pid) : null;
    if (g && who && g.name !== who.name) g.name = who.name;
  }
  const gens: WireGeneral[] = sim.generals.flatMap((g) => (g ? [{ slot: g.slot, pid: g.pid ?? "", name: g.name, color: g.color, ai: g.ai }] : []));
  const text = JSON.stringify(gens);
  if (text !== w.gens) {
    w.gens = text;
    for (const v of w.viewers.values()) if (v.slot >= 0) room.send(v.pid, { m: "gens", g: gens } satisfies ToPage);
  }
}

// ── What each page is told ────────────────────────────────────────────────

const dm = (v: number) => Math.round(v * 10);

function flagsOf(sim: Sim, u: Unit): number {
  return (
    (u.goal && !u.arrived ? F_MOVING : 0) |
    (u.tk ? F_FIRING : 0) |
    (u.deployedAt > 0 && sim.t >= u.deployedAt ? F_DEPLOYED : 0) |
    (sim.t < u.stunUntil ? F_STUNNED : 0) |
    (sim.t < u.downUntil ? F_DOWN : 0) |
    (u.carry > 0 ? F_LOADED : 0) |
    (u.phase === 2 && (u.order.k === "gather" || u.order.k === "return") ? F_DIGGING : 0) |
    (sim.t < u.hitUntil ? F_HIT : 0)
  );
}

function wireBuilding(sim: Sim, b: Building): WireBuilding {
  const def = BUILDINGS[b.kind];
  return {
    i: b.id, k: BUILDING_KINDS.indexOf(b.kind), o: b.owner, x: b.cx, z: b.cz, h: Math.max(1, Math.round((b.hp / def.hp) * 100)),
    d: b.doneAt === 0 ? 0 : Math.max(0.1, Math.round((b.doneAt - sim.t) * 10) / 10),
    q: b.queue.map((q) => UNIT_KINDS.indexOf(q.kind)), ql: b.queue[0] ? Math.round(b.queue[0].left * 10) / 10 : 0,
    r: b.research ? UPGRADES.indexOf(b.research.kind) + 1 : 0, rl: b.research ? Math.round(b.research.left) : 0,
    ...(b.rally ? { rx: Math.round(b.rally.x), rz: Math.round(b.rally.z) } : {}),
    st: Math.max(0, Math.round(b.stunUntil - sim.t)),
  };
}

function sendAll(room: Room): void {
  const w = war(room);
  const sim = w.sim;
  const h = sim.happened;
  // Every unit's numbers, worked out once for everyone.
  const wire = new Map<number, number[]>();
  const hashA = new Map<number, number>(), hashB = new Map<number, number>();
  for (const u of sim.units) {
    if (u.dead || u.inside) continue;
    const x = dm(u.x), y = dm(u.y), z = dm(u.z);
    const heading = Math.round(((((u.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 255) & 255;
    const hp = Math.max(1, Math.round((u.hp / UNITS[u.kind].hp) * 100));
    const flags = flagsOf(sim, u);
    const extra = u.kind === "transport" ? u.cargo.length : Math.round(u.carry);
    wire.set(u.id, [u.id, UNIT_KINDS.indexOf(u.kind) * 16 + u.owner, x, y, z, heading, hp, flags, extra]);
    hashA.set(u.id, ((x + HALF_DM) * (HALF_DM * 2 + 1) + (z + HALF_DM)) * 4096 + Math.max(0, Math.min(4095, y)));
    hashB.set(u.id, ((heading * 128 + hp) * 256 + flags) * 256 + extra);
  }
  // Fields whose contents changed (to the nearest ten).
  const fields: number[] = [];
  if (sim.step % 20 === 0) {
    for (const f of sim.fields) {
      const amount = Math.round(f.amount / 10) * 10;
      if (w.fieldSent.get(f.id) !== amount) {
        w.fieldSent.set(f.id, amount);
        fields.push(f.id, amount);
      }
    }
  }
  for (const v of w.viewers.values()) {
    const g = v.slot >= 0 ? sim.generals[v.slot] : null;
    // (Someone who is not a general is sent nothing of the war.)
    if (!g) continue;
    const team = g.team;
    const seesSpot = (x: number, z: number) => v.all || sim.sees(team, x, z);
    const mine = (owner: number) => owner === g.slot;
    const out: Extract<ToPage, { m: "tick" }> = { m: "tick", t: sim.t };

    const u: number[] = [], x: number[] = [];
    for (const unit of sim.units) {
      if (unit.dead) continue;
      const seen = !unit.inside && (v.all || mine(unit.owner) || sim.sees(team, unit.x, unit.z));
      if (!seen) {
        if (v.sentA.delete(unit.id)) {
          v.sentB.delete(unit.id);
          x.push(unit.id, 0);
        }
        continue;
      }
      const a = hashA.get(unit.id)!, b = hashB.get(unit.id)!;
      if (v.sentA.get(unit.id) === a && v.sentB.get(unit.id) === b) continue;
      v.sentA.set(unit.id, a);
      v.sentB.set(unit.id, b);
      u.push(...wire.get(unit.id)!);
    }
    const bx: number[] = [];
    for (const gone of h.gone) {
      if (gone.unit) {
        if (v.sentA.delete(gone.id)) {
          v.sentB.delete(gone.id);
          x.push(gone.id, gone.left ? 2 : 1);
        }
      } else if (v.sentBuildings.has(gone.id)) {
        // Seen to go, or learnt of the next time they look there.
        if (mine(gone.owner) || seesSpot(gone.at[0], gone.at[2])) {
          v.sentBuildings.delete(gone.id);
          bx.push(gone.id, gone.left ? 2 : 1);
        } else v.ghosts.set(gone.id, [gone.at[0], gone.at[2], gone.left ? 2 : 1]);
      }
    }
    for (const [id, [gx, gz, why]] of v.ghosts) {
      if (!seesSpot(gx, gz)) continue;
      v.ghosts.delete(id);
      v.sentBuildings.delete(id);
      bx.push(id, why);
    }
    const b: WireBuilding[] = [];
    for (const building of sim.buildings.values()) {
      if (v.sentBuildings.get(building.id) === building.rev) continue;
      const c = sim.centreOf(building);
      if (!mine(building.owner) && !seesSpot(c[0], c[2])) continue;
      v.sentBuildings.set(building.id, building.rev);
      b.push(wireBuilding(sim, building));
    }
    if (u.length) out.u = u;
    if (x.length) out.x = x;
    if (b.length) out.b = b;
    if (bx.length) out.bx = bx;

    const s: number[] = [];
    for (const shot of h.shots) {
      if (!seesSpot(shot.from[0], shot.from[2]) && !seesSpot(shot.to[0], shot.to[2])) continue;
      s.push(dm(shot.from[0]), dm(shot.from[1]), dm(shot.from[2]), dm(shot.to[0]), dm(shot.to[1]), dm(shot.to[2]), LOOKS.indexOf(shot.look), Math.round(shot.time * 10), shot.owner, shot.hit);
    }
    if (s.length) out.s = s;
    const k: number[] = [];
    for (const t of h.tumbles) if (v.sentA.has(t.id)) k.push(t.id, dm(t.from[0]), dm(t.from[1]), dm(t.from[2]), dm(t.to[0]), dm(t.to[1]), dm(t.to[2]), Math.round(t.time * 10));
    if (k.length) out.k = k;
    const bl: number[] = [];
    for (const blast of h.blasts) if (seesSpot(blast.at[0], blast.at[2])) bl.push(dm(blast.at[0]), dm(blast.at[1]), dm(blast.at[2]), dm(blast.radius));
    if (bl.length) out.bl = bl;
    const p: number[] = [];
    for (const pulse of h.pulses) if (seesSpot(pulse.x, pulse.z)) p.push(Math.round(pulse.x), Math.round(pulse.z));
    if (p.length) out.p = p;
    const zz: number[] = [];
    for (const zap of h.zaps) if (seesSpot(zap.to[0], zap.to[2])) zz.push(...zap.from.map(dm), ...zap.to.map(dm));
    if (zz.length) out.z = zz;
    if (fields.length) out.f = fields;
    room.send(v.pid, out satisfies ToPage);
    w.perf.sent += u.length * 5 + s.length * 4 + 40;

    for (const note of h.notes) if (note.slot === g.slot) room.send(v.pid, { m: "note", text: note.text, kind: note.kind, ...(note.x === undefined ? {} : { x: Math.round(note.x), z: Math.round(note.z ?? 0) }) } satisfies ToPage);
    const routed = g.routedAt > 0 ? Math.max(0, Math.ceil(ROUTED_WAIT - (sim.t - g.routedAt))) : -1;
    const bank: Extract<ToPage, { m: "res" }> = { m: "res", l: Math.floor(g.lithium), p: Math.floor(g.plasma), used: sim.supplyUsed(g.slot), max: sim.supplyMax(g.slot), up: [g.upgrades.weapons, g.upgrades.armour], routed };
    const text = JSON.stringify(bank);
    if (text !== v.bank) {
      v.bank = text;
      room.send(v.pid, bank satisfies ToPage);
    }
  }
}

// ── Orders from pages ─────────────────────────────────────────────────────

const isInt = (v: unknown): v is number => Number.isInteger(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function spot(v: unknown): [number, number, number] | null {
  return Array.isArray(v) && v.length === 3 && v.every(num) ? (v as [number, number, number]) : null;
}

function idList(v: unknown): number[] | null {
  return Array.isArray(v) && v.length > 0 && v.length <= 400 && v.every(isInt) ? (v as number[]) : null;
}

/** A message from a general's page: anything at all, so everything is checked. */
export function warMessage(room: Room, pid: string, data: unknown): void {
  const w = war(room);
  const sim = w.sim;
  if (typeof data !== "object" || data === null) return;
  const msg = data as Partial<ToServer> & Record<string, unknown>;
  if (!w.viewers.has(pid)) {
    everyoneViews(room);
    run(room);
  }
  const g = sim.generalOf(pid);
  if (msg.m === "dev") return void (room.test?.() === true && devMessage(room, pid, g, msg));
  if (!g) return;
  const refuse = (why: string) => {
    if (why) room.send(pid, { m: "no", text: why } satisfies ToPage);
  };
  switch (msg.m) {
    case "order": {
      const ids = idList(msg.ids);
      if (!ids) return;
      const order = readOrder(sim, msg);
      if (order) refuse(sim.command(g.slot, ids, order, msg.q === true));
      return;
    }
    case "build":
      if (!BUILDING_KINDS.includes(msg.kind as BuildingKind) || !isInt(msg.x) || !isInt(msg.z)) return;
      return refuse(sim.orderBuilding(g.slot, msg.kind as BuildingKind, msg.x, msg.z));
    case "make":
      if (!isInt(msg.id) || !UNIT_KINDS.includes(msg.kind as UnitKind)) return;
      return refuse(sim.make(g.slot, msg.id, msg.kind as UnitKind, isInt(msg.n) ? msg.n : 1));
    case "cancel":
      return isInt(msg.id) ? refuse(sim.cancel(g.slot, msg.id)) : undefined;
    case "research":
      if (!isInt(msg.id) || !UPGRADES.includes(msg.kind as (typeof UPGRADES)[number])) return;
      return refuse(sim.research(g.slot, msg.id, msg.kind as (typeof UPGRADES)[number]));
    case "rally": {
      const ids = idList(msg.ids), at = spot(msg.at);
      if (ids && at) sim.rally(g.slot, ids, at[0], at[1], at[2]);
      return;
    }
    case "scrap":
      return isInt(msg.id) ? refuse(sim.scrap(g.slot, msg.id)) : undefined;
  }
}

function readOrder(sim: Sim, msg: Record<string, unknown>): Order | null {
  const at = spot(msg.at);
  const level = (y: number) => Math.max(0, Math.min(80, Math.floor((y + 0.6) / LEVEL)));
  switch (msg.k) {
    case "stop":
      return { k: "stop" };
    case "hold":
      return { k: "hold" };
    case "return":
      return { k: "return" };
    case "move":
    case "amove":
      return at ? { k: msg.k, x: at[0], z: at[2], l: level(at[1]) } : null;
    case "patrol": {
      // Back and forth between there and where the first of them stands now.
      const first = Array.isArray(msg.ids) ? sim.unitById.get(msg.ids[0] as number) : undefined;
      return at && first ? { k: "patrol", x: at[0], z: at[2], l: level(at[1]), bx: first.x, bz: first.z, bl: first.level } : null;
    }
    case "unload":
    case "emp":
      return at ? { k: msg.k, x: at[0], z: at[2] } : null;
    case "gather":
      return isInt(msg.field) ? { k: "gather", field: msg.field } : null;
    case "load":
      return isInt(msg.into) ? { k: "load", into: msg.into } : null;
    case "attack": {
      const on = msg.on;
      if (!Array.isArray(on) || on.length !== 2) return null;
      const [tk, id] = on as [unknown, unknown];
      if ((tk === T_UNIT || tk === T_BUILDING || tk === T_GENERAL) && isInt(id)) return { k: "attack", tk: tk as TargetKind, id };
      if (tk === T_PIECE && typeof id === "string" && id.length <= 24) return { k: "attack", tk: T_PIECE, id };
      return null;
    }
  }
  return null;
}

/** For checks, on a developer's own computer only: money, units out of nowhere, a full-size battle. */
function devMessage(room: Room, pid: string, g: General | null, msg: Record<string, unknown>): void {
  const w = war(room);
  const sim = w.sim;
  if (msg.do === "speed" && num(msg.n)) w.speed = Math.max(0.1, Math.min(20, msg.n));
  if (msg.do === "perf") {
    // How the server is doing, and afresh from here.
    const p = w.perf;
    room.send(pid, { m: "note", kind: "info", text: `perf ${JSON.stringify({ units: sim.units.length, steps: p.steps, mean: p.steps ? Math.round((p.ms / p.steps) * 100) / 100 : 0, worst: Math.round(p.worst * 10) / 10, sentKb: Math.round(p.sent / 1024), viewers: w.viewers.size })}` } satisfies ToPage);
    w.perf = { steps: 0, ms: 0, worst: 0, sent: 0 };
  }
  // The computers do nothing new (a quiet map for a check), or play again.
  if (msg.do === "quiet") w.quiet = msg.on !== false;
  // The most a page could ever be asked to draw: everything in the world, whoever sees it (the load test measures that).
  if (msg.do === "all") {
    const v = w.viewers.get(pid);
    if (v) v.all = msg.on !== false;
  }
  if (!g) return;
  const slot = isInt(msg.slot) && msg.slot >= 0 && msg.slot <= NEUTRAL ? msg.slot : g.slot;
  if (msg.do === "fresh") {
    // This general's place as a war begins it: a Core, four Haulers, the first lithium, nothing else.
    const tab = g.tab, name = g.name, at = g.slot;
    sim.wipe(at);
    sim.seat(at);
    const mine = sim.take(at, pid, name, tab);
    const v = w.viewers.get(pid);
    if (mine && v) {
      v.told = "";
      enlist(room, v);
    }
  } else if (msg.do === "rich") {
    g.lithium += 20_000;
    g.plasma += 20_000;
  } else if (msg.do === "spawn" && UNIT_KINDS.includes(msg.kind as UnitKind)) {
    const at = spot(msg.at) ?? room.positionOf(pid) ?? [0, 0, 0];
    const n = isInt(msg.n) ? Math.min(400, msg.n) : 1;
    const side = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n && sim.units.length < MAX_UNITS; i++) sim.addUnit(msg.kind as UnitKind, slot, at[0] + ((i % side) - side / 2) * 3, at[2] + (Math.floor(i / side) - side / 2) * 3);
  } else if (msg.do === "kill") {
    for (const u of [...sim.units]) if (u.owner === slot) sim.kill(u, false);
  } else if (msg.do === "stress") {
    // All eight generals with a full army each, all sent to the middle.
    const kinds: UnitKind[] = ["trooper", "trooper", "trooper", "tank", "scout", "gunship", "artillery", "missile"];
    for (const general of sim.generals) {
      if (!general) continue;
      const s = STARTS[general.start]!;
      const ids: number[] = [];
      for (let i = 0; i < 210 && sim.units.length < MAX_UNITS; i++) ids.push(sim.addUnit(kinds[i % kinds.length]!, general.slot, s.spawn[0] + (i % 15) * 3 - 20, s.spawn[1] + Math.floor(i / 15) * 3 - 20).id);
      sim.command(general.slot, ids, { k: "amove", x: mid(general.slot - 4), z: mid((general.slot % 3) - 1), l: 0 });
    }
  }
}

// ── The shared rules' questions ───────────────────────────────────────────

export const warMayPlace = (room: Room, pid: string, piece: Piece): boolean => war(room).sim.mayPlace(pid, piece);
export const warPlaced = (room: Room, pid: string, pieces: readonly Piece[]): void => war(room).sim.placed(pid, pieces);
export const warMayChange = (room: Room, pid: string, piece: Piece): boolean => war(room).sim.mayChange(pid, piece);
export const warBlocks = (room: Room, piece: Piece): boolean => (room.memory ? war(room).sim.blocks(piece) : false);
