import type { BuildState } from "../../game/buildState";
import { CELL, LEVEL, MAX_LEVEL, THICK } from "../../game/constants";
import type { Environment } from "../../game/environments";
import { gridBox, type Piece } from "../../game/pieces";
import { distanceToPiece, type Vec } from "../../game/trebuchet";
import {
  buildingBox,
  BUILDINGS,
  BUILDING_KINDS,
  DIG_TIME,
  EMP,
  FLIGHT_HEIGHT,
  COMPUTER,
  GENERAL_SIGHT,
  GUARD_RADIUS,
  WALL_WEAR,
  HIGH_GROUND,
  LOAD,
  MAKES,
  MAX_GENERALS,
  MAX_SUPPLY,
  MAX_UNITS,
  PIECE_COST,
  ROUTED_LITHIUM,
  ROUTED_WAIT,
  SIGHT_PER_METRE,
  START_HAULERS,
  START_LITHIUM,
  TAP_RATE,
  UNITS,
  UNIT_KINDS,
  UPGRADE_COST,
  UPGRADE_LEVELS,
  UPGRADE_STEP,
  UPGRADE_TIME,
  UPGRADES,
  upkeep,
  type BuildingKind,
  type UnitDef,
  type UnitKind,
  type UpgradeKind,
  type Weapon,
} from "./kit";
import { makeFields, mid, REFILL_MS, STARTS, type Field } from "./map";
import { DX, DZ, INF, INFANTRY, Nav, NO_OWNER, OPEN_WAY, SHUT_WAY, TOWERING, VEHICLE, WALL_WAY, type Flow, type MoveClass, type Node } from "./nav";
import { HALF_CELLS } from "./world";

/**
 * The war in Mojave: every general's units and buildings, what they are doing,
 * and what happens when they meet. It runs on the server, ten times a second,
 * and is the only place anything is decided: pages send orders and draw what
 * they are told.
 *
 * Plain logic with no drawing and no network in it, so it can be tested and
 * measured by itself: the room it runs in is behind `Host`.
 */

/** The side nobody commands, hostile to everyone. (There were neutral sentries round the rich fields; none now: only checks put units on it.) */
export const NEUTRAL = MAX_GENERALS;
/** Seconds of game per step. */
export const DT = 0.1;
/** The edge of the map, m. */
const EDGE = HALF_CELLS * CELL - 1;
/** Fog and sight are worked out on a grid of this many metres. */
export const SIGHT_CELL = 10;
export const SIGHT_GRID = Math.ceil((HALF_CELLS * 2 * CELL) / SIGHT_CELL);
/** Buckets for finding who is near whom, m. */
const BUCKET = 16;
const BUCKETS = Math.ceil((HALF_CELLS * 2 * CELL) / BUCKET);
/** How far a general can be from where they put a building, m. */
export const BUILD_REACH = 45;
/** A unit on an attack order goes after its target again once it has moved this far from where the way was worked out, m. */
const RETARGET = 5;
/** A Hauler choosing crystals counts each other Hauler already at a patch as this much further to go, m (one digs at a time: about the walk it waits). */
const HAULER_CROWD = 25;
/** A start with another army's Command Core this near it is not given to an army begun afresh, m. */
const START_TAKEN = 120;
/** How much room a general takes: units step round this, m. */
const GENERAL_RADIUS = 0.6;
/** Shells fly this fast, m/s (never there in under a second: time to see it coming). */
const SHELL_SPEED = 45;
/** The storey a drone's shots leave from and arrive at, for lines of fire: above every roof. */
const SKY = 1 << 12;
/** The footprint key of a building's cell: on the ground, or up on a floor (a turret). */
const cellKey = (x: number, z: number, l = 0) => (l > 0 ? `${x},${z},${l}` : `${x},${z}`);

/**
 * One of the eight armies. (Called a general from when each army had one:
 * any number of people may serve an army now, and it stands whether anyone
 * does or not.)
 */
export interface General {
  slot: number;
  /** The builders serving this army now: each commands all of it. */
  here: string[];
  /** Every id anyone has built under for this army (ids are new on every join): pieces carry the id they were built under. */
  pids: string[];
  /** The army's name: its colour's. */
  name: string;
  color: string;
  /** Its side: its own slot (there are no alliances; kept as a number of its own for what is worked out by side). */
  team: number;
  lithium: number;
  plasma: number;
  /** Lithium promised to pieces in an action still being settled. */
  pending: number;
  upgrades: Record<UpgradeKind, number>;
  /** Which start it began at. */
  start: number;
  /** When it lost its last Core, or 0. */
  routedAt: number;
  /** When it was last told it is under attack, and where. */
  alertAt: number;
  /** The computer plays this army (always pink, slot COMPUTER: nobody serves it). */
  ai: boolean;
  /** When it was begun, or began again after being routed (game seconds): the computer begins its own plans afresh from this. */
  bornAt: number;
}

/** What a unit has been told to do. */
export type Order =
  | { k: "stop" }
  | { k: "hold" }
  | { k: "move"; x: number; z: number; l: number }
  | { k: "amove"; x: number; z: number; l: number; auto?: boolean }
  /** (`px`, `pz`: this unit's place from the middle of the group, kept at both ends, so a patrol keeps its shape.) */
  | { k: "patrol"; x: number; z: number; l: number; bx: number; bz: number; bl: number; px?: number; pz?: number }
  /** (To the target's spot, in the group's shape round it: stopping to destroy whatever comes in range on the way, the target first; over only once there with nothing left in range, even when the target is gone first.) */
  | { k: "attack"; tk: TargetKind; id: number | string }
  | { k: "gather"; field: number }
  | { k: "return" }
  | { k: "load"; into: number }
  | { k: "unload"; x: number; z: number }
  | { k: "emp"; x: number; z: number };

/** What something is aimed at: a unit, a building, a general (by slot) or a built piece (by id). */
export const T_UNIT = 1, T_BUILDING = 2, T_GENERAL = 3, T_PIECE = 4;
export type TargetKind = typeof T_UNIT | typeof T_BUILDING | typeof T_GENERAL | typeof T_PIECE;

export interface Unit {
  id: number;
  kind: UnitKind;
  owner: number;
  x: number;
  y: number;
  z: number;
  /** The cell and storey it stands in (ground units). */
  cx: number;
  cz: number;
  level: number;
  heading: number;
  /** Going round another unit: to its right (1) or left (-1), kept until this time (s) so it does not dither between two. */
  side: number;
  sideUntil: number;
  hp: number;
  order: Order;
  queue: Order[];
  /** Where it is going now, when anywhere. */
  goal: Goal | null;
  /** Units ordered somewhere together share this, and stop when they reach the others. */
  group: number;
  /** Ordered with others: the top speed of the slowest of them, which the group marches at (0: alone, at its own). */
  pace: number;
  arrived: boolean;
  /** What it is shooting at (or closing in on). */
  tk: TargetKind | 0;
  tid: number | string;
  /** Where its gun points, radians (a vehicle's turret turns on its own; a soldier turns to it). */
  aim: number;
  /** Times it has looked again for the way, held up on its order's way (in a crowd, say), before settling for where it is. */
  replans: number;
  coolAt: number;
  stunUntil: number;
  /** Thrown: on its back until then. */
  downUntil: number;
  /** Artillery: set up to fire from this time (0: packed), and packed up to move from this time. */
  deployedAt: number;
  packedAt: number;
  /** Hauler: what it carries, where it is in its round, and until when it digs. */
  carry: number;
  phase: 0 | 1 | 2 | 3;
  digUntil: number;
  field: number;
  /** Transport: who is aboard. A carried unit: the transport it is in. */
  cargo: number[];
  inside: number;
  /** EMP drone: can pulse again from this time. */
  empAt: number;
  /** Seconds it has been trying to move without getting anywhere. */
  stuck: number;
  /** Seconds it has been close to where it is going without quite arriving (jostled by the others): it settles in the end. */
  linger: number;
  /** Staggered just now by a hit (for drawing), until this time. */
  hitUntil: number;
  dead: boolean;
}

interface Goal {
  /** Where the order was for (everyone ordered there together shares the way to it). */
  x: number;
  z: number;
  /** This unit's own spot there: its place in the formation it set out in. */
  ox: number;
  oz: number;
  /** How near the order's spot (in steps of the way there) a unit may leave the way and head straight for its own. */
  reach: number;
  /** The flow it follows (ground units), by its key. */
  key: string;
  seeds: readonly Node[];
  breach: boolean;
  /** How far out from the goal its flow is worked out (in steps of the way: 10 a cell); beyond that, no way. Infinite for an order's own goal. */
  limit: number;
  /** Near enough to the goal to stop. */
  radius: number;
  /** The next spot on the way (the middle of the next cell, a little off centre), when set. */
  wx: number;
  wz: number;
  set: boolean;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  owner: number;
  /** The low corner of its footprint. */
  cx: number;
  cz: number;
  /** The storey it stands on: 0 the ground, more a turret up on a floor (it falls when the floor goes). */
  l: number;
  hp: number;
  /** When it finishes printing itself (0: finished). */
  doneAt: number;
  startedAt: number;
  /** What it is making: the first is under way, with seconds left. */
  queue: { kind: UnitKind; left: number }[];
  /** An upgrade under way here (the Armory). */
  research: { kind: UpgradeKind; left: number } | null;
  rally: { x: number; z: number; l: number; field: number } | null;
  /** The vent a Tap stands on. */
  field: number;
  tk: TargetKind | 0;
  tid: number | string;
  coolAt: number;
  stunUntil: number;
  /** Goes up whenever anything a page shows of it changes. */
  rev: number;
  dead: boolean;
}

/** A shell in the air. */
interface Shell {
  x: number;
  z: number;
  landAt: number;
  owner: number;
  weapon: Weapon;
  damage: number;
}

/** What happened in the steps since it was last collected, for pages to draw. */
export interface Happened {
  /** A shot: from, to, how it looks, seconds in the air (0: at once), whose, and the unit or building hit (0: none). */
  /** (`by`: the unit that fired, or 0 for a building.) */
  shots: { from: Vec; to: Vec; look: Weapon["look"]; time: number; owner: number; hit: number; by?: number }[];
  /** A unit thrown: where from and where it comes down, and for how long. */
  tumbles: { id: number; from: Vec; to: Vec; time: number }[];
  /** A blast, and how wide. */
  blasts: { at: Vec; radius: number }[];
  /** A unit or building destroyed (or gone with its general): what and where. */
  gone: { unit: boolean; id: number; at: Vec; kind: string; owner: number; left: boolean }[];
  /** An EMP pulse. */
  pulses: { x: number; z: number }[];
  /** A shell shot down by a laser. */
  zaps: { from: Vec; to: Vec }[];
  /** Something a general should be told. */
  notes: { slot: number; text: string; x?: number; z?: number; kind: "attack" | "ready" | "info" }[];
}

/** The room the war runs in, as the war sees it. */
export interface Host {
  /** Where a builder's body is (its centre), or null. */
  positionOf(pid: string): Vec | null;
  /** Wears pieces down: [piece id, hits] (fractions of a hit). */
  wear(point: Vec, hits: [string, number][], by: string): void;
  /** Takes pieces out of the build. */
  removePieces(ids: string[], by: string): void;
  /** Puts pieces into the build (the computer's walls and towers): the ids of those that went in. */
  placePieces?(pieces: Piece[], by: string): string[];
}

/** Colours for armies whose general's own is too like another's: eight that are easy to tell apart. */
/** What each place's colour is called, as it goes in a sentence. */
export const ARMY_COLOR_NAMES = ["red", "blue", "yellow", "green", "purple", "orange", "teal", "pink"];
/** Each place's colour: its army wears it whoever commands there, and so does its general. */
export const ARMY_COLORS = ["#e8463a", "#3a7be8", "#f2c230", "#3fbf5f", "#b455e0", "#f08a2a", "#27c4c4", "#f06aa8"];

const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
const clampEdge = (v: number) => Math.max(-EDGE, Math.min(EDGE, v));
/** On foot; a vehicle; or a vehicle taller than a storey, which cannot go under a floor (a Titan). */
const classOf = (def: UnitDef): MoveClass => (def.infantry ? INFANTRY : def.height > LEVEL - THICK ? TOWERING : VEHICLE);
/** A number from 0 to 1 that is always the same for the same unit: for spreading units out. */
const scatter = (id: number, salt: number) => (((id * 2654435761 + salt * 40503) >>> 0) % 1000) / 1000;

export class Sim {
  /** Game time, seconds: goes up by DT each step. */
  t = 0;
  step = 0;
  readonly generals: (General | null)[] = Array.from({ length: MAX_GENERALS }, () => null);
  units: Unit[] = [];
  readonly unitById = new Map<number, Unit>();
  readonly buildings = new Map<number, Building>();
  readonly fields: Field[];
  readonly fieldById = new Map<number, Field>();
  readonly nav: Nav;
  happened: Happened = emptyHappened();
  /** What each team can see now: 1 for each sight cell in view. */
  readonly sight = new Map<number, Uint8Array>();
  /** Which army each builder serves now. */
  private readonly serving = new Map<string, number>();
  /** The army each browser tab last served: a reload or a dropped connection comes back to it without being asked. Never sent anywhere. */
  private readonly lastOfTab = new Map<string, number>();
  /** Whose each built piece is: the army its builder served when it went in. */
  private readonly pieceOwner = new Map<string, number>();
  private nextUnit = 1;
  private nextBuilding = 1;
  private nextGroup = 1;
  private readonly flows = new Map<string, Flow & { used: number }>();
  /** Who is near whom: the first unit in each bucket, and the next after each unit (by place in `units`). */
  private readonly head = new Int32Array(BUCKETS * BUCKETS);
  private next = new Int32Array(256);
  private readonly shells: Shell[] = [];
  /** Wear on pieces waiting to be passed on: piece id → hits, and where. */
  private readonly worn = new Map<string, { hits: number; at: Vec; by: number }>();
  /** Which general a piece id's first part belongs to. */
  private readonly slotOfPid = new Map<string, number>();
  /** The cells of buildings, for placing pieces: "x,z" → building id. */
  private readonly footprint = new Map<string, number>();
  private readonly fieldAt = new Map<string, Field>();

  constructor(
    readonly build: BuildState,
    readonly env: Environment,
    readonly host: Host,
  ) {
    this.nav = new Nav(build, (piece) => this.ownerOfPiece(piece.id));
    this.fields = makeFields();
    for (const f of this.fields) {
      this.fieldById.set(f.id, f);
      this.fieldAt.set(`${f.cx},${f.cz}`, f);
      // (Low on the ground: no way through, but shots pass over.)
      this.nav.fill(f.cx, f.cz, 1, true, false);
    }
    // A turret up on a floor falls (and is destroyed) when the floor goes: worn down, taken down, or fallen.
    build.subscribe((op, piece) => {
      if (op.kind !== "remove" || piece.type !== "floor" || piece.y <= 0) return;
      const id = this.footprint.get(cellKey(piece.x, piece.z, piece.y));
      const b = id === undefined ? undefined : this.buildings.get(id);
      if (b && !b.dead) this.raze(b, false);
    });
    // (Nobody is near anybody yet.)
    this.head.fill(-1);
  }

  // ── Sides ──────────────────────────────────────────────────────────────

  teamOf(owner: number): number {
    return owner === NEUTRAL ? -1 : owner;
  }

  /** Whether one side's things fire on another's: every general is against every other, and against the sentries. */
  hostile(a: number, b: number): boolean {
    return a !== b;
  }

  /** The general a builder is, or null (watching). */
  generalOf(pid: string): General | null {
    const slot = this.serving.get(pid);
    return slot === undefined ? null : (this.generals[slot] ?? null);
  }

  /** Whose a piece is, from the id it was built under: a general's slot, or NO_OWNER. */
  ownerOfPiece(pieceId: string): number {
    const known = this.pieceOwner.get(pieceId);
    if (known !== undefined) return known;
    const dash = pieceId.lastIndexOf("-");
    return (dash > 0 ? this.slotOfPid.get(pieceId.slice(0, dash)) : undefined) ?? NO_OWNER;
  }

  // ── Arriving and leaving ───────────────────────────────────────────────

  /**
   * A builder serves an army: from now they command all of it, with everyone
   * else who serves it. Whatever army they served before, they have left.
   * An army is begun afresh for them on a colour nobody has, and on one whose
   * army nobody serves now unless it is theirs (they served it a moment ago,
   * or their tab did: a reload or a dropped connection, back within the
   * minute it is kept for). Null when there is no such colour.
   */
  serve(pid: string, slot: number, tab: string | null = null): General | null {
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_GENERALS) return null;
    let g = this.generals[slot];
    // The computer's colour: nobody serves it. (A person's army already standing there from before the computer took
    // pink is still its own people's to come back to, until it is gone: nobody loses an army to the computer.)
    if (slot === COMPUTER && (!g || g.ai || !(g.pids.includes(pid) || (tab !== null && this.lastOfTab.get(tab) === slot)))) return null;
    if (g && g.here.length === 0 && !g.pids.includes(pid) && !(tab !== null && this.lastOfTab.get(tab) === slot)) {
      this.wipe(slot);
      g = null;
    }
    g ??= this.seat(slot);
    if (this.serving.get(pid) !== slot) {
      this.leave(pid);
      g.here.push(pid);
      this.serving.set(pid, slot);
    }
    if (!g.pids.includes(pid)) g.pids.push(pid);
    this.slotOfPid.set(pid, slot);
    if (tab) this.lastOfTab.set(tab, slot);
    this.keepComputer();
    return g;
  }

  /** Whether the computer plays at all here: set by the room (on, but for test rooms, where checks want quiet until one turns it on). Off in a bare Sim. */
  computerOn = false;

  /**
   * The computer's army is here exactly while someone's army is: begun afresh (a Core and four Haulers, as anyone
   * begins) when there is a person's army and no computer, and gone, everything of it, when there is no person's army
   * left. (It never keeps the war running by itself: the war runs only while someone serves an army.) It waits while
   * pink is still a person's army from before.
   */
  keepComputer(): void {
    const people = this.generals.some((g) => g && !g.ai);
    const c = this.generals[COMPUTER];
    if (c?.ai && (!people || !this.computerOn)) this.wipe(COMPUTER);
    else if (!c && people && this.computerOn) this.seat(COMPUTER);
  }

  /** The army a browser tab last served (while this war has been running), or -1. */
  lastServed(tab: string | null): number {
    return (tab ? this.lastOfTab.get(tab) : undefined) ?? -1;
  }

  /** Begins an army afresh on an empty slot: a Core at its start, and its first Haulers at work. */
  seat(slot: number): General {
    const used = new Set(this.generals.flatMap((g) => (g ? [g.start] : [])));
    // (A start another army has built a Core by, the computer expanding say, is taken too: nobody begins beside it.)
    for (let i = 0; i < STARTS.length; i++) {
      const s = STARTS[i]!;
      for (const b of this.buildings.values()) if (b.kind === "core" && !b.dead && Math.hypot(this.centreOf(b)[0] - mid(s.cx), this.centreOf(b)[2] - mid(s.cz)) < START_TAKEN) used.add(i);
    }
    // Its own start when that is free (it always is in a war begun with eight); else any that is.
    const start = !used.has(slot) ? slot : (STARTS.map((_, i) => i).find((i) => !used.has(i)) ?? slot);
    const ai = slot === COMPUTER;
    const g: General = {
      slot, here: [], pids: [], name: armyName(slot, ai), color: ARMY_COLORS[slot % ARMY_COLORS.length]!, team: slot, lithium: START_LITHIUM, plasma: 0, pending: 0,
      upgrades: { weapons: 0, armour: 0 }, start, routedAt: 0, alertAt: -100, ai, bornAt: this.t,
    };
    this.generals[slot] = g;
    const s = STARTS[start]!;
    // (On its start, or the nearest clear ground: never on top of what someone has built there.)
    const [cx, cz] = this.clearSpot(slot, "core", s.cx - 1, s.cz - 1) ?? [s.cx - 1, s.cz - 1];
    const core = this.addBuilding("core", slot, cx, cz, true);
    for (let i = 0; i < START_HAULERS; i++) {
      const u = this.spawnBeside(core, "hauler");
      if (u) this.autoGather(u);
    }
    return g;
  }

  /** The nearest cell to (cx, cz) where this army could put a building of this kind (paid for or not), within `reach` cells, or null. */
  clearSpot(slot: number, kind: BuildingKind, cx: number, cz: number, reach = 16): [number, number] | null {
    for (let r = 0; r <= reach; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.cannotBuild(slot, kind, cx + dx, cz + dz, true) === "") return [cx + dx, cz + dz];
        }
      }
    }
    return null;
  }

  /** An army begun on every colour nobody has (for checks: in a war, an army is begun only for someone who takes it up). */
  fill(): void {
    for (let slot = 0; slot < MAX_GENERALS; slot++) if (!this.generals[slot]) this.seat(slot);
  }

  /** A builder has gone, or serves another army now: the army they served stands as it is, with whoever else serves it (or nobody). */
  leave(pid: string): void {
    const g = this.generalOf(pid);
    this.serving.delete(pid);
    if (!g) return;
    g.here = g.here.filter((x) => x !== pid);
    g.pending = 0;
  }

  /** Everything of an army disappears, and its slot is empty (see `fill`). Whoever served it serves none. */
  wipe(slot: number): void {
    const g = this.generals[slot];
    if (!g) return;
    for (const u of this.units) if (u.owner === slot && !u.dead) this.kill(u, true);
    this.units = this.units.filter((u) => !u.dead);
    this.index();
    for (const b of [...this.buildings.values()]) if (b.owner === slot && !b.dead) this.raze(b, true);
    const ids: string[] = [];
    for (const p of this.build.all()) if (this.ownerOfPiece(p.id) === slot) ids.push(p.id);
    for (const id of ids) this.pieceOwner.delete(id);
    for (const pid of g.here) this.serving.delete(pid);
    if (ids.length > 0) this.host.removePieces(ids, "left");
    for (const pid of g.pids) this.slotOfPid.delete(pid);
    // (Nobody comes back to it: a tab that served it begins afresh like anyone else.)
    for (const [tab, at] of this.lastOfTab) if (at === slot) this.lastOfTab.delete(tab);
    this.generals[slot] = null;
  }

  // ── Money and supply ───────────────────────────────────────────────────

  supplyUsed(slot: number): number {
    let n = 0;
    for (const u of this.units) if (u.owner === slot && !u.dead) n += UNITS[u.kind].supply;
    for (const b of this.buildings.values()) if (b.owner === slot && !b.dead) for (const q of b.queue) n += UNITS[q.kind].supply;
    return n;
  }

  supplyMax(slot: number): number {
    let n = 0;
    for (const b of this.buildings.values()) if (b.owner === slot && !b.dead && b.doneAt === 0) n += BUILDINGS[b.kind].supply ?? 0;
    return Math.min(MAX_SUPPLY, n);
  }

  /** Why a turret or a wall may not go at a spot (m), or "": it goes within GUARD_RADIUS of a finished Core of the army's own, and never that near another army's. */
  guardWhy(slot: number, x: number, z: number, what: "turret" | "wall"): string {
    const name = what === "turret" ? "A turret" : "A wall";
    if (!this.nearCore(slot, x, z)) return `${name} goes within ${GUARD_RADIUS} m of your Command Core`;
    if (this.nearOtherCore(slot, x, z)) return `No ${what} within ${GUARD_RADIUS} m of another army's Command Core`;
    return "";
  }

  /** Whether a spot is within GUARD_RADIUS of a finished Core of an army's own (where its turrets may go, unless another army's Core is as near: see nearOtherCore). */
  nearCore(slot: number, x: number, z: number): boolean {
    for (const b of this.buildings.values()) {
      if (b.owner !== slot || b.kind !== "core" || b.dead || b.doneAt !== 0) continue;
      const c = this.centreOf(b);
      if (Math.hypot(c[0] - x, c[2] - z) <= GUARD_RADIUS) return true;
    }
    return false;
  }

  /** Whether a spot is within GUARD_RADIUS of a Core of any other army (finished or not): nobody's turrets go there. */
  nearOtherCore(slot: number, x: number, z: number): boolean {
    for (const b of this.buildings.values()) {
      if (b.owner === slot || b.kind !== "core" || b.dead) continue;
      const c = this.centreOf(b);
      if (Math.hypot(c[0] - x, c[2] - z) <= GUARD_RADIUS) return true;
    }
    return false;
  }

  private has(slot: number, kind: BuildingKind): boolean {
    for (const b of this.buildings.values()) if (b.owner === slot && b.kind === kind && !b.dead && b.doneAt === 0) return true;
    return false;
  }

  private pay(g: General, lithium: number, plasma: number): string {
    if (g.lithium - g.pending < lithium) return "Not enough lithium";
    if (g.plasma < plasma) return "Not enough plasma";
    g.lithium -= lithium;
    g.plasma -= plasma;
    return "";
  }

  // ── Pieces: what they cost and whose they are ──────────────────────────

  /** What a piece costs. */
  priceOf(piece: Piece): number {
    void piece;
    return PIECE_COST;
  }

  /** Whether this builder may put this piece in (see WorldServer.mayPlace): a general, with the lithium, and not into a building or a field. */
  mayPlace(pid: string, piece: Piece): boolean {
    const g = this.generalOf(pid);
    // (Walls, floors and ramps: nobody builds a siege engine here, nor canopies.)
    if (!g || (piece.type !== "wall" && piece.type !== "floor" && piece.type !== "ramp") || !piece.id.startsWith(`${pid}-`) || this.blocks(piece)) return false;
    // (A wall as a turret: by a Core of its own army, and never by another army's. Floors and ramps go anywhere.)
    if (piece.type === "wall" && this.guardWhy(g.slot, (piece.x + (piece.rot % 2 === 1 ? 0 : 0.5)) * CELL, (piece.z + (piece.rot % 2 === 0 ? 0 : 0.5)) * CELL, "wall")) return false;
    const price = this.priceOf(piece);
    if (g.lithium - g.pending < price) return false;
    g.pending += price;
    return true;
  }

  /**
   * Pieces built for an army by the war itself (the computer's walls and towers), by a general's rules: a wall only by
   * a Core of its own army and never by another's, nothing into a building or a field, the same price, paid for those
   * that went in. The room puts them in, in order (so a floor rests on walls put in before it), and every page is told.
   * Returns the ids of those that went in.
   */
  placeFor(slot: number, specs: readonly { type: "wall" | "floor"; x: number; y: number; z: number; rot: 0 | 1 }[]): string[] {
    const g = this.generals[slot];
    if (!g || !this.host.placePieces || specs.length === 0) return [];
    if (this.pieceStep !== this.step) {
      this.pieceStep = this.step;
      this.pieceSeq = 0;
    }
    const pieces: Piece[] = [];
    for (const s of specs) {
      if (g.lithium - g.pending < (pieces.length + 1) * PIECE_COST) break;
      // (Named for the army and the moment: never the same as another, a builder's or one built before.)
      const piece: Piece = { ...s, id: `cpu${slot}-${this.step.toString(36)}-${(this.pieceSeq++).toString(36)}`, material: "brick", edit: 0 };
      if (piece.type === "wall" && this.guardWhy(slot, (piece.x + (piece.rot === 1 ? 0 : 0.5)) * CELL, (piece.z + (piece.rot === 0 ? 0 : 0.5)) * CELL, "wall")) continue;
      if (this.blocks(piece)) continue;
      pieces.push(piece);
    }
    const went = this.host.placePieces(pieces, g.name);
    for (const id of went) {
      this.pieceOwner.set(id, slot);
      g.lithium = Math.max(0, g.lithium - PIECE_COST);
    }
    return went;
  }
  /** (Numbering the war's own pieces within a step.) */
  private pieceStep = -1;
  private pieceSeq = 0;

  /** The pieces that really went in: paid for now. */
  placed(pid: string, pieces: readonly Piece[]): void {
    const g = this.generalOf(pid);
    if (!g) return;
    g.pending = 0;
    for (const p of pieces) {
      g.lithium = Math.max(0, g.lithium - this.priceOf(p));
      this.pieceOwner.set(p.id, g.slot);
    }
  }

  /** Only the general who built a piece may remove or edit it. */
  mayChange(pid: string, piece: Piece): boolean {
    const g = this.generalOf(pid);
    return !!g && this.ownerOfPiece(piece.id) === g.slot;
  }

  /** True when a piece would cut into a building or a field. A wall flat against the side of one is fine. */
  blocks(piece: Piece): boolean {
    const [x0, y0, z0] = gridBox(piece);
    const taken = (x: number, z: number) => {
      const id = this.footprint.get(`${x},${z}`);
      const b = id === undefined ? undefined : this.buildings.get(id);
      if ((!!b && y0 < Math.ceil(BUILDINGS[b.kind].height / LEVEL)) || (y0 < 1 && this.fieldAt.has(`${x},${z}`))) return true;
      // A turret up on a floor: the storeys it stands up through (the floor it stands on is below them).
      for (let l = Math.max(1, y0 - 2); l <= y0; l++) {
        const up = this.footprint.get(cellKey(x, z, l));
        const t = up === undefined ? undefined : this.buildings.get(up);
        if (t && y0 >= l && y0 < l + Math.ceil(BUILDINGS[t.kind].height / LEVEL)) return true;
      }
      return false;
    };
    // A wall stands on the edge between two cells: it cuts in only when both are taken.
    if (piece.type === "wall") return piece.rot % 2 === 0 ? taken(x0, z0 - 1) && taken(x0, z0) : taken(x0 - 1, z0) && taken(x0, z0);
    return taken(x0, z0);
  }

  // ── Buildings ──────────────────────────────────────────────────────────

  /** Why a general cannot put this building here, or "" when they can. */
  cannotBuild(slot: number, kind: BuildingKind, cx: number, cz: number, free = false, l = 0): string {
    const g = this.generals[slot];
    const def = BUILDINGS[kind];
    if (!g || !def) return "Not now";
    const routed = kind === "core" && this.routedFree(g);
    if (!free && !routed) {
      for (const need of def.needs ?? []) if (!this.has(slot, need)) return `Needs ${article(BUILDINGS[need].label)} first`;
      if (g.lithium - g.pending < def.lithium) return "Not enough lithium";
      if (g.plasma < def.plasma) return "Not enough plasma";
    }
    if (!Number.isInteger(cx) || !Number.isInteger(cz) || Math.abs(cx) > HALF_CELLS - def.size - 1 || Math.abs(cz) > HALF_CELLS - def.size - 1) return "Outside the building area";
    if (def.nearCore) {
      const why = this.guardWhy(slot, (cx + def.size / 2) * CELL, (cz + def.size / 2) * CELL, "turret");
      if (why) return why;
    }
    if (l > 0) return this.cannotRaise(slot, kind, cx, cz, l);
    if (kind === "tap") {
      const f = this.fieldAt.get(`${cx},${cz}`);
      if (!f || f.kind !== "vent") return "A Tap goes on a plasma vent";
      if (this.footprint.has(`${cx},${cz}`)) return "That vent already has a Tap";
      return "";
    }
    // Every storey it stands up through.
    const storeys = Math.ceil(def.height / LEVEL);
    for (let x = cx; x < cx + def.size; x++) {
      for (let z = cz; z < cz + def.size; z++) {
        if (!this.nav.clearGround(x, z) || this.footprint.has(`${x},${z}`)) return "Something is in the way";
        // Nothing built in the cell (on its ground or over it) or along its inner edges.
        for (let y = 0; y < storeys; y++) {
          if (this.build.occupant({ type: "floor", x, y, z, rot: 0 }) || this.build.occupant({ type: "ramp", x, y, z, rot: 0 })) return "Something is built there";
          if (x > cx && this.build.occupant({ type: "wall", x, y, z, rot: 1 })) return "Something is built there";
          if (z > cz && this.build.occupant({ type: "wall", x, y, z, rot: 0 })) return "Something is built there";
        }
      }
    }
    // Nobody stands where it goes: a general is not built into (units are moved out of the way).
    const x0 = cx * CELL - 0.45, z0 = cz * CELL - 0.45, x1 = (cx + def.size) * CELL + 0.45, z1 = (cz + def.size) * CELL + 0.45;
    for (const other of this.generals) {
      for (const pid of other?.here ?? []) {
        const at = this.host.positionOf(pid);
        if (at && at[0] > x0 && at[0] < x1 && at[2] > z0 && at[2] < z1 && at[1] < def.height + 1) return "A general is standing there";
      }
    }
    return "";
  }

  /**
   * Why a turret cannot go up on the floor at storey `l` of a cell (or ""): only a turret goes up, on a floor of its
   * own army's (or nobody's), with nothing on it and nothing over it as high as it stands, and no general there.
   */
  private cannotRaise(slot: number, kind: BuildingKind, cx: number, cz: number, l: number): string {
    const def = BUILDINGS[kind];
    if (!def.nearCore || def.size !== 1) return "Only turrets go up on a floor";
    if (!Number.isInteger(l) || l < 1 || l > MAX_LEVEL) return "Not there";
    const floor = this.build.occupant({ type: "floor", x: cx, y: l, z: cz, rot: 0 });
    if (!floor || floor.type !== "floor") return "A turret goes up on a floor";
    const whose = this.ownerOfPiece(floor.id);
    if (whose !== NO_OWNER && whose !== slot && this.hostile(slot, whose)) return "That floor is another army's";
    if (this.footprint.has(cellKey(cx, cz, l)) || this.nav.rampAt(l, cx, cz) >= 0) return "Something is in the way";
    for (let y = l + 1; y < l + Math.ceil(def.height / LEVEL); y++) {
      if (this.build.occupant({ type: "floor", x: cx, y, z: cz, rot: 0 }) || this.build.occupant({ type: "ramp", x: cx, y, z: cz, rot: 0 })) return "Something is built there";
    }
    // (Nor another turret on the floor below reaching up to this one.)
    for (let y = Math.max(1, l - 2); y < l; y++) if (this.footprint.has(cellKey(cx, cz, y))) return "Something is built there";
    const x0 = cx * CELL - 0.45, z0 = cz * CELL - 0.45, x1 = (cx + 1) * CELL + 0.45, z1 = (cz + 1) * CELL + 0.45, y0 = l * LEVEL - 0.5;
    for (const other of this.generals) {
      for (const pid of other?.here ?? []) {
        const at = this.host.positionOf(pid);
        if (at && at[0] > x0 && at[0] < x1 && at[2] > z0 && at[2] < z1 && at[1] > y0 && at[1] < y0 + def.height + 1) return "A general is standing there";
      }
    }
    return "";
  }

  /** Every building standing, as it is drawn (for the shared rules' questions: a builder thrown, a stone). */
  solidBoxes(): [number, number, number, number, number, number][] {
    const out: [number, number, number, number, number, number][] = [];
    for (const b of this.buildings.values()) if (!b.dead) out.push(buildingBox(b.kind, b.cx, b.cz, b.l));
    return out;
  }

  /** A routed general's free Core is ready. */
  routedFree(g: General): boolean {
    return g.routedAt > 0 && this.t - g.routedAt >= ROUTED_WAIT;
  }

  /** A general puts a building down (`by`: which builder, who must be near): paid for, it stands there finished at once. */
  orderBuilding(slot: number, kind: BuildingKind, cx: number, cz: number, by: string | null = null, l = 0): string {
    const g = this.generals[slot];
    if (!g) return "Not now";
    const why = this.cannotBuild(slot, kind, cx, cz, false, l);
    if (why) return why;
    const def = BUILDINGS[kind];
    if (by) {
      const at = this.host.positionOf(by);
      const mx = (cx + def.size / 2) * CELL, mz = (cz + def.size / 2) * CELL;
      if (!at || Math.hypot(at[0] - mx, at[2] - mz) > BUILD_REACH + (def.size * CELL) / 2) return "Too far away: go closer";
    }
    if (!(kind === "core" && this.routedFree(g))) {
      const short = this.pay(g, def.lithium, def.plasma);
      if (short) return short;
    } else g.lithium = Math.max(g.lithium, ROUTED_LITHIUM);
    this.addBuilding(kind, slot, cx, cz, true, l);
    return "";
  }

  addBuilding(kind: BuildingKind, owner: number, cx: number, cz: number, finished: boolean, l = 0): Building {
    const def = BUILDINGS[kind];
    const b: Building = {
      id: this.nextBuilding++, kind, owner, cx, cz, l, hp: finished ? def.hp : def.hp * 0.1, doneAt: finished ? 0 : this.t + def.time, startedAt: this.t,
      queue: [], research: null, rally: null, field: kind === "tap" ? (this.fieldAt.get(`${cx},${cz}`)?.id ?? 0) : 0, tk: 0, tid: 0, coolAt: 0, stunUntil: 0, rev: 1, dead: false,
    };
    this.buildings.set(b.id, b);
    for (let x = cx; x < cx + def.size; x++) for (let z = cz; z < cz + def.size; z++) this.footprint.set(cellKey(x, z, l), b.id);
    this.nav.fill(cx, cz, def.size, true, true, l);
    // Whoever stands where it goes is moved out of the way.
    for (const u of this.units) {
      if (u.dead || UNITS[u.kind].air || u.inside || u.level !== l || u.cx < cx || u.cx >= cx + def.size || u.cz < cz || u.cz >= cz + def.size) continue;
      this.putOnGround(u, u.x, u.z);
    }
    const g = this.generals[owner];
    if (g && kind === "core") {
      // (Routed and beginning again: as good as new, so the computer leaves it alone for a while again.)
      if (g.routedAt > 0) g.bornAt = this.t;
      g.routedAt = 0;
    }
    return b;
  }

  /** A general takes one of their own buildings down: half of what it cost comes back, less for damage. */
  scrap(slot: number, id: number): string {
    const b = this.buildings.get(id), g = this.generals[slot];
    if (!b || !g || b.dead || b.owner !== slot) return "Not yours";
    const def = BUILDINGS[b.kind];
    const part = 0.5 * Math.min(1, b.hp / def.hp);
    g.lithium += Math.floor(def.lithium * part);
    g.plasma += Math.floor(def.plasma * part);
    for (const q of b.queue) this.refund(g, q.kind);
    this.raze(b, true);
    return "";
  }

  private refund(g: General, kind: UnitKind): void {
    g.lithium += UNITS[kind].lithium;
    g.plasma += UNITS[kind].plasma;
  }

  /** A building goes: destroyed, or (`left`) with its general. */
  private raze(b: Building, left: boolean): void {
    if (b.dead) return;
    b.dead = true;
    const def = BUILDINGS[b.kind];
    this.buildings.delete(b.id);
    for (let x = b.cx; x < b.cx + def.size; x++) for (let z = b.cz; z < b.cz + def.size; z++) this.footprint.delete(cellKey(x, z, b.l));
    // (A vent stays a vent under a Tap that has gone.)
    if (b.kind !== "tap") this.nav.fill(b.cx, b.cz, def.size, false, true, b.l);
    this.happened.gone.push({ unit: false, id: b.id, at: this.centreOf(b), kind: b.kind, owner: b.owner, left });
    // Its army's Haulers on their way to crystals for it choose again: those near another Core now.
    if (b.kind === "core") {
      for (const u of this.units) {
        if (u.dead || u.owner !== b.owner || u.kind !== "hauler" || u.order.k !== "gather" || u.phase !== 1) continue;
        const f = this.choosePatch(u);
        if (f && f.id !== u.field) {
          u.field = f.id;
          u.goal = null;
          u.arrived = false;
        }
      }
    }
    const g = this.generals[b.owner];
    // (Taken down by its own general too: a place is never left with no Core and no way to another.)
    if (g && b.kind === "core" && !this.hasAnyCore(b.owner)) {
      g.routedAt = this.t;
      this.note(g.slot, `Your last Core is gone: you may drop a new one, free, in ${ROUTED_WAIT} seconds`, "attack");
    }
  }

  private hasAnyCore(slot: number): boolean {
    for (const b of this.buildings.values()) if (b.owner === slot && b.kind === "core" && !b.dead) return true;
    return false;
  }

  centreOf(b: Building): Vec {
    const half = (BUILDINGS[b.kind].size * CELL) / 2;
    return [b.cx * CELL + half, b.l * LEVEL, b.cz * CELL + half];
  }

  /** Orders units from a building: paid for now, made in turn. Returns "" or why not. */
  make(slot: number, id: number, kind: UnitKind, count = 1): string {
    const b = this.buildings.get(id), g = this.generals[slot];
    const def = UNITS[kind];
    if (!b || !g || !def || b.dead || b.owner !== slot) return "Not yours";
    if (b.doneAt !== 0) return "Still printing";
    if (def.madeAt !== b.kind) return "Not made here";
    for (const need of def.needs ?? []) if (!this.has(slot, need)) return `Needs ${article(BUILDINGS[need].label)} first`;
    let made = 0, why = "";
    for (let i = 0; i < Math.max(1, Math.min(10, count)); i++) {
      if (b.queue.length >= 8) why = "Its queue is full";
      else if (this.supplyUsed(slot) + def.supply > this.supplyMax(slot)) why = this.supplyMax(slot) >= MAX_SUPPLY ? "Your army is at its limit" : "Not enough supply: build a Relay mast";
      else why = this.pay(g, def.lithium, def.plasma);
      if (why) break;
      b.queue.push({ kind, left: def.time });
      made++;
    }
    if (made > 0) b.rev++;
    return made > 0 ? "" : why;
  }

  /** Takes the last thing off a building's queue (or stops its research): what was paid comes back. */
  cancel(slot: number, id: number): string {
    const b = this.buildings.get(id), g = this.generals[slot];
    if (!b || !g || b.dead || b.owner !== slot) return "Not yours";
    if (b.research) {
      const level = g.upgrades[b.research.kind];
      g.lithium += UPGRADE_COST[level] ?? 0;
      g.plasma += UPGRADE_COST[level] ?? 0;
      b.research = null;
    } else {
      const last = b.queue.pop();
      if (!last) return "Nothing to cancel";
      this.refund(g, last.kind);
    }
    b.rev++;
    return "";
  }

  /** Starts the next level of an upgrade at an Armory. */
  research(slot: number, id: number, kind: UpgradeKind): string {
    const b = this.buildings.get(id), g = this.generals[slot];
    if (!b || !g || b.dead || b.owner !== slot || b.kind !== "armory") return "Not yours";
    if (b.doneAt !== 0) return "Still printing";
    if (!UPGRADES.includes(kind)) return "No such upgrade";
    const level = g.upgrades[kind];
    if (level >= UPGRADE_LEVELS) return "Already at the top level";
    for (const other of this.buildings.values()) if (other.owner === slot && other.research?.kind === kind) return "Already being worked on";
    if (b.research) return "This Armory is busy";
    const short = this.pay(g, UPGRADE_COST[level]!, UPGRADE_COST[level]!);
    if (short) return short;
    b.research = { kind, left: UPGRADE_TIME[level]! };
    b.rev++;
    return "";
  }

  /** Where a building sends what it makes. */
  rally(slot: number, ids: readonly number[], x: number, y: number, z: number): string {
    const field = this.fieldAt.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    for (const id of ids) {
      const b = this.buildings.get(id);
      // (Not a Core's: its Haulers go to work by themselves.)
      if (!b || b.dead || b.owner !== slot || !MAKES[b.kind].some((k) => k !== "hauler")) continue;
      b.rally = { x: clampEdge(x), z: clampEdge(z), l: Math.max(0, Math.round(y / LEVEL)), field: field?.kind === "crystal" ? field.id : 0 };
      b.rev++;
    }
    return "";
  }

  // ── Units: making and losing them ──────────────────────────────────────

  addUnit(kind: UnitKind, owner: number, x: number, z: number): Unit {
    const def = UNITS[kind];
    const u: Unit = {
      id: this.nextUnit++, kind, owner, x, y: def.air ? FLIGHT_HEIGHT : 0, z, cx: Math.floor(x / CELL), cz: Math.floor(z / CELL), level: 0, heading: 0, side: 1, sideUntil: 0, hp: def.hp,
      order: { k: "stop" }, queue: [], goal: null, group: 0, arrived: true, tk: 0, tid: 0, coolAt: 0, stunUntil: 0, downUntil: 0, deployedAt: 0, packedAt: 0,
      carry: 0, phase: 0, digUntil: 0, field: 0, cargo: [], inside: 0, empAt: 0, stuck: 0, linger: 0, hitUntil: 0, dead: false,
      aim: 0, replans: 0, pace: 0,
    };
    if (!def.air) this.putOnGround(u, x, z);
    this.units.push(u);
    this.unitById.set(u.id, u);
    return u;
  }

  /** Puts a ground unit on the nearest open ground to a spot. */
  private putOnGround(u: Unit, x: number, z: number): void {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let r = 0; r <= 12; r++) {
      let best: [number, number] | null = null, bestD = Infinity;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.nav.standable(0, cx + dx, cz + dz) || this.nav.rampAt(0, cx + dx, cz + dz) >= 0) continue;
          const d = dist2(mid(cx + dx), mid(cz + dz), x, z);
          if (d < bestD) {
            bestD = d;
            best = [cx + dx, cz + dz];
          }
        }
      }
      if (!best) continue;
      u.cx = best[0];
      u.cz = best[1];
      u.level = 0;
      // Where they were, if that is in the cell; else just inside it.
      u.x = Math.max(u.cx * CELL + 0.6, Math.min((u.cx + 1) * CELL - 0.6, x));
      u.z = Math.max(u.cz * CELL + 0.6, Math.min((u.cz + 1) * CELL - 0.6, z));
      u.y = 0;
      return;
    }
  }

  /** A new unit beside the building that made it (toward where it is to go), or null when there is no room in the world. */
  private spawnBeside(b: Building, kind: UnitKind): Unit | null {
    if (this.units.length >= MAX_UNITS) return null;
    const c = this.centreOf(b);
    const half = (BUILDINGS[b.kind].size * CELL) / 2 + 2;
    const toward = b.rally ? Math.atan2(b.rally.x - c[0], b.rally.z - c[2]) : Math.atan2(-c[0], -c[2]);
    const jitter = (scatter(this.nextUnit, 7) - 0.5) * 1.6;
    const x = c[0] + Math.sin(toward + jitter) * half, z = c[2] + Math.cos(toward + jitter) * half;
    const u = this.addUnit(kind, b.owner, clampEdge(x), clampEdge(z));
    u.heading = toward;
    return u;
  }

  /** A unit goes: destroyed, or (`left`) with its general. Whoever it carried goes too. */
  kill(u: Unit, left: boolean): void {
    if (u.dead) return;
    u.dead = true;
    this.unitById.delete(u.id);
    this.happened.gone.push({ unit: true, id: u.id, at: [u.x, u.y, u.z], kind: u.kind, owner: u.owner, left });
    for (const id of u.cargo) {
      const inside = this.unitById.get(id);
      if (inside) this.kill(inside, left);
    }
    const f = u.phase === 2 ? this.fieldById.get(u.field) : undefined;
    if (f && this.digger.get(f.id) === u.id) this.digger.delete(f.id);
  }

  private note(slot: number, text: string, kind: "attack" | "ready" | "info", x?: number, z?: number): void {
    this.happened.notes.push({ slot, text, kind, x, z });
  }

  // ── Orders ─────────────────────────────────────────────────────────────

  /**
   * A general orders units of theirs. `queue`: after what they are doing
   * (Shift). Units that cannot do it (a Trooper told to gather) take it as the
   * nearest thing they can (go there).
   */
  command(slot: number, ids: readonly number[], order: Order, queue = false): string {
    const units = ids.flatMap((id) => {
      const u = this.unitById.get(id);
      // (Haulers take no orders: they work by themselves, always.)
      return u && !u.dead && u.owner === slot && !u.inside && u.kind !== "hauler" ? [u] : [];
    });
    if (units.length === 0) return "Nothing to order";
    const group = this.nextGroup++;
    // How much room they need where they are going.
    let area = 0;
    for (const u of units) area += (UNITS[u.kind].radius * 2 + 0.8) ** 2;
    const spread = 1 + Math.sqrt(area / Math.PI);
    // Each keeps its place: where it stands from the middle of the group now is where it will stand there
    // (pulled in, when the group is strung out, to about the room it needs).
    let mx = 0, mz = 0;
    for (const u of units) {
      mx += u.x;
      mz += u.z;
    }
    mx /= units.length;
    mz /= units.length;
    const room = spread * 1.3 + 1.5;
    this.places.clear();
    if (units.length > 1) {
      for (const u of units) {
        let ox = u.x - mx, oz = u.z - mz;
        const far = Math.hypot(ox, oz);
        if (far > room) {
          ox = (ox / far) * room;
          oz = (oz / far) * room;
        }
        this.places.set(u.id, [ox, oz]);
      }
    }
    // Together, they march at the pace of the slowest of them (see speedOf), and keep their shape.
    let pace = 0;
    if (units.length > 1) pace = Math.min(...units.map((u) => UNITS[u.kind].speed));
    for (const u of units) {
      let mine = this.fit(u, order);
      if (mine.k === "patrol") {
        const place = this.places.get(u.id);
        mine = { ...mine, px: place?.[0] ?? 0, pz: place?.[1] ?? 0 };
      }
      if (queue && u.order.k !== "stop" && u.order.k !== "hold") {
        if (u.queue.length < 12) u.queue.push(mine);
        continue;
      }
      u.queue = [];
      u.pace = pace;
      this.begin(u, mine, group, spread);
    }
    this.places.clear();
    return "";
  }

  /** While an order is being given to several units: each one's place from the middle of the group, m. */
  private readonly places = new Map<number, [number, number]>();

  /** The order as this unit can carry it out. */
  private fit(u: Unit, order: Order): Order {
    const def = UNITS[u.kind];
    const at = (x: number, z: number): Order => ({ k: "move", x, z, l: 0 });
    switch (order.k) {
      case "gather": {
        const f = this.fieldById.get(order.field);
        if (u.kind === "hauler" && f?.kind === "crystal") return order;
        return f ? at(mid(f.cx), mid(f.cz)) : { k: "stop" };
      }
      case "return":
        return u.kind === "hauler" ? order : { k: "stop" };
      case "load": {
        const into = this.unitById.get(order.into);
        if (!into || def.air) return { k: "stop" };
        return order;
      }
      case "unload":
        return u.kind === "transport" ? order : at(order.x, order.z);
      case "emp":
        return u.kind === "emp" ? order : at(order.x, order.z);
      case "attack":
        if (def.weapon) return order;
        // Unarmed: goes there instead.
        return this.spotOf(order.tk, order.id) ? at(...(this.spotOf(order.tk, order.id) as [number, number])) : { k: "stop" };
      case "amove":
      case "patrol":
        return def.weapon ? order : { k: "move", x: order.x, z: order.z, l: order.l };
      default:
        return order;
    }
  }

  /** Where a target is on the ground (x, z), or null when it is gone. */
  private spotOf(tk: TargetKind, id: number | string): [number, number] | null {
    if (tk === T_UNIT) {
      const u = this.unitById.get(id as number);
      return u && !u.dead && !u.inside ? [u.x, u.z] : null;
    }
    if (tk === T_BUILDING) {
      const b = this.buildings.get(id as number);
      return b ? [this.centreOf(b)[0], this.centreOf(b)[2]] : null;
    }
    if (tk === T_GENERAL) return null;
    const p = this.build.get(id as string);
    return p ? [(p.x + (p.type === "wall" && p.rot === 1 ? 0 : 0.5)) * CELL, (p.z + (p.type === "wall" && p.rot === 0 ? 0 : 0.5)) * CELL] : null;
  }

  /** Starts a unit on an order. */
  private begin(u: Unit, order: Order, group: number, spread: number): void {
    u.order = order;
    u.group = group;
    u.arrived = false;
    u.stuck = 0;
    u.linger = 0;
    u.goal = null;
    u.tk = 0;
    u.replans = 0;
    const def = UNITS[u.kind];
    // Artillery packs up before it moves.
    if (def.deploy && u.deployedAt > 0 && order.k !== "stop" && order.k !== "hold") {
      u.deployedAt = 0;
      u.packedAt = this.t + def.deploy;
    }
    switch (order.k) {
      case "stop":
      case "hold":
        u.arrived = true;
        break;
      case "move":
      case "amove":
        this.head_(u, order.x, order.z, order.l, spread, order.k === "amove");
        break;
      case "patrol":
        this.head_(u, order.x, order.z, order.l, spread, true);
        break;
      case "attack": {
        // To where the target is, each to its own place in the group's shape round it.
        const at = this.spotOf(order.tk, order.id);
        if (at) this.headAt(u, order.tk, order.id, at, spread, this.places.get(u.id) ?? [0, 0]);
        break;
      }
      case "gather":
        u.field = order.field;
        u.phase = u.carry > 0 ? 3 : 1;
        break;
      case "return":
        u.phase = 3;
        break;
      case "unload":
      case "emp":
        this.head_(u, order.x, order.z, 0, 2, false);
        break;
      case "load":
        break;
    }
  }

  /** Sets a unit going to a spot (on storey `l`, or the nearest standable storey under it there), to its own place there. */
  private head_(u: Unit, x: number, z: number, l: number, radius: number, breach: boolean): void {
    x = clampEdge(x);
    z = clampEdge(z);
    const def = UNITS[u.kind];
    const place = this.places.get(u.id);
    const ox = clampEdge(x + (place?.[0] ?? 0)), oz = clampEdge(z + (place?.[1] ?? 0));
    if (def.air) {
      u.goal = { x, z, ox, oz, reach: 0, key: "", seeds: [], breach: false, limit: Infinity, radius, wx: ox, wz: oz, set: true };
      return;
    }
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const level = this.nav.dropTo(Math.min(l, 80), cx, cz);
    // Somewhere that cannot be stood on (a building, a field): beside it.
    const seeds: Node[] = level >= 0 ? [{ x: cx, z: cz, l: level }] : this.nav.around(cx, cz, 1);
    this.route(u, x, z, seeds, radius, breach && !!def.weapon && def.weapon.wear > 0, ox, oz);
  }

  /**
   * Sets a unit going to a target's spot (`at`), to its own place `off` from it: to the cells round a building, or the
   * one a unit stands in; through the enemy's walls, when its weapon breaks them.
   */
  private headAt(u: Unit, tk: TargetKind, id: number | string, at: [number, number], radius: number, off: readonly [number, number]): void {
    const def = UNITS[u.kind];
    const ox = clampEdge(at[0] + off[0]), oz = clampEdge(at[1] + off[1]);
    if (def.air) {
      u.goal = { x: at[0], z: at[1], ox, oz, reach: 0, key: "", seeds: [], breach: false, limit: Infinity, radius, wx: ox, wz: oz, set: true };
      return;
    }
    u.goal = this.goalTo(u, at[0], at[1], this.seedsAt(tk, id, at), radius, !!def.weapon && def.weapon.wear > 0, ox, oz);
  }

  /** Sets a ground unit going to any of `seeds` (and from there to its own spot, when it has one). */
  private route(u: Unit, x: number, z: number, seeds: readonly Node[], radius: number, breach: boolean, ox = x, oz = z): void {
    u.goal = this.goalTo(u, x, z, seeds, radius, breach, ox, oz);
  }

  /** The way to any of `seeds`, and from there to a spot of its own. */
  private goalTo(u: Unit, x: number, z: number, seeds: readonly Node[], radius: number, breach: boolean, ox = x, oz = z): Goal {
    const def = UNITS[u.kind];
    const first = seeds[0];
    const limit = Infinity;
    const key = `${classOf(def)}|${breach ? this.teamOf(u.owner) : "-"}|${seeds.length}|${first ? `${first.x},${first.z},${first.l}` : ""}|${limit}`;
    // (A step of the way is 10: see nav.ts.)
    const reach = ox === x && oz === z ? 0 : (Math.ceil(Math.hypot(ox - x, oz - z) / CELL) + 1) * 10;
    return { x, z, ox, oz, reach, key, seeds, breach, limit, radius, wx: 0, wz: 0, set: false };
  }

  private flowOf(u: Unit, goal: Goal): Flow {
    const flows = this.flows;
    let flow = flows.get(goal.key);
    // Worked out again when the build has changed (not more than about twice a second each).
    if (!flow || (flow.version !== this.nav.version && this.t - flow.at > 0.5)) {
      const owner = u.owner;
      const made = this.nav.flow(goal.seeds, classOf(UNITS[u.kind]), goal.breach ? (o) => o === NO_OWNER || this.hostile(owner, o) : null, this.t, goal.limit);
      flow = Object.assign(made, { used: this.t });
      flows.set(goal.key, flow);
      if (flows.size > 48) {
        // The longest unused go (each is a number for every cell of the map: a room has only so much memory).
        const old = [...flows].sort((a, b) => a[1].used - b[1].used).slice(0, 16);
        for (const [k] of old) flows.delete(k);
      }
    }
    flow.used = this.t;
    return flow;
  }

  // ── One step ───────────────────────────────────────────────────────────

  /** Moves the war on by DT. */
  tick(): void {
    this.t = Math.round((this.t + DT) * 1000) / 1000;
    this.step++;
    this.economy();
    this.index();
    // Who is aiming at whom: worked out afresh each step (and kept up to date as units choose).
    this.pledged.clear();
    for (const u of this.units) {
      const w = UNITS[u.kind].weapon;
      if (w && u.tk === T_UNIT && !u.dead) this.pledged.set(u.tid as number, (this.pledged.get(u.tid as number) ?? 0) + w.damage / w.cooldown);
    }
    this.marchCentres();
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]!;
      if (u.dead || u.inside) continue;
      if (this.t < u.downUntil || this.t < u.stunUntil) continue;
      this.think(u, i);
    }
    this.separate();
    this.flyOver();
    for (const b of this.buildings.values()) this.guard(b);
    this.landShells();
    if (this.step % 3 === 0) this.passWear();
    if (this.step % 4 === 0) this.look();
    if (this.step % 20 === 0) this.housekeeping();
    if (this.units.some((u) => u.dead)) {
      this.units = this.units.filter((u) => !u.dead);
      // Who is near whom is kept right between steps too: a blast can come at any moment (the general's own gun).
      this.index();
    }
  }

  /** Income, printing, production, research, fields filling again. */
  private economy(): void {
    const nowMs = this.t * 1000;
    for (const f of this.fields) {
      if (f.refillAt && nowMs >= f.refillAt) {
        f.amount = f.full;
        f.refillAt = 0;
      }
    }
    for (const b of this.buildings.values()) {
      const g = this.generals[b.owner];
      const def = BUILDINGS[b.kind];
      if (b.doneAt !== 0) {
        // Printing: it grows to full strength (less whatever it was hit for).
        b.hp = Math.min(def.hp, b.hp + (def.hp * 0.9 * DT) / def.time);
        if (this.t >= b.doneAt) {
          b.doneAt = 0;
          b.rev++;
          if (g) this.note(g.slot, `${def.label} ready`, "ready", ...xz(this.centreOf(b)));
        }
        continue;
      }
      if (!g || this.t < b.stunUntil) continue;
      if (b.kind === "tap") {
        const f = this.fieldById.get(b.field);
        if (f && f.amount > 0) {
          const drawn = Math.min(f.amount, TAP_RATE * DT);
          f.amount -= drawn;
          g.plasma += drawn * upkeep(this.supplyOf(g.slot));
          if (f.amount <= 0) {
            f.amount = 0;
            f.refillAt = nowMs + REFILL_MS;
            this.note(g.slot, "A plasma vent has run dry", "info", mid(f.cx), mid(f.cz));
          }
        }
      }
      const q = b.queue[0];
      if (q) {
        q.left -= DT;
        if (q.left <= 0) {
          const u = this.spawnBeside(b, q.kind);
          if (u) {
            b.queue.shift();
            b.rev++;
            this.sendOut(u, b);
          } else q.left = 0.5;
        }
      }
      if (b.research) {
        b.research.left -= DT;
        if (b.research.left <= 0) {
          g.upgrades[b.research.kind]++;
          this.note(g.slot, `${b.research.kind === "weapons" ? "Weapons" : "Armour"} level ${g.upgrades[b.research.kind]} ready`, "ready");
          b.research = null;
          b.rev++;
        }
      }
    }
  }

  /** Supply in use, counted once a step per general. */
  private readonly supplyCache = new Map<number, { at: number; n: number }>();
  private supplyOf(slot: number): number {
    const c = this.supplyCache.get(slot);
    if (c && c.at === this.step) return c.n;
    const n = this.supplyUsed(slot);
    this.supplyCache.set(slot, { at: this.step, n });
    return n;
  }

  /** A new unit sets off: to the rally point, or (a Hauler) straight to work. */
  private sendOut(u: Unit, b: Building): void {
    const r = b.rally;
    if (u.kind === "hauler") return this.autoGather(u);
    if (r) this.begin(u, { k: "move", x: r.x, z: r.z, l: r.l }, this.nextGroup++, 2);
  }

  /** Sets a Hauler to work: to the best crystals for it (see choosePatch). With none (no Core, or nothing left to mine), it waits, and is tried again (see housekeeping). */
  private autoGather(u: Unit): void {
    const f = this.choosePatch(u);
    if (!f) return;
    this.begin(u, { k: "gather", field: f.id }, 0, 1);
  }

  /**
   * The crystal patch a Hauler should mine next: the one whose round trip to
   * the nearest finished Core of its army is shortest, with a little for the
   * walk there from where it is now (so it does not wander between Cores),
   * and more for every other Hauler already going to it or digging there
   * (one digs at a time). None while the army has no finished Core.
   */
  private choosePatch(u: Unit): Field | null {
    const cores: Vec[] = [];
    for (const b of this.buildings.values()) if (b.owner === u.owner && b.kind === "core" && !b.dead && b.doneAt === 0) cores.push(this.centreOf(b));
    if (cores.length === 0) return null;
    const crowd = this.patchCrowd();
    let best: Field | null = null, bestS = Infinity;
    for (const f of this.fields) {
      if (f.kind !== "crystal" || f.amount <= 0) continue;
      const x = mid(f.cx), z = mid(f.cz);
      let home = Infinity;
      for (const c of cores) home = Math.min(home, Math.hypot(c[0] - x, c[2] - z));
      const others = (crowd.get(f.id) ?? 0) - (u.field === f.id && (u.phase === 1 || u.phase === 2) && u.order.k === "gather" ? 1 : 0);
      const s = home * 2 + Math.hypot(u.x - x, u.z - z) * 0.5 + others * HAULER_CROWD;
      if (s < bestS) {
        bestS = s;
        best = f;
      }
    }
    return best;
  }

  /** How many Haulers are going to (or digging at) each crystal patch, this step. */
  private patchCrowd(): Map<number, number> {
    if (this.crowdAt === this.step) return this.crowd;
    this.crowdAt = this.step;
    this.crowd.clear();
    for (const u of this.units) {
      if (u.dead || u.kind !== "hauler" || u.order.k !== "gather" || (u.phase !== 1 && u.phase !== 2)) continue;
      this.crowd.set(u.field, (this.crowd.get(u.field) ?? 0) + 1);
    }
    return this.crowd;
  }
  private readonly crowd = new Map<number, number>();
  private crowdAt = -1;
  /** Which Core each Hauler on its way back is taking its load to: when that one is gone, it turns for the next nearest. */
  private readonly haulTo = new Map<number, number>();

  /** Rebuilds who is near whom. */
  private index(): void {
    this.head.fill(-1);
    if (this.next.length < this.units.length) this.next = new Int32Array(this.units.length * 2);
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]!;
      if (u.dead || u.inside) continue;
      const b = bucketOf(u.x, u.z);
      this.next[i] = this.head[b]!;
      this.head[b] = i;
    }
  }

  /** Calls `fn` with every unit within `range` of a spot (a square of buckets round it: check the distance yourself). */
  nearby(x: number, z: number, range: number, fn: (u: Unit, i: number) => void): void {
    const half = (HALF_CELLS * CELL);
    const x0 = Math.max(0, Math.floor((x - range + half) / BUCKET)), x1 = Math.min(BUCKETS - 1, Math.floor((x + range + half) / BUCKET));
    const z0 = Math.max(0, Math.floor((z - range + half) / BUCKET)), z1 = Math.min(BUCKETS - 1, Math.floor((z + range + half) / BUCKET));
    for (let bx = x0; bx <= x1; bx++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let i = this.head[bx * BUCKETS + bz]!; i >= 0; i = this.next[i]!) {
          const u = this.units[i];
          // (A unit made since the last step is not in the buckets yet; one gone since is skipped.)
          if (!u) break;
          fn(u, i);
        }
      }
    }
  }

  // ── What each unit does ────────────────────────────────────────────────

  /**
   * A unit does what it was told, and nothing of its own: it goes only where its order sends it, and shoots whatever
   * of the enemy's comes within its range (see `fight`), on the move too. Only a patrol stops for what it finds.
   */
  private think(u: Unit, i: number): void {
    const def = UNITS[u.kind];
    const order = u.order;
    if (u.kind === "hauler" && (order.k === "gather" || order.k === "return")) return this.haul(u);
    if (order.k === "load") return this.board(u, order);
    if (order.k === "unload") return this.unload(u, order);
    if (order.k === "emp") return this.pulse(u, order);
    const w = def.weapon;

    // Standing (or holding): it never moves; it shoots whatever comes within its range until nothing there is left.
    // Artillery sets up where it stands.
    if (order.k === "stop" || order.k === "hold") {
      if (w) this.fight(u, def, w, i, false);
      else u.aim = u.heading;
      if (def.deploy && u.deployedAt === 0 && this.t >= u.packedAt) u.deployedAt = this.t + def.deploy;
      return;
    }
    if (order.k === "attack") {
      const at = this.spotOf(order.tk, order.id);
      // Its target has moved off: after it, each still in its place in the group's shape round it. Gone: on to where it
      // was all the same (the order is over only once it is there).
      if (at && u.goal && Math.hypot(at[0] - u.goal.x, at[1] - u.goal.z) > RETARGET) {
        this.headAt(u, order.tk, order.id, at, u.goal.radius, [u.goal.ox - u.goal.x, u.goal.oz - u.goal.z]);
        u.arrived = false;
        u.linger = 0;
      }
    }
    // Attacking or patrolling: the moment something of the enemy's is in range (its target first), it stops where it is,
    // as far off as it can fight from, and destroys everything in range; then on along its way. An attack is over only
    // once it stands where its target was, with nothing left in range. Neither ever leaves the way to go after anything.
    const halts = order.k === "attack" || order.k === "patrol";
    if (halts && w && this.fight(u, def, w, i, false) === "fire") return;
    if (!u.goal) return this.done(u);
    // On the move (and an attack-move): it shoots as it goes at whatever comes within its range, never stopping or
    // turning aside for it. Artillery cannot fire on the move.
    if (!halts) {
      if (w && !def.deploy) this.fight(u, def, w, i, true);
      else this.drop(u);
    }
    this.travel(u, def);
    if (!u.arrived) return;
    if (order.k === "patrol") {
      // Back the other way, each to its own place at that end, so the patrol keeps its shape.
      const back: Order = { k: "patrol", x: order.bx, z: order.bz, l: order.bl, bx: order.x, bz: order.z, bl: order.l, px: order.px, pz: order.pz };
      this.places.set(u.id, [order.px ?? 0, order.pz ?? 0]);
      this.begin(u, back, u.group, u.goal?.radius ?? 2);
      this.places.delete(u.id);
    } else this.done(u);
  }

  /** Lets go of whatever it was aiming at. */
  private drop(u: Unit): void {
    u.tk = 0;
    u.aim = u.heading;
  }

  /** How far its weapon reaches from where it is now (further from up on a floor). */
  private rangeOf(u: Unit, def: UnitDef, w: Weapon): number {
    return w.range * (u.level > 0 && !def.air ? HIGH_GROUND : 1);
  }

  /** Where a target can be got at: the cells to find the way to (shared by everyone going for that target, so the way is worked out once). */
  private seedsAt(tk: TargetKind, id: number | string, spot: [number, number]): Node[] {
    if (tk === T_BUILDING) {
      const b = this.buildings.get(id as number);
      if (b) return this.nav.around(b.cx, b.cz, BUILDINGS[b.kind].size);
    }
    if (tk === T_UNIT) {
      const t = this.unitById.get(id as number);
      if (t && !UNITS[t.kind].air) return [{ x: t.cx, z: t.cz, l: t.level }];
    }
    const cx = Math.floor(spot[0] / CELL), cz = Math.floor(spot[1] / CELL);
    return [{ x: cx, z: cz, l: 0 }, ...this.nav.around(cx, cz, 1)];
  }

  /** The order is finished: on to the next one queued, or stand. */
  private done(u: Unit): void {
    const next = u.queue.shift();
    if (next) return this.begin(u, next, u.group, u.goal?.radius ?? 2);
    if (u.order.k !== "hold") u.order = { k: "stop" };
    u.goal = null;
    u.arrived = true;
  }

  /**
   * A unit shoots what is in its range: the target of its attack order first, whenever it can be hit; else the best
   * enemy unit or building it has a shot at; else (a weapon that breaks them) the nearest wall, floor or ramp of the
   * enemy's. "fire" when it has something to shoot, else "none". It never goes after anything: where it goes is its
   * order's business. `moving`: it keeps facing the way it goes, and shoots as it passes.
   */
  private fight(u: Unit, def: UnitDef, w: Weapon, i: number, moving: boolean): "fire" | "none" {
    // (Artillery not yet set up looks a little inside its reach: a shell throws what it hits, and it should not have to
    // pack up and come on again after every one.)
    const range = this.rangeOf(u, def, w) * (def.deploy && u.deployedAt === 0 ? 0.9 : 1);
    const order = u.order;
    let state: "fire" | "none" = "none";
    /** A wall of the enemy's between it and its target: shot first. */
    let wall: string | null = null;
    if (order.k === "attack" && this.canHit(u.x, u.z, def.air ? SKY : u.level, !!def.air, u.owner, w, range, order.tk, order.id, true) === "ok") {
      wall = this.shotWall;
      if (u.tk !== order.tk || u.tid !== order.id) this.aimAt(u, w, order.tk, order.id);
      state = "fire";
    } else {
      // (Its ordered target out of reach for now: anything else in range meanwhile.)
      if (order.k === "attack" && u.tk === order.tk && u.tid === order.id) {
        this.pledge(u, w, -1);
        u.tk = 0;
      }
      if (u.tk) {
        state = this.judge(u, def, w, range);
        wall = this.shotWall;
      }
      // Looks again now and then, each unit on its own step (and soon, with nothing to shoot): something better may
      // have come within range.
      if ((this.step + i) % 10 === 0 || (state === "none" && (this.step + i) % 3 === 0)) {
        const pick = this.choose(u, def, w, range);
        if (pick && (pick.tk !== u.tk || pick.tid !== u.tid)) {
          const now = state === "fire" ? this.scoreOf(u, w, range, u.tk as TargetKind, u.tid, true) : Infinity;
          // (A shot it has now is worth keeping unless the other is a good deal better.)
          if (pick.score < now - 0.35) {
            this.aimAt(u, w, pick.tk, pick.tid);
            state = this.judge(u, def, w, range);
            wall = this.shotWall;
          }
        }
      }
    }
    if (state === "none" || !u.tk) {
      u.aim = u.heading;
      return "none";
    }
    // The gun turns to the target (or the wall in its way); a soldier (or a drone) turns with it, a vehicle's hull keeps to where it drives.
    const spot = wall ? this.spotOf(T_PIECE, wall) : this.spotOf(u.tk, u.tid);
    if (spot) {
      u.aim = Math.atan2(spot[0] - u.x, spot[1] - u.z);
      // (On the move, it keeps facing the way it goes: it shoots as it passes.)
      if (!moving && (def.infantry || def.air || def.deploy)) u.heading = u.aim;
    }
    // Artillery fires only once set up.
    if (def.deploy) {
      if (u.deployedAt === 0) {
        if (this.t >= u.packedAt) u.deployedAt = this.t + def.deploy;
        return "fire";
      }
      if (this.t < u.deployedAt) return "fire";
    }
    if (this.t >= u.coolAt) {
      u.coolAt = this.t + w.cooldown;
      if (wall) this.shoot([u.x, u.y + def.height * 0.7, u.z], u.owner, w, T_PIECE, wall, u.id);
      else this.shoot([u.x, u.y + def.height * 0.7, u.z], u.owner, w, u.tk, u.tid, u.id);
    }
    return "fire";
  }

  /** Aims at a new target. */
  private aimAt(u: Unit, w: Weapon, tk: TargetKind, tid: number | string): void {
    this.pledge(u, w, -1);
    u.tk = tk;
    u.tid = tid;
    this.pledge(u, w, 1);
  }

  /** Whether the target it has can be shot from here now: "fire", or it is let go ("none"). */
  private judge(u: Unit, def: UnitDef, w: Weapon, range: number): "fire" | "none" {
    if (this.canHit(u.x, u.z, def.air ? SKY : u.level, !!def.air, u.owner, w, range, u.tk as TargetKind, u.tid, false) === "ok") return "fire";
    this.pledge(u, w, -1);
    u.tk = 0;
    return "none";
  }

  /** Damage each unit target is about to take in the next second, from those aiming at it: so the next unit to choose picks another once one is covered. */
  private readonly pledged = new Map<number, number>();

  private pledge(u: Unit, w: Weapon, sign: 1 | -1): void {
    if (u.tk !== T_UNIT) return;
    const id = u.tid as number;
    const left = (this.pledged.get(id) ?? 0) + sign * (w.damage / w.cooldown);
    if (left > 0.01) this.pledged.set(id, left);
    else this.pledged.delete(id);
  }

  /**
   * How much a unit wants a target (lower is better): near, suited to its
   * weapon (rifles at soldiers, guns and shells at vehicles and buildings,
   * anti-air at drones), nearly finished, shooting at it, and not already
   * covered by others' fire. A little its own, too, so neighbours spread.
   */
  private scoreOf(u: Unit, w: Weapon, range: number, tk: TargetKind, tid: number | string, current: boolean): number {
    const heavy = w.splash > 0 || w.damage >= 20;
    if (tk === T_UNIT) {
      const o = this.unitById.get(tid as number);
      if (!o || o.dead) return Infinity;
      const od = UNITS[o.kind];
      let s = Math.hypot(o.x - u.x, o.z - u.z) / range;
      if (od.air) s -= w.ground ? 0.1 : 0.6;
      else if (od.infantry) s += heavy ? 0.15 : -0.3;
      else s += heavy ? -0.35 : 0.15;
      if (!od.weapon) s += 0.3;
      s -= 0.35 * (1 - Math.max(0, o.hp) / od.hp);
      if (o.tk === T_UNIT && o.tid === u.id) s -= 0.3;
      const p = (this.pledged.get(o.id) ?? 0) - (current ? w.damage / w.cooldown : 0);
      s += p >= o.hp ? 1.5 : (0.5 * p) / o.hp;
      return s + scatter(u.id, o.id) * 0.15;
    }
    if (tk === T_BUILDING) {
      const b = this.buildings.get(tid as number);
      if (!b || b.dead) return Infinity;
      const c = this.centreOf(b);
      const d = Math.max(0, Math.hypot(c[0] - u.x, c[2] - u.z) - (BUILDINGS[b.kind].size * CELL) / 2);
      return d / range + 0.55 - (heavy ? 0.3 : 0) - (BUILDINGS[b.kind].weapon ? 0.25 : 0) + scatter(u.id, b.id) * 0.1;
    }
    // (A piece: only when there is nothing else in range, the nearest first.)
    const at = this.spotOf(T_PIECE, tid);
    return 10 + (at ? Math.hypot(at[0] - u.x, at[1] - u.z) / range : 1);
  }

  /**
   * What a unit would shoot now, of what is in its range: the best scored enemy unit or building it can hit (a clear
   * line better than one through a wall of the enemy's, which it would have to break first); with none, and a weapon
   * that breaks them, the nearest wall, floor or ramp of the enemy's (see `nearestPiece`).
   */
  private choose(u: Unit, def: UnitDef, w: Weapon, range: number): { tk: TargetKind; tid: number | string; score: number } | null {
    const air = !!def.air, level = air ? SKY : u.level;
    const min = w.minRange ?? 0;
    const found: { tk: TargetKind; tid: number; score: number }[] = [];
    this.nearby(u.x, u.z, range, (o) => {
      if (o.dead || o.inside || !this.hostile(u.owner, o.owner)) return;
      if (UNITS[o.kind].air ? !w.air : !w.ground) return;
      const d = Math.hypot(o.x - u.x, o.z - u.z);
      if (d > range || (min && d < min)) return;
      found.push({ tk: T_UNIT, tid: o.id, score: this.scoreOf(u, w, range, T_UNIT, o.id, false) });
    });
    if (w.ground) {
      for (const b of this.buildings.values()) {
        if (b.dead || !this.hostile(u.owner, b.owner)) continue;
        const c = this.centreOf(b);
        const d = Math.max(0, Math.hypot(c[0] - u.x, c[2] - u.z) - (BUILDINGS[b.kind].size * CELL) / 2);
        if (d > range || (min && d < min)) continue;
        found.push({ tk: T_BUILDING, tid: b.id, score: this.scoreOf(u, w, range, T_BUILDING, b.id, false) });
      }
    }
    found.sort((a, b) => a.score - b.score);
    let walled: { tk: TargetKind; tid: number; score: number } | null = null;
    for (const f of found.slice(0, 6)) {
      if (this.canHit(u.x, u.z, level, air, u.owner, w, range, f.tk, f.tid, false) !== "ok") continue;
      if (!this.shotWall) return f;
      walled ??= { ...f, score: f.score + 0.4 };
    }
    if (walled) return walled;
    if (w.wear > 0) {
      const piece = this.nearestPiece(u.x, u.z, u.owner, range, min);
      if (piece) return { tk: T_PIECE, tid: piece, score: this.scoreOf(u, w, range, T_PIECE, piece, false) };
    }
    return null;
  }

  /** Every piece some army holds, by the bucket it stands in (see `nearestPiece`): worked out again as the build changes, not more than twice a second. */
  private readonly pieceBuckets = new Map<number, { id: string; x: number; z: number }[]>();
  private piecesAt = -1;
  private piecesOf = -1;

  /** The nearest wall, floor or ramp within `range` of a spot (and not nearer than `min`) that an army hostile to `owner` holds, by id; or null. Nobody's are not shot at unless in the way. */
  private nearestPiece(x: number, z: number, owner: number, range: number, min: number): string | null {
    if (this.piecesOf !== this.nav.version && (this.piecesAt < 0 || this.t - this.piecesAt >= 0.5)) {
      this.piecesOf = this.nav.version;
      this.piecesAt = this.t;
      this.pieceBuckets.clear();
      for (const p of this.build.all()) {
        if (this.ownerOfPiece(p.id) === NO_OWNER) continue;
        const at = this.spotOf(T_PIECE, p.id)!;
        const k = bucketOf(at[0], at[1]);
        const list = this.pieceBuckets.get(k);
        if (list) list.push({ id: p.id, x: at[0], z: at[1] });
        else this.pieceBuckets.set(k, [{ id: p.id, x: at[0], z: at[1] }]);
      }
    }
    if (this.pieceBuckets.size === 0) return null;
    const half = HALF_CELLS * CELL;
    const x0 = Math.max(0, Math.floor((x - range + half) / BUCKET)), x1 = Math.min(BUCKETS - 1, Math.floor((x + range + half) / BUCKET));
    const z0 = Math.max(0, Math.floor((z - range + half) / BUCKET)), z1 = Math.min(BUCKETS - 1, Math.floor((z + range + half) / BUCKET));
    let best: string | null = null, bestD = range;
    for (let bx = x0; bx <= x1; bx++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (const p of this.pieceBuckets.get(bx * BUCKETS + bz) ?? []) {
          // (As canHit measures it: to the piece's near edge.)
          const d = Math.hypot(p.x - x, p.z - z) - CELL / 2;
          if (d > bestD || (min && d < min)) continue;
          const whose = this.ownerOfPiece(p.id);
          if (whose === NO_OWNER || !this.hostile(owner, whose) || !this.build.get(p.id)) continue;
          best = p.id;
          bestD = d;
        }
      }
    }
    return best;
  }

  /**
   * After `canHit` said "ok": the wall (or floor, or ramp) that stands
   * between, which the shot hits instead of the target (null: nothing
   * between, the target is hit).
   */
  private shotWall: string | null = null;
  /** After a `lineOfFire` that a piece stopped: that piece (a wall, a floor or a ramp) and whose it is; null when it was a building, or nothing. */
  private lineBlock: { id: string; owner: number } | null = null;

  /**
   * Whether a shot from a spot on one storey reaches a spot on another (SKY:
   * in the air). Every wall stops it, whoever built it: walls are shields both
   * ways, so an army behind its own wall shoots out only from above it (they
   * are looked for on the higher end's storey). Floors and ramps are shields
   * too: a shot between two heights is stopped by one over its lower end,
   * below the higher (a roof shelters from a drone, and from a unit up on a
   * deck). A straight shot from the ground is stopped by a building too; a
   * shell in an arc, a drone and a turret (`over`) go over buildings. The
   * piece that stops it is noted in `lineBlock`.
   */
  private lineOfFire(x: number, z: number, fl: number, tx: number, tz: number, tl: number, slack: number, over: boolean): boolean {
    this.lineBlock = null;
    // Walls: on the storey of the higher end that is not in the air (in the air, both: none to cross).
    const wl = Math.max(fl === SKY ? -1 : fl, tl === SKY ? -1 : tl);
    if (wl >= 0 && !this.nav.clearLine(x, z, tx, tz, wl, slack, -1, over)) {
      const lw = this.nav.lineWall;
      const wall = lw ? this.build.occupant({ type: "wall", x: lw.x, y: lw.l, z: lw.z, rot: lw.rot }) : null;
      if (wall) this.lineBlock = { id: wall.id, owner: lw!.owner };
      return false;
    }
    // A roof over the lower end.
    if (fl !== tl) {
      const low = fl < tl;
      const r = this.nav.roofOver(low ? x : tx, low ? z : tz, Math.min(fl, tl), Math.max(fl, tl));
      if (r >= 0) {
        const cx = Math.floor((low ? x : tx) / CELL), cz = Math.floor((low ? z : tz) / CELL);
        const roof = this.build.occupant({ type: "floor", x: cx, y: r, z: cz, rot: 0 }) ?? this.build.occupant({ type: "ramp", x: cx, y: r, z: cz, rot: 0 });
        if (roof) this.lineBlock = { id: roof.id, owner: Math.min(NO_OWNER, this.ownerOfPiece(roof.id)) };
        return false;
      }
    }
    return true;
  }

  /**
   * Whether a weapon at a spot (`level`: its storey, SKY for a drone; `over`:
   * it shoots over buildings, a drone or a turret) can hit a target now:
   * "ok", "far" (out of range or no line), or "gone". Behind a wall, floor or
   * ramp of the enemy's (or nobody's) that the weapon can wear, "ok": that is
   * hit first (see `shotWall`). Its own army's never is.
   */
  private canHit(x: number, z: number, level: number, over: boolean, owner: number, w: Weapon, range: number, tk: TargetKind, tid: number | string, ordered: boolean): "ok" | "far" | "gone" {
    this.shotWall = null;
    let tx: number, tz: number, tl = 0, slack = 0, flying = false;
    if (tk === T_UNIT) {
      const t = this.unitById.get(tid as number);
      if (!t || t.dead || t.inside) return "gone";
      if (!ordered && !this.hostile(owner, t.owner)) return "gone";
      flying = !!UNITS[t.kind].air;
      if (flying ? !w.air : !w.ground) return "gone";
      tx = t.x;
      tz = t.z;
      tl = flying ? SKY : t.level;
    } else if (tk === T_BUILDING) {
      const b = this.buildings.get(tid as number);
      if (!b || b.dead || !w.ground) return "gone";
      if (!ordered && !this.hostile(owner, b.owner)) return "gone";
      [tx, , tz] = this.centreOf(b);
      tl = b.l;
      slack = (BUILDINGS[b.kind].size * CELL) / 2;
    } else if (tk === T_GENERAL) {
      // A general is never hit: no gun ever shoots at one.
      return "gone";
    } else {
      const p = this.build.get(tid as string);
      if (!p || w.wear <= 0) return "gone";
      [tx, tz] = this.spotOf(T_PIECE, tid)!;
      slack = CELL / 2;
      // (A piece is what is in the way: no line through it is needed.)
      return Math.hypot(tx - x, tz - z) - slack <= range ? "ok" : "far";
    }
    const d = Math.hypot(tx - x, tz - z) - slack;
    if (d > range || (w.minRange && d < w.minRange)) return "far";
    if (!this.lineOfFire(x, z, level, tx, tz, tl, slack, !!w.lob || over || flying)) {
      // A piece of the enemy's in the way, that this weapon wears: that is what it shoots, until it is down.
      const lb = this.lineBlock;
      // (One nobody's army holds any more is anyone's to break.)
      if (!lb || w.wear <= 0 || (lb.owner !== NO_OWNER && !this.hostile(owner, lb.owner))) return "far";
      const at = this.spotOf(T_PIECE, lb.id);
      if (!at || (w.minRange && Math.hypot(at[0] - x, at[1] - z) < w.minRange)) return "far";
      this.shotWall = lb.id;
    }
    return "ok";
  }

  /** The nearest enemy a weapon at a spot (as `canHit`) can hit with a clear line, or null. */
  private findTarget(x: number, z: number, level: number, over: boolean, owner: number, w: Weapon, range: number): [TargetKind, number] | null {
    let best: [TargetKind, number] | null = null, bestD = range * range;
    const min2 = (w.minRange ?? 0) ** 2;
    this.nearby(x, z, range, (o) => {
      if (o.dead || o.inside || !this.hostile(owner, o.owner)) return;
      const flying = !!UNITS[o.kind].air;
      if (flying ? !w.air : !w.ground) return;
      const d = dist2(x, z, o.x, o.z);
      if (d >= bestD || d < min2) return;
      if (!this.lineOfFire(x, z, level, o.x, o.z, flying ? SKY : o.level, 0, !!w.lob || over || flying)) return;
      bestD = d;
      best = [T_UNIT, o.id];
    });
    if (best || !w.ground) return best;
    for (const b of this.buildings.values()) {
      if (b.dead || !this.hostile(owner, b.owner)) continue;
      const c = this.centreOf(b);
      const d = Math.max(0, Math.hypot(c[0] - x, c[2] - z) - (BUILDINGS[b.kind].size * CELL) / 2);
      if (d * d >= bestD || d * d < min2) continue;
      if (!this.lineOfFire(x, z, level, c[0], c[2], b.l, (BUILDINGS[b.kind].size * CELL) / 2, !!w.lob || over)) continue;
      bestD = d * d;
      best = [T_BUILDING, b.id];
    }
    return best;
  }

  /** A weapon fires at a target: it lands at once, or (a shell in an arc) where the target was, a moment later. */
  private shoot(from: Vec, owner: number, w: Weapon, tk: TargetKind, tid: number | string, by = 0): void {
    const spot = this.spotOf(tk, tid);
    if (!spot) return;
    const g = this.generals[owner];
    const damage = w.damage * (1 + (g?.upgrades.weapons ?? 0) * UPGRADE_STEP);
    const piece = tk === T_PIECE ? this.build.get(tid as string) : undefined;
    // (A wall is hit at chest height, a floor or ramp at its top: a roof a shell bursts on shelters those under it.)
    const ty = tk === T_UNIT ? (this.unitById.get(tid as number)?.y ?? 0) + 1 : tk === T_BUILDING ? (this.buildings.get(tid as number)?.l ?? 0) * LEVEL + 2 : (piece?.y ?? 0) * LEVEL + (piece?.type === "wall" ? 1.5 : 0.6);
    const to: Vec = [spot[0], ty, spot[1]];
    if (tk === T_PIECE) {
      // A wall is hit on the face toward the shooter: what it blows up is on that side, and those behind are sheltered.
      const d = Math.hypot(from[0] - to[0], from[2] - to[2]);
      if (d > 0.01) {
        to[0] += ((from[0] - to[0]) / d) * 0.4;
        to[2] += ((from[2] - to[2]) / d) * 0.4;
      }
    }
    if (w.lob) {
      const time = Math.max(1, Math.hypot(to[0] - from[0], to[2] - from[2]) / SHELL_SPEED);
      this.shells.push({ x: to[0], z: to[2], landAt: this.t + time, owner, weapon: w, damage });
      this.happened.shots.push({ from, to: [to[0], this.nav.topRoof(to[0], to[2]) * LEVEL, to[2]], look: w.look, time, owner, hit: 0, by });
      return;
    }
    this.happened.shots.push({ from, to, look: w.look, time: 0, owner, hit: tk === T_UNIT ? (tid as number) : tk === T_BUILDING ? -(tid as number) : 0, by });
    if (w.splash > 0) return this.blast(to, w.splash, damage, owner, w);
    if (tk === T_UNIT) {
      const t = this.unitById.get(tid as number);
      if (t) this.hurtUnit(t, damage, owner, from[0], from[2]);
    } else if (tk === T_BUILDING) {
      const b = this.buildings.get(tid as number);
      if (b) this.hurtBuilding(b, damage, owner);
    } else if (w.wear > 0) this.wearPiece(tid as string, w.wear, to, owner);
  }

  /** A blast: everything of the enemy's near it is hurt (less at its edge) and thrown, and pieces are worn. Generals are never touched. */
  blast(at: Vec, radius: number, damage: number, owner: number, w: Pick<Weapon, "air" | "ground" | "wear">): void {
    this.happened.blasts.push({ at, radius });
    // (In the air: well above the ground, and above any roof there a shell may have burst on.)
    const air = at[1] > FLIGHT_HEIGHT / 2 && at[1] > this.nav.topRoof(at[0], at[2]) * LEVEL + 2;
    // (The storey it bursts on: the ground, or a floor a shell came down on.)
    const storey = Math.max(0, Math.round((at[1] - 0.5) / LEVEL));
    this.nearby(at[0], at[2], radius + 4, (o) => {
      if (o.dead || o.inside || (owner !== -1 && !this.hostile(owner, o.owner))) return;
      const def = UNITS[o.kind];
      // A blast on the ground does not reach the drones, nor one in the air the ground.
      if (!!def.air !== air) return;
      const d = Math.hypot(o.x - at[0], o.z - at[2]) - def.radius;
      if (d > radius) return;
      // A wall, floor or ramp between shelters from the blast, whoever's (one in the air has nothing between).
      if (!air && !this.lineOfFire(at[0], at[2], storey, o.x, o.z, o.level, 0, true)) return;
      const near = 1 - 0.6 * Math.max(0, d / radius);
      this.hurtUnit(o, damage * near, owner, at[0], at[2]);
      if (!o.dead && !def.air) this.throwUnit(o, at, near, damage);
    });
    if (air) return;
    for (const b of [...this.buildings.values()]) {
      if (b.dead || (owner !== -1 && !this.hostile(owner, b.owner))) continue;
      const c = this.centreOf(b);
      const d = Math.max(0, Math.hypot(c[0] - at[0], c[2] - at[2]) - (BUILDINGS[b.kind].size * CELL) / 2);
      if (d <= radius && this.lineOfFire(at[0], at[2], storey, c[0], c[2], b.l, (BUILDINGS[b.kind].size * CELL) / 2, true)) this.hurtBuilding(b, damage * (1 - 0.6 * (d / radius)), owner);
    }
    if (w.wear > 0) {
      const seen = new Set<string>();
      for (const p of this.build.near(at[0], at[1], at[2])) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const whose = this.ownerOfPiece(p.id);
        if (owner !== -1 && whose !== NO_OWNER && !this.hostile(owner, whose)) continue;
        if (distanceToPiece(p, at, this.env) <= radius) this.wearPiece(p.id, w.wear, at, owner);
      }
    }
  }

  private hurtUnit(u: Unit, damage: number, _by: number, _fromX: number, _fromZ: number): void {
    const g = this.generals[u.owner];
    u.hp -= damage * (1 - (g?.upgrades.armour ?? 0) * UPGRADE_STEP);
    u.hitUntil = this.t + 0.3;
    if (u.hp <= 0) return this.kill(u, false);
    // (Shot at, a unit does nothing about it of its own: it shoots back only what comes within its range.)
    if (g) this.underAttack(g, u.x, u.z);
  }

  private hurtBuilding(b: Building, damage: number, _by: number): void {
    const g = this.generals[b.owner];
    b.hp -= damage * (1 - (g?.upgrades.armour ?? 0) * UPGRADE_STEP);
    b.rev++;
    if (b.hp <= 0) return this.raze(b, false);
    if (g) this.underAttack(g, ...xz(this.centreOf(b)));
  }

  private underAttack(g: General, x: number, z: number): void {
    if (this.t - g.alertAt < 12) return;
    g.alertAt = this.t;
    this.note(g.slot, "You are under attack", "attack", x, z);
  }

  /**
   * A unit is thrown away from a blast: a vehicle rolls and tumbles to where
   * it lands, a Trooper flies there flailing, and both lie a moment. The
   * bigger the hit, the further. (Bullets throw nobody: only blasts come here.)
   */
  private throwUnit(u: Unit, from: Vec, near: number, damage: number): void {
    const def = UNITS[u.kind];
    const force = Math.max(0.8, Math.min(2.1, 0.6 + damage / 50));
    // The heavier, the less far.
    const far = ((3 + 6 * near) / Math.sqrt(def.radius)) * force * (u.kind === "titan" ? 0.3 : 1);
    let dx = u.x - from[0], dz = u.z - from[2];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) {
      const a = scatter(u.id, this.step) * Math.PI * 2;
      dx = Math.sin(a);
      dz = Math.cos(a);
    } else {
      dx /= len;
      dz /= len;
    }
    const start: Vec = [u.x, u.y, u.z];
    // A metre at a time, so a wall stops it.
    for (let d = 0; d < far; d += 1) this.shift(u, u.x + dx, u.z + dz, classOf(def));
    const time = Math.min(2.4, 0.7 + far * 0.09);
    u.downUntil = this.t + time + 0.6;
    u.goal = u.goal ? { ...u.goal, set: false } : null;
    if (def.deploy) {
      u.deployedAt = 0;
      u.packedAt = this.t + time;
    }
    this.happened.tumbles.push({ id: u.id, from: start, to: [u.x, u.y, u.z], time });
  }

  private wearPiece(id: string, hits: number, at: Vec, by: number): void {
    // Walls give way four times as fast as floors and ramps (WALL_WEAR).
    if (this.build.get(id)?.type === "wall") hits *= WALL_WEAR;
    const w = this.worn.get(id);
    if (w) w.hits += hits;
    else this.worn.set(id, { hits, at, by });
  }

  /** Passes the wear of the last few steps on to the build, in one go. */
  private passWear(): void {
    if (this.worn.size === 0) return;
    const list: [string, number][] = [];
    let at: Vec = [0, 0, 0], by = NEUTRAL;
    for (const [id, w] of this.worn) {
      list.push([id, Math.round(w.hits * 1000) / 1000]);
      at = w.at;
      by = w.by;
    }
    this.worn.clear();
    this.host.wear(at, list, by >= 0 && by < MAX_GENERALS ? (this.generals[by]?.here[0] ?? "army") : "army");
  }

  /** Shells in the air come down: unless a laser of the other side is near enough to shoot one out of the sky. */
  private landShells(): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]!;
      if (this.t < s.landAt) continue;
      this.shells.splice(i, 1);
      let zapped = false;
      for (const b of this.buildings.values()) {
        if (b.kind !== "laser" || b.dead || b.doneAt !== 0 || this.t < b.coolAt || this.t < b.stunUntil || !this.hostile(s.owner, b.owner)) continue;
        const c = this.centreOf(b);
        if (Math.hypot(c[0] - s.x, c[2] - s.z) > 30) continue;
        b.coolAt = this.t + 3;
        this.happened.zaps.push({ from: [c[0], c[1] + BUILDINGS.laser.height, c[2]], to: [s.x, c[1] + 9, s.z] });
        zapped = true;
        break;
      }
      // It bursts on whatever is highest where it comes down: a roof over those under it (which it wears), or the ground.
      if (!zapped) this.blast([s.x, this.nav.topRoof(s.x, s.z) * LEVEL + 0.5, s.z], s.weapon.splash, s.damage, s.owner, s.weapon);
    }
  }

  /** A turret looks for something to shoot. */
  private guard(b: Building): void {
    const w = BUILDINGS[b.kind].weapon;
    if (!w || b.dead || b.doneAt !== 0 || this.t < b.stunUntil) return;
    const c = this.centreOf(b);
    let wall: string | null = null;
    if (b.tk) {
      if (this.canHit(c[0], c[2], b.l, true, b.owner, w, w.range, b.tk, b.tid, false) !== "ok") b.tk = 0;
      else wall = this.shotWall;
    }
    if (!b.tk && (this.step + b.id) % 3 === 0) {
      // (A turret stands above buildings and shoots over them; every wall stops it, its own army's too. Up on a floor,
      // it shoots over the walls below.)
      const found = this.findTarget(c[0], c[2], b.l, true, b.owner, w, w.range);
      if (found) {
        b.tk = found[0];
        b.tid = found[1];
      }
    }
    if (b.tk && this.t >= b.coolAt) {
      b.coolAt = this.t + w.cooldown;
      if (wall) this.shoot([c[0], c[1] + BUILDINGS[b.kind].height * 0.8, c[2]], b.owner, w, T_PIECE, wall);
      else this.shoot([c[0], c[1] + BUILDINGS[b.kind].height * 0.8, c[2]], b.owner, w, b.tk, b.tid);
    }
  }

  // ── Haulers ────────────────────────────────────────────────────────────

  /** Which Hauler is digging at each crystal patch (one at a time). */
  private readonly digger = new Map<number, number>();

  /**
   * A Hauler's round: to the crystals (1), dig (2), to the nearest Core (3),
   * and back. A patch someone else is digging at sends it to another of the
   * same field.
   */
  private haul(u: Unit): void {
    const def = UNITS.hauler;
    const g = this.generals[u.owner];
    if (u.phase === 2) {
      if (this.t < u.digUntil) return;
      const f = this.fieldById.get(u.field);
      if (this.digger.get(u.field) === u.id) this.digger.delete(u.field);
      if (f && f.amount > 0) {
        u.carry = Math.min(LOAD, f.amount);
        f.amount -= u.carry;
        if (f.amount <= 0) f.refillAt = this.t * 1000 + REFILL_MS;
      }
      u.phase = 3;
      u.goal = null;
    }
    if (u.phase === 3) {
      if (u.carry <= 0 && u.order.k === "gather") {
        u.phase = 1;
        u.goal = null;
      } else {
        const core = this.nearestCore(u);
        if (!core) {
          // Nowhere to take it: waits where it is.
          u.goal = null;
          return;
        }
        // Its Core gone (or a nearer one put down): to the nearest now.
        if (this.haulTo.get(u.id) !== core.id) {
          this.haulTo.set(u.id, core.id);
          u.goal = null;
        }
        if (!u.goal) {
          const c = this.centreOf(core);
          this.route(u, c[0], c[2], this.nav.around(core.cx, core.cz, 3), 0.5, false);
        }
        this.travel(u, def);
        const c = this.centreOf(core);
        if (u.arrived || Math.max(Math.abs(u.x - c[0]), Math.abs(u.z - c[2])) < BUILDINGS.core.size * CELL * 0.5 + 2.6) {
          if (g) g.lithium += u.carry * upkeep(this.supplyOf(g.slot));
          u.carry = 0;
          u.goal = null;
          u.arrived = false;
          this.haulTo.delete(u.id);
          if (u.order.k === "return") return this.done(u);
          // Then the best crystals for it now (from this Core, or another nearer them).
          u.phase = 1;
          const next = this.choosePatch(u);
          if (next) u.field = next.id;
        }
        return;
      }
    }
    // Phase 1: to the crystals.
    let f = this.fieldById.get(u.field);
    if (!f || f.kind !== "crystal" || f.amount <= 0) {
      // (Mined out: the best of the rest, wherever that is; none, it waits and is tried again.)
      const other = this.choosePatch(u);
      if (!other) return this.done(u);
      f = other;
      u.field = f.id;
      u.goal = null;
    }
    if (!u.goal) this.route(u, mid(f.cx), mid(f.cz), this.nav.around(f.cx, f.cz, 1), 0.5, false);
    this.travel(u, def);
    if (u.arrived || Math.max(Math.abs(u.x - mid(f.cx)), Math.abs(u.z - mid(f.cz))) < CELL * 0.5 + 2.4) {
      const busy = this.digger.get(f.id);
      if (busy !== undefined && busy !== u.id && this.unitById.has(busy)) {
        // Someone is at it: another patch of this field, if one is free.
        const other = this.otherPatch(u, f, true);
        if (other) {
          u.field = other.id;
          u.goal = null;
          u.arrived = false;
        }
        return;
      }
      this.digger.set(f.id, u.id);
      u.phase = 2;
      u.digUntil = this.t + DIG_TIME;
      u.goal = null;
      u.arrived = false;
      u.heading = Math.atan2(mid(f.cx) - u.x, mid(f.cz) - u.z);
    }
  }

  private nearestCore(u: Unit): Building | null {
    let best: Building | null = null, bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.owner !== u.owner || b.kind !== "core" || b.dead || b.doneAt !== 0) continue;
      const c = this.centreOf(b);
      const d = dist2(u.x, u.z, c[0], c[2]);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Another crystal patch of the same field with something in it (and, with `free`, nobody digging). */
  private otherPatch(u: Unit, f: Field | undefined, free = false): Field | null {
    let best: Field | null = null, bestD = Infinity;
    for (const o of this.fields) {
      if (o.kind !== "crystal" || o.amount <= 0 || o === f || (f && o.site !== f.site)) continue;
      if (free && this.digger.has(o.id) && this.unitById.has(this.digger.get(o.id)!)) continue;
      const d = dist2(u.x, u.z, mid(o.cx), mid(o.cz));
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  // ── Transports and the EMP ─────────────────────────────────────────────

  /** A ground unit goes to a transport and gets in. */
  private board(u: Unit, order: Extract<Order, { k: "load" }>): void {
    const into = this.unitById.get(order.into);
    const def = UNITS[u.kind];
    if (!into || into.dead || into.kind !== "transport" || !this.sameSide(u.owner, into.owner)) return this.done(u);
    const used = into.cargo.reduce((n, id) => n + (UNITS[this.unitById.get(id)?.kind ?? "trooper"].supply), 0);
    if (dist2(u.x, u.z, into.x, into.z) < 4.5 * 4.5) {
      if (used + def.supply > (UNITS.transport.cargo ?? 0)) return this.done(u);
      into.cargo.push(u.id);
      u.inside = into.id;
      u.goal = null;
      u.tk = 0;
      u.order = { k: "stop" };
      return;
    }
    if (!u.goal || dist2(u.goal.x, u.goal.z, into.x, into.z) > 9) this.head_(u, into.x, into.z, 0, 0.5, false);
    this.travel(u, def);
    // As near as it can get and still not there: it gives up when stuck.
    if (u.arrived && dist2(u.x, u.z, into.x, into.z) >= 4.5 * 4.5) this.done(u);
  }

  private sameSide(a: number, b: number): boolean {
    return a === b || this.teamOf(a) === this.teamOf(b);
  }

  /** A transport flies to a spot and sets everyone down round it. */
  private unload(u: Unit, order: Extract<Order, { k: "unload" }>): void {
    this.travel(u, UNITS[u.kind]);
    if (!u.arrived && dist2(u.x, u.z, order.x, order.z) > 9) return;
    for (const id of u.cargo) {
      const inside = this.unitById.get(id);
      if (!inside) continue;
      inside.inside = 0;
      this.putOnGround(inside, u.x + (scatter(id, 3) - 0.5) * 8, u.z + (scatter(id, 5) - 0.5) * 8);
      inside.order = { k: "stop" };
      inside.arrived = true;
    }
    u.cargo = [];
    this.done(u);
  }

  /** An EMP drone flies within reach of a spot and pulses: every enemy unit and building near the spot stops for a while. */
  private pulse(u: Unit, order: Extract<Order, { k: "emp" }>): void {
    if (dist2(u.x, u.z, order.x, order.z) > EMP.range * EMP.range) return this.travel(u, UNITS[u.kind]);
    if (this.t < u.empAt) return;
    u.empAt = this.t + EMP.cooldown;
    this.happened.pulses.push({ x: order.x, z: order.z });
    this.nearby(order.x, order.z, EMP.radius, (o) => {
      if (!o.dead && this.hostile(u.owner, o.owner) && dist2(o.x, o.z, order.x, order.z) <= EMP.radius * EMP.radius) o.stunUntil = this.t + EMP.stun;
    });
    for (const b of this.buildings.values()) {
      const c = this.centreOf(b);
      if (this.hostile(u.owner, b.owner) && Math.hypot(c[0] - order.x, c[2] - order.z) <= EMP.radius + (BUILDINGS[b.kind].size * CELL) / 2) {
        b.stunUntil = this.t + EMP.stun;
        b.rev++;
      }
    }
    this.done(u);
  }

  // ── Getting about ──────────────────────────────────────────────────────

  /** Where the middle of each group on the march is now (by group): see speedOf. */
  private readonly marching = new Map<number, { x: number; z: number; n: number }>();

  /** Works out the middle of every group of more than one on its way somewhere, once a step. */
  private marchCentres(): void {
    this.marching.clear();
    for (const u of this.units) {
      if (u.dead || u.inside || !u.pace || u.arrived || !u.goal) continue;
      const m = this.marching.get(u.group);
      if (m) {
        m.x += u.x;
        m.z += u.z;
        m.n++;
      } else this.marching.set(u.group, { x: u.x, z: u.z, n: 1 });
    }
  }

  /**
   * How fast a unit goes, m/s. Alone, as fast as it can. Ordered with others, at the pace of the slowest of them, and
   * keeping its place in their shape: its place is the middle of the group now and its own spot from the middle (as it
   * stood when ordered). Behind its place, it goes faster to catch up (as fast as it can); ahead, it holds back.
   */
  private speedOf(u: Unit, def: UnitDef): number {
    if (!u.pace || !u.goal) return def.speed;
    const pace = Math.min(def.speed, u.pace);
    const m = this.marching.get(u.group);
    if (!m || m.n < 2) return pace;
    const px = m.x / m.n + (u.goal.ox - u.goal.x), pz = m.z / m.n + (u.goal.oz - u.goal.z);
    // How far its place is ahead of it, along the way it goes (a little either way is near enough).
    const along = (px - u.x) * Math.sin(u.heading) + (pz - u.z) * Math.cos(u.heading);
    const off = along > 1.5 ? along - 1.5 : along < -1.5 ? along + 1.5 : 0;
    return Math.max(pace * 0.6, Math.min(def.speed, pace + off * 0.6));
  }

  /** Moves a unit one step toward its goal. Sets `arrived` when it is there (or as near as it will get). */
  private travel(u: Unit, def: UnitDef): void {
    const goal = u.goal;
    if (!goal || u.arrived) return;
    // Artillery waits until it has packed up.
    if (def.deploy && this.t < u.packedAt) return;
    const reach = this.speedOf(u, def) * DT;
    // How far it still is from its own spot.
    const near = Math.hypot(goal.ox - u.x, goal.oz - u.z);
    if (def.air) {
      if (near <= 0.8) {
        u.arrived = true;
        return;
      }
      u.heading = Math.atan2(goal.ox - u.x, goal.oz - u.z);
      const s = Math.min(reach, near);
      u.x = clampEdge(u.x + ((goal.ox - u.x) / near) * s);
      u.z = clampEdge(u.z + ((goal.oz - u.z) / near) * s);
      // (How high: see flyOver.)
      return;
    }
    if (near <= 0.7 + def.radius * 0.4 && this.t >= u.downUntil) {
      u.arrived = true;
      return;
    }
    // Near enough for long enough (the spot itself is taken, or cannot be stood on): that will do.
    if (near < goal.radius * 2 + 8) {
      u.linger += DT;
      if (u.linger > 4) {
        u.arrived = true;
        return;
      }
    }
    if (!goal.set) {
      const flow = this.flowOf(u, goal);
      const here = this.nav.distance(flow, u.level, u.cx, u.cz);
      if (Math.floor(goal.ox / CELL) === u.cx && Math.floor(goal.oz / CELL) === u.cz && here < INF) {
        // In the cell its own spot is in: straight to it.
        goal.wx = goal.ox;
        goal.wz = goal.oz;
        goal.set = true;
      } else {
        const dx = (goal.ox - u.x) / (near || 1), dz = (goal.oz - u.z) / (near || 1);
        // On the way: whichever open way leads on and points most nearly at its own spot. Close by: any open way toward the spot.
        let way = here >= INF ? SHUT_WAY : this.nav.toward(flow, u.level, u.cx, u.cz, dx, dz, here <= goal.reach);
        if (way === SHUT_WAY && here < INF && here > 0) way = here <= goal.reach ? this.nav.toward(flow, u.level, u.cx, u.cz, dx, dz, false) : SHUT_WAY;
        // No open way on: a wall of the enemy's to break through, perhaps (or this is as near as it gets).
        if (way === SHUT_WAY && here < INF && here > 0) way = this.nav.next(flow, u.level, u.cx, u.cz);
        if (way === SHUT_WAY) {
          // At the end of the way and its own spot cannot be reached from here, or no way there at all: it stops.
          if (here === 0) {
            u.arrived = true;
            return;
          }
          u.stuck += DT * 4;
          if (u.stuck > 2) u.arrived = true;
          return;
        }
        if (way === WALL_WAY) {
          // A wall of the enemy's in the way: it is shot down (and breaking through is not waiting about near enough: it
          // gets there once the wall is down).
          u.linger = 0;
          const wall = this.build.occupant({ type: "wall", x: this.nav.wallX, y: this.nav.wallL, z: this.nav.wallZ, rot: this.nav.wallRot });
          if (wall && def.weapon) {
            u.tk = T_PIECE;
            u.tid = wall.id;
            if (this.t >= u.coolAt && (!def.deploy || (u.deployedAt > 0 && this.t >= u.deployedAt))) {
              u.coolAt = this.t + def.weapon.cooldown;
              this.shoot([u.x, u.y + def.height * 0.7, u.z], u.owner, def.weapon, T_PIECE, wall.id, u.id);
              u.aim = Math.atan2(this.nav.wallX * CELL - u.x, this.nav.wallZ * CELL - u.z);
            } else if (def.deploy && u.deployedAt === 0 && this.t >= u.packedAt) u.deployedAt = this.t + def.deploy;
          }
          return;
        }
        // One cell on that way, keeping to its own lane (where it is across its cell is where it will be across the
        // next); on a ramp, up the middle.
        const nx = this.nav.nextX, nz = this.nav.nextZ;
        const edge = def.radius * 0.5 + 0.3;
        if (this.nav.rampAt(this.nav.toL, nx, nz) >= 0 || this.nav.rampAt(u.level, u.cx, u.cz) >= 0) {
          goal.wx = mid(nx);
          goal.wz = mid(nz);
        } else {
          goal.wx = Math.max(nx * CELL + edge, Math.min((nx + 1) * CELL - edge, u.x + (nx - u.cx) * CELL));
          goal.wz = Math.max(nz * CELL + edge, Math.min((nz + 1) * CELL - edge, u.z + (nz - u.cz) * CELL));
        }
        goal.set = true;
      }
    }
    const dx = goal.wx - u.x, dz = goal.wz - u.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      goal.set = false;
      return;
    }
    // Artillery set up packs up before it moves on (a patrol's, say, having shelled what it found).
    if (def.deploy && u.deployedAt > 0) {
      u.deployedAt = 0;
      u.packedAt = this.t + def.deploy;
      return;
    }
    u.heading = Math.atan2(dx, dz);
    const s = Math.min(reach, d);
    const bx = u.x, bz = u.z;
    const [sx, sz] = this.clearStep(u, def, dx / d, dz / d, s, near);
    this.shift(u, u.x + sx, u.z + sz, classOf(def));
    // In the cell it was heading for: the next one is chosen from there (so it never doubles back to a spot it was pushed past).
    if (u.cx === Math.floor(goal.wx / CELL) && u.cz === Math.floor(goal.wz / CELL) && d < CELL * 0.6) goal.set = false;
    const moved = Math.hypot(u.x - bx, u.z - bz);
    if (moved < s * 0.3) {
      // Held up: look again for the way. Still held up: a step aside, the other way, and on; only after that, again and
      // again, does it settle for where it is.
      u.stuck += DT;
      goal.set = false;
      if (u.stuck > 5) {
        if (u.replans < 3) {
          u.replans++;
          u.stuck = 0;
          u.side = -u.side;
          u.sideUntil = this.t + 2;
        } else u.arrived = true;
      }
    } else u.stuck = Math.max(0, u.stuck - DT * 0.5);
  }

  /** Whether a unit is on its way somewhere roughly along (ux, uz): by where it is going, not where it faces (it may not have turned yet). */
  private goingAlong(o: Unit, ux: number, uz: number): boolean {
    const to = o.arrived ? null : o.goal;
    if (!to) return false;
    const dx = to.ox - o.x, dz = to.oz - o.z;
    const d = Math.hypot(dx, dz);
    return d > 1 && (dx * ux + dz * uz) / d > 0.5;
  }

  /**
   * A ground unit's step of `s` along (ux, uz), short of driving into another
   * unit on the ground ahead: it goes as far as that one's edge, and the rest
   * of the step goes to the side, round it (to its own right, unless the
   * other is already off to the right). Units behind or beside, or ahead and
   * going the same way, are no matter. One of its own army standing on its
   * line is nudged aside. Nearly where it is going (`left`, m), behind one
   * standing still, it just stops.
   */
  private clearStep(u: Unit, def: UnitDef, ux: number, uz: number, s: number, left: number): [number, number] {
    let allowed = s, side = 0, still = false;
    this.nearby(u.x, u.z, def.radius + s + 4, (o) => {
      if (o === u || o.dead || o.inside || o.level !== u.level) return;
      const od = UNITS[o.kind];
      if (od.air || this.t < o.downUntil) return;
      // Going the same way (a group on the march): it moves on before this one gets there.
      if (this.goingAlong(o, ux, uz)) return;
      let ox = o.x - u.x, oz = o.z - u.z;
      let along = ox * ux + oz * uz;
      if (along <= 0) return;
      const gap = def.radius + od.radius + 0.1;
      let across = ox * uz - oz * ux;
      if (Math.abs(across) >= gap) return;
      // One of its own army standing in the way is nudged aside, off its line (as a crowd parts for one going
      // through it); an enemy, one set up and not to be moved, or a Hauler at work, is gone round.
      if (along < gap + s * 3 && o.owner === u.owner && !o.inside && (o.arrived || !o.goal) && !(od.deploy && o.deployedAt > 0) && !(o.kind === "hauler" && (o.order.k === "gather" || o.order.k === "return"))) {
        const away = Math.abs(across) > 0.05 ? Math.sign(across) : o.id % 2 ? 1 : -1;
        const push = Math.min(gap - Math.abs(across), s * 1.2);
        const nx = o.x + uz * away * push, nz = o.z - ux * away * push;
        // (Not into a third: where it would go aside is taken, and this one goes round it instead.)
        let room = true;
        this.nearby(nx, nz, od.radius + 4, (q) => {
          if (!room || q === o || q === u || q.dead || q.inside || q.level !== o.level || UNITS[q.kind].air) return;
          const need = od.radius + UNITS[q.kind].radius + 0.1;
          const after = Math.hypot(q.x - nx, q.z - nz);
          // (A little squeeze is allowed: separate() evens it out the next step.)
          if (after < need - 0.3 && after < Math.hypot(q.x - o.x, q.z - o.z)) room = false;
        });
        if (room) this.shift(o, nx, nz, classOf(od));
        ox = o.x - u.x;
        oz = o.z - u.z;
        along = ox * ux + oz * uz;
        across = ox * uz - oz * ux;
        if (along <= 0 || Math.abs(across) >= gap) return;
      }
      // Already in each other: separate() moves them apart; this only keeps it from going deeper.
      const t = Math.max(0, along - Math.sqrt(gap * gap - across * across));
      if (t < allowed) {
        allowed = t;
        side = across > 0.3 * gap ? -1 : 1;
        still = (o.arrived || !o.goal);
      }
    });
    if (allowed >= s) return [ux * s, uz * s];
    // Nearly there, behind one already standing: it stops behind it, not round it (a group arriving keeps its shape).
    if (still && left < (def.radius + 2) * 2.5) return [ux * allowed, uz * allowed];
    // Round it on the side it chose a moment ago, if it is still going round.
    if (this.t < u.sideUntil) side = u.side;
    u.side = side;
    u.sideUntil = this.t + 1.5;
    const slip = (s - allowed) * side;
    return [ux * allowed + uz * slip, uz * allowed - ux * slip];
  }

  /**
   * Moves a ground unit to a spot at most a cell away, if nothing is in the
   * way: crossing into the next cell only where that is open, else it stays
   * against the edge.
   */
  private shift(u: Unit, nx: number, nz: number, cls: MoveClass): void {
    nx = clampEdge(nx);
    nz = clampEdge(nz);
    let cx = u.cx, cz = u.cz, l = u.level;
    const tx = Math.floor(nx / CELL), tz = Math.floor(nz / CELL);
    if (tx !== cx) {
      const dir = tx > cx ? 1 : 3;
      if (this.nav.cross(l, cx, cz, dir, cls) === OPEN_WAY) {
        l = this.nav.toL;
        cx += DX[dir]!;
      } else nx = Math.max(cx * CELL + 0.05, Math.min((cx + 1) * CELL - 0.05, nx));
    }
    if (tz !== cz) {
      const dir = tz > cz ? 0 : 2;
      if (this.nav.cross(l, cx, cz, dir, cls) === OPEN_WAY) {
        l = this.nav.toL;
        cz += DZ[dir]!;
      } else nz = Math.max(cz * CELL + 0.05, Math.min((cz + 1) * CELL - 0.05, nz));
    }
    // Its body's edge, not its middle, is what stops at a wall or a building: kept its width from any edge of its cell it cannot cross.
    // (Never more than nearly half a cell: something wider still fits down a lane one cell across.)
    const r = Math.min(UNITS[u.kind].radius, CELL / 2 - 0.1);
    const lowX = cx * CELL, highX = (cx + 1) * CELL, lowZ = cz * CELL, highZ = (cz + 1) * CELL;
    // (A wall stands half its thickness either side of the edge: that much further.)
    const keep = (d: number): number => {
      const way = this.nav.cross(l, cx, cz, d, cls);
      return way === OPEN_WAY ? 0 : way === WALL_WAY ? r + THICK / 2 : r;
    };
    const reach = r + THICK / 2;
    if (nx - lowX < reach) nx = Math.max(nx, lowX + keep(3));
    if (highX - nx < reach) nx = Math.min(nx, highX - keep(1));
    if (nz - lowZ < reach) nz = Math.max(nz, lowZ + keep(2));
    if (highZ - nz < reach) nz = Math.min(nz, highZ - keep(0));
    // Near a corner of its cell with both cells beside it open, but not the one across the corner (a building's or a wall's end):
    // kept its width from the corner itself.
    const sx = nx - lowX < reach ? -1 : highX - nx < reach ? 1 : 0, sz = nz - lowZ < reach ? -1 : highZ - nz < reach ? 1 : 0;
    if (sx !== 0 && sz !== 0) {
      const dirX = sx > 0 ? 1 : 3, dirZ = sz > 0 ? 0 : 2;
      const viaX = this.nav.cross(l, cx, cz, dirX, cls) === OPEN_WAY && this.nav.cross(this.nav.toL, cx + sx, cz, dirZ, cls) === OPEN_WAY;
      const viaZ = this.nav.cross(l, cx, cz, dirZ, cls) === OPEN_WAY && this.nav.cross(this.nav.toL, cx, cz + sz, dirX, cls) === OPEN_WAY;
      if (!viaX || !viaZ) {
        const kx = sx > 0 ? highX : lowX, kz = sz > 0 ? highZ : lowZ;
        const d = Math.hypot(nx - kx, nz - kz);
        if (d < reach) {
          const k = d > 1e-6 ? reach / d : 1;
          nx = d > 1e-6 ? kx + (nx - kx) * k : kx - sx * reach;
          nz = d > 1e-6 ? kz + (nz - kz) * k : kz - sz * reach;
        }
      }
    }
    u.x = nx;
    u.z = nz;
    u.cx = cx;
    u.cz = cz;
    u.level = l;
    u.y = this.nav.heightAt(l, nx, nz);
  }

  /**
   * How high a drone flies over a spot: its usual height, or higher over
   * anything taller there (a Core, a relay mast, a tower of pieces) within its
   * width and a little way ahead.
   */
  private flightHeight(x: number, z: number, def: UnitDef): number {
    let top = 0;
    const reach = def.radius + 3;
    for (let cx = Math.floor((x - reach) / CELL); cx <= Math.floor((x + reach) / CELL); cx++) {
      for (let cz = Math.floor((z - reach) / CELL); cz <= Math.floor((z + reach) / CELL); cz++) {
        top = Math.max(top, this.nav.pieceTop(cx, cz));
        const b = this.footprint.get(`${cx},${cz}`);
        if (b !== undefined) top = Math.max(top, BUILDINGS[this.buildings.get(b)?.kind ?? "tap"].height);
        // (A turret up on a floor stands on the floor's top, which pieceTop has counted.)
        const pieces = this.nav.pieceTop(cx, cz);
        for (let l = 1; l <= pieces / LEVEL + 0.5; l++) {
          const t = this.footprint.get(cellKey(cx, cz, l));
          if (t !== undefined) top = Math.max(top, l * LEVEL + BUILDINGS[this.buildings.get(t)?.kind ?? "tap"].height);
        }
      }
    }
    return Math.max(FLIGHT_HEIGHT, top + def.height + 2);
  }

  /** Every drone rises over whatever is under it (or comes back down to its usual height), moving or not. */
  private flyOver(): void {
    for (const u of this.units) {
      const def = UNITS[u.kind];
      if (!def.air || u.dead || u.inside) continue;
      const want = this.flightHeight(u.x, u.z, def);
      u.y += Math.max(-6 * DT, Math.min(24 * DT, want - u.y));
    }
  }

  /** Units standing in each other push apart (ground with ground, drones with drones), Haulers at work too. */
  private separate(): void {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]!;
      if (u.dead || u.inside || this.t < u.downUntil) continue;
      const def = UNITS[u.kind];
      // Artillery set up does not budge.
      if (def.deploy && u.deployedAt > 0) continue;
      let px = 0, pz = 0;
      this.nearby(u.x, u.z, def.radius + 3.5, (o, j) => {
        if (j === i || o.dead || o.inside) return;
        const od = UNITS[o.kind];
        if (!!od.air !== !!def.air || (!def.air && o.level !== u.level)) return;
        // Soldiers in a fight keep more room between them: one shell should not catch a crowd.
        const gap = def.radius + od.radius + 0.3 + (def.infantry && od.infantry && (u.tk || o.tk) ? 1.4 : 0);
        let dx = u.x - o.x, dz = u.z - o.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= gap * gap) return;
        let d = Math.sqrt(d2);
        if (d < 0.01) {
          // Exactly on top of each other: apart, each its own way.
          const a = scatter(u.id, 9) * Math.PI * 2;
          dx = Math.sin(a);
          dz = Math.cos(a);
          d = 1;
        }
        // Whoever is still moving gives way more than whoever has stopped.
        const give = (gap - d) * (o.arrived && !u.arrived ? 0.7 : u.arrived && !o.arrived ? 0.2 : 0.5);
        px += (dx / d) * give;
        pz += (dz / d) * give;
        // Going somewhere with the other ahead and not going its way (meeting head-on, or one standing): a step to its own right as well,
        // so the two pass each other instead of pushing face to face.
        if (u.goal && !u.arrived && !this.goingAlong(o, Math.sin(u.heading), Math.cos(u.heading)) && -(dx * Math.sin(u.heading) + dz * Math.cos(u.heading)) > 0) {
          px += Math.cos(u.heading) * give * 0.6;
          pz -= Math.sin(u.heading) * give * 0.6;
        }
      });
      if (px === 0 && pz === 0) continue;
      // As far as it could have moved this tick: pushing apart keeps up with driving into each other.
      const len = Math.hypot(px, pz), max = Math.max(0.5, def.speed * DT);
      if (len > max) {
        px = (px / len) * max;
        pz = (pz / len) * max;
      }
      if (def.air) {
        u.x = clampEdge(u.x + px);
        u.z = clampEdge(u.z + pz);
      } else this.shift(u, u.x + px, u.z + pz, classOf(def));
    }
    // Generals stand where they stand: units on the ground going somewhere step round them, never through. (One standing
    // still stays put: the general's own page stops the general against it.)
    for (const g of this.generals) {
      for (const pid of g?.here ?? []) {
        const p = this.host.positionOf(pid);
        if (!p) continue;
        const feet = p[1] - 0.95;
        this.nearby(p[0], p[2], 5, (o) => {
          const od = UNITS[o.kind];
          if (o.dead || o.inside || od.air || Math.abs(o.y - feet) > 1.6) return;
          if (o.arrived || !o.goal) return;
          const gap = od.radius + GENERAL_RADIUS;
          let dx = o.x - p[0], dz = o.z - p[2];
          const d = Math.hypot(dx, dz);
          if (d >= gap) return;
          if (d < 0.01) {
            dx = Math.sin(o.heading);
            dz = Math.cos(o.heading);
          } else {
            dx /= d;
            dz /= d;
          }
          this.shift(o, o.x + dx * Math.min(0.8, gap - d), o.z + dz * Math.min(0.8, gap - d), classOf(od));
        });
      }
    }
  }

  // ── Sight ──────────────────────────────────────────────────────────────

  /** Works out what each team can see now: round every unit, building and general of theirs. */
  private look(): void {
    for (const grid of this.sight.values()) grid.fill(0);
    const gridOf = (team: number) => {
      let g = this.sight.get(team);
      if (!g) this.sight.set(team, (g = new Uint8Array(SIGHT_GRID * SIGHT_GRID)));
      return g;
    };
    for (const u of this.units) {
      if (u.dead || u.inside || u.owner === NEUTRAL) continue;
      const def = UNITS[u.kind];
      stamp(gridOf(this.teamOf(u.owner)), u.x, u.z, def.sight * (u.level > 0 && !def.air ? HIGH_GROUND : 1));
    }
    for (const b of this.buildings.values()) {
      if (b.dead) continue;
      const c = this.centreOf(b);
      stamp(gridOf(this.teamOf(b.owner)), c[0], c[2], BUILDINGS[b.kind].sight * (b.doneAt === 0 ? 1 : 0.4));
    }
    for (const g of this.generals) {
      for (const pid of g?.here ?? []) {
        const p = this.host.positionOf(pid);
        if (g && p) stamp(gridOf(g.team), p[0], p[2], generalSight(p[1]));
      }
    }
    // Teams nobody is on any more are forgotten.
    const live = new Set(this.generals.flatMap((g) => (g ? [g.team] : [])));
    for (const team of [...this.sight.keys()]) if (!live.has(team)) this.sight.delete(team);
  }

  /** Whether a team can see a spot now. */
  sees(team: number, x: number, z: number): boolean {
    const g = this.sight.get(team);
    return !!g && g[sightIndex(x, z)] === 1;
  }

  // ── Now and then ───────────────────────────────────────────────────────

  private housekeeping(): void {
    if (this.step % 600 === 0) this.forgetIds();
    // Units whose floor has gone come down to what is under them.
    for (const u of this.units) {
      if (u.dead || u.inside || UNITS[u.kind].air) continue;
      if (!this.nav.standable(u.level, u.cx, u.cz)) {
        const to = this.nav.dropTo(u.level, u.cx, u.cz);
        if (to >= 0) {
          u.level = to;
          u.y = this.nav.heightAt(to, u.x, u.z);
        } else this.putOnGround(u, u.x, u.z);
        if (u.goal) u.goal.set = false;
      }
    }
    // No Hauler stands idle: one waiting (no Core, nothing to mine) is set to work again as soon as there is work.
    if (this.step % 20 === 0) {
      for (const u of this.units) if (!u.dead && !u.inside && u.kind === "hauler" && u.order.k !== "gather" && u.owner !== NEUTRAL) this.autoGather(u);
    }
  }

  /** Lets go of every path worked out (the war has stopped: they are worked out again when wanted). */
  forgetPaths(): void {
    this.flows.clear();
  }

  // ── Keeping it through a sleep ─────────────────────────────────────────

  /** Everything needed to carry on later, as plain data. */
  snapshot(): unknown {
    return {
      v: 1,
      t: this.t,
      step: this.step,
      next: [this.nextUnit, this.nextBuilding, this.nextGroup],
      owners: [...this.pieceOwner],
      tabs: [...this.lastOfTab].slice(-300),
      generals: this.generals,
      units: this.units.filter((u) => !u.dead).map((u) => ({ ...u, goal: null, tk: 0, tid: 0 })),
      buildings: [...this.buildings.values()].map((b) => ({ ...b, tk: 0, tid: 0 })),
      fields: this.fields.map((f) => [f.id, Math.round(f.amount), f.refillAt]),
    };
  }

  /** Takes up where a snapshot left off. Returns false (and stays empty) when it cannot be read. */
  restore(data: unknown): boolean {
    try {
      const s = data as { v: number; t: number; step: number; next: number[]; generals: (General | null)[]; units: Unit[]; buildings: Building[]; fields: [number, number, number][]; owners?: [string, number][]; tabs?: [string, number][] };
      if (!s || s.v !== 1 || !Array.isArray(s.units) || !Array.isArray(s.buildings) || s.generals.length !== MAX_GENERALS) return false;
      this.t = s.t;
      this.step = s.step;
      [this.nextUnit, this.nextBuilding, this.nextGroup] = s.next as [number, number, number];
      s.generals.forEach((g, i) => {
        this.generals[i] = g;
        if (!g) return;
        // (A war saved under earlier rules: each army has its own side, colour and name now, and nobody is serving it yet.)
        g.team = g.slot;
        g.color = ARMY_COLORS[g.slot % ARMY_COLORS.length]!;
        // (The computer only ever plays pink. A war saved before it did may have a person's army there: it stays theirs.)
        g.ai = g.slot === COMPUTER && g.ai === true;
        g.bornAt ??= -1e9;
        g.name = armyName(g.slot, g.ai);
        g.here = [];
        for (const old of ["asked", "pid", "tab", "leftAt", "joinedAt", "immuneUntil"]) delete (g as unknown as Record<string, unknown>)[old];
        for (const pid of g.pids) this.slotOfPid.set(pid, g.slot);
      });
      for (const [id, slot] of s.owners ?? []) this.pieceOwner.set(id, slot);
      for (const [tab, slot] of s.tabs ?? []) this.lastOfTab.set(tab, slot);
      for (const [id, amount, refillAt] of s.fields) {
        const f = this.fieldById.get(id);
        if (f) {
          f.amount = amount;
          f.refillAt = refillAt;
        }
      }
      for (const b of s.buildings) {
        if (!BUILDING_KINDS.includes(b.kind)) continue;
        // (Buildings stand finished at once now: one saved while it was printing is done.)
        b.doneAt = 0;
        // (Saved before turrets went up on floors: on the ground. One whose floor has gone since, gone with it.)
        b.l ??= 0;
        if (b.l > 0 && !this.build.occupant({ type: "floor", x: b.cx, y: b.l, z: b.cz, rot: 0 })) continue;
        this.buildings.set(b.id, b);
        const size = BUILDINGS[b.kind].size;
        for (let x = b.cx; x < b.cx + size; x++) for (let z = b.cz; z < b.cz + size; z++) this.footprint.set(cellKey(x, z, b.l), b.id);
        this.nav.fill(b.cx, b.cz, size, true, true, b.l);
      }
      for (const u of s.units) {
        // (Saved when neutral sentries stood round the rich fields: there are none any more.)
        if (!UNIT_KINDS.includes(u.kind) || u.owner === NEUTRAL) continue;
        delete (u as unknown as Record<string, unknown>).post;
        // Whatever they were doing, they pick it up again from where they stand.
        const order = u.order;
        u.linger ??= 0;
        u.goal = null;
        // (Saved before soldiers chose their own targets.)
        u.aim ??= u.heading;
        u.pace ??= 0;
        // (Saved when units still went after things of their own accord.)
        for (const old of ["chase", "chaseAt", "chaseX", "chaseZ", "closer", "home", "alarmX", "alarmZ", "alarmUntil", "tries", "chaseStuck", "chaseLinger"]) delete (u as unknown as Record<string, unknown>)[old];
        if (u.order.k === "attack") delete (u.order as { fan?: number }).fan;
        u.replans ??= 0;
        u.arrived = true;
        this.units.push(u);
        this.unitById.set(u.id, u);
        if (order.k !== "stop" && order.k !== "hold" && !u.inside) this.begin(u, order, 0, 2);
      }
      // The owners of walls are known again now: the paths are read afresh.
      this.nav.version++;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ids no piece is built under any more are forgotten (a place has a new id
   * with every person who takes it, and keeps the old ones for their walls).
   */
  private forgetIds(): void {
    const used = new Set<string>();
    for (const p of this.build.all()) {
      const dash = p.id.lastIndexOf("-");
      if (dash > 0) used.add(p.id.slice(0, dash));
    }
    for (const g of this.generals) {
      if (!g) continue;
      for (const pid of g.pids) if (!g.here.includes(pid) && !used.has(pid)) this.slotOfPid.delete(pid);
      g.pids = g.pids.filter((pid) => g.here.includes(pid) || used.has(pid));
    }
    for (const id of this.pieceOwner.keys()) if (!this.build.get(id)) this.pieceOwner.delete(id);
    for (const id of this.haulTo.keys()) if (!this.unitById.has(id)) this.haulTo.delete(id);
  }

  /** How much there is of everything, for checks and the load test. */
  get counts(): { units: number; buildings: number; generals: number } {
    return { units: this.units.length, buildings: this.buildings.size, generals: this.generals.filter((g) => g).length };
  }
}

export function emptyHappened(): Happened {
  return { shots: [], tumbles: [], blasts: [], gone: [], pulses: [], zaps: [], notes: [] };
}

/** How far a general sees with their feet this high. */
export function generalSight(centreY: number): number {
  return Math.min(GENERAL_SIGHT * 3, GENERAL_SIGHT + Math.max(0, centreY - 0.9) * SIGHT_PER_METRE);
}

const half = HALF_CELLS * CELL;
const bucketOf = (x: number, z: number) => Math.max(0, Math.min(BUCKETS - 1, Math.floor((x + half) / BUCKET))) * BUCKETS + Math.max(0, Math.min(BUCKETS - 1, Math.floor((z + half) / BUCKET)));
/** The sight cell a spot is in. */
export const sightIndex = (x: number, z: number) => Math.max(0, Math.min(SIGHT_GRID - 1, Math.floor((x + half) / SIGHT_CELL))) * SIGHT_GRID + Math.max(0, Math.min(SIGHT_GRID - 1, Math.floor((z + half) / SIGHT_CELL)));

/** Marks every sight cell within `range` of a spot. */
export function stamp(grid: Uint8Array, x: number, z: number, range: number): void {
  const cx = (x + half) / SIGHT_CELL, cz = (z + half) / SIGHT_CELL, r = range / SIGHT_CELL;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(SIGHT_GRID - 1, Math.floor(cx + r));
  const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(SIGHT_GRID - 1, Math.floor(cz + r));
  const r2 = (r + 0.5) * (r + 0.5);
  for (let gx = x0; gx <= x1; gx++) {
    const dx = gx + 0.5 - cx;
    for (let gz = z0; gz <= z1; gz++) {
      const dz = gz + 0.5 - cz;
      if (dx * dx + dz * dz <= r2) grid[gx * SIGHT_GRID + gz] = 1;
    }
  }
}

const xz = (v: Vec): [number, number] => [v[0], v[2]];
const armyName = (slot: number, ai: boolean) => (ai ? "Computer" : `${ARMY_COLOR_NAMES[slot % ARMY_COLOR_NAMES.length]!} army`);
const article = (label: string) => (/^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`);
