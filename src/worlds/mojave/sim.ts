import type { BuildState } from "../../game/buildState";
import { CELL, LEVEL } from "../../game/constants";
import type { Environment } from "../../game/environments";
import { gridBox, type Piece } from "../../game/pieces";
import { distanceToPiece, type Vec } from "../../game/trebuchet";
import {
  BUILDINGS,
  BUILDING_KINDS,
  DIG_TIME,
  EMP,
  FLIGHT_HEIGHT,
  GENERAL_IMMUNE,
  GENERAL_SIGHT,
  HIGH_GROUND,
  LEAVE_GRACE,
  LOAD,
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
import { makeFields, mid, REFILL_MS, sentryPosts, STARTS, type Field } from "./map";
import { DX, DZ, INF, INFANTRY, Nav, NO_OWNER, OPEN_WAY, SHUT_WAY, VEHICLE, WALL_WAY, type Flow, type MoveClass, type Node } from "./nav";
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

/** The side nobody commands: the sentries guarding the rich fields. Hostile to everyone. */
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
/** Shells fly this fast, m/s (never there in under a second: time to see it coming). */
const SHELL_SPEED = 45;

export interface General {
  slot: number;
  /** The builder connected as this general now, or null (gone for the moment, or a computer). */
  pid: string | null;
  /** Every id this general has had (ids are new on every join): pieces carry the id they were built under. */
  pids: string[];
  /** The browser tab, so a reload or a dropped connection comes back as the same general. Never sent anywhere. */
  tab: string | null;
  name: string;
  color: string;
  /** Their side: their own slot (there are no alliances; kept as a number of its own for what is worked out by side). */
  team: number;
  lithium: number;
  plasma: number;
  /** Lithium promised to pieces in an action still being settled. */
  pending: number;
  upgrades: Record<UpgradeKind, number>;
  /** Which start they were given. */
  start: number;
  /** When the person who commanded here left (game seconds): the place is kept for their tab for a while. 0: nobody is waited for. */
  leftAt: number;
  /** When a person last took this place over (game seconds): computers leave a newcomer alone for a while. */
  joinedAt: number;
  /** When they lost their last Core, or 0. */
  routedAt: number;
  /** A computer commands here now (no person does). */
  ai: boolean;
  /** Cannot be thrown again before this. */
  immuneUntil: number;
  /** When they were last told they are under attack, and where. */
  alertAt: number;
}

/** What a unit has been told to do. */
export type Order =
  | { k: "stop" }
  | { k: "hold" }
  | { k: "move"; x: number; z: number; l: number }
  | { k: "amove"; x: number; z: number; l: number; auto?: boolean }
  | { k: "patrol"; x: number; z: number; l: number; bx: number; bz: number; bl: number }
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
  hp: number;
  order: Order;
  queue: Order[];
  /** Where it is going now, when anywhere. */
  goal: Goal | null;
  /** Units ordered somewhere together share this, and stop when they reach the others. */
  group: number;
  arrived: boolean;
  /** What it is shooting at. */
  tk: TargetKind | 0;
  tid: number | string;
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
  /** A neutral sentry's post, by index (else -1). */
  post: number;
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
  shots: { from: Vec; to: Vec; look: Weapon["look"]; time: number; owner: number; hit: number }[];
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
  /** In the air or getting up. */
  isDown(pid: string): boolean;
  /** Throws a builder away from a blast at `from`. */
  throwBuilder(pid: string, from: Vec): void;
  /** Wears pieces down: [piece id, hits] (fractions of a hit). */
  wear(point: Vec, hits: [string, number][], by: string): void;
  /** Takes pieces out of the build. */
  removePieces(ids: string[], by: string): void;
}

/** Colours for armies whose general's own is too like another's: eight that are easy to tell apart. */
/** A computer general's name, by slot. */
export const COMPUTER_NAMES = ["Atlas", "Vega", "Orion", "Lyra", "Draco", "Nova", "Rigel", "Altair"];
/** What each place's colour is called, as it goes in a sentence. */
export const ARMY_COLOR_NAMES = ["red", "blue", "yellow", "green", "purple", "orange", "teal", "pink"];
/** Each place's colour: its army wears it whoever commands there, and so does its general. */
export const ARMY_COLORS = ["#e8463a", "#3a7be8", "#f2c230", "#3fbf5f", "#b455e0", "#f08a2a", "#27c4c4", "#f06aa8"];

const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
const clampEdge = (v: number) => Math.max(-EDGE, Math.min(EDGE, v));
const classOf = (def: UnitDef): MoveClass => (def.infantry ? INFANTRY : VEHICLE);
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
  /** Which place a newcomer is given next: the computers are taken in turn. */
  private nextTake = 0;
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
  /** The neutral sentries' posts: where, which unit stands there (0: none), and when it fell. */
  readonly posts: { x: number; z: number; unit: number; deadAt: number }[];
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
      this.nav.fill(f.cx, f.cz, 1, true);
    }
    this.posts = sentryPosts().map(([x, z]) => ({ x, z, unit: 0, deadAt: -1e9 }));
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
    for (const g of this.generals) if (g && g.pid === pid) return g;
    return null;
  }

  /** Whose a piece is, from the id it was built under: a general's slot, or NO_OWNER. */
  ownerOfPiece(pieceId: string): number {
    const dash = pieceId.lastIndexOf("-");
    return (dash > 0 ? this.slotOfPid.get(pieceId.slice(0, dash)) : undefined) ?? NO_OWNER;
  }

  // ── Arriving and leaving ───────────────────────────────────────────────

  /** Whether a place is being kept for the person who left it a moment ago. */
  private held(g: General): boolean {
    return g.pid === null && g.tab !== null && g.leftAt > 0 && this.t - g.leftAt < LEAVE_GRACE;
  }

  /**
   * A person who may command comes in. They take over a computer's place as it
   * stands, base, army, lithium and walls: the one they left a moment ago (the
   * same tab, within the grace period), else the next computer in turn. Null
   * when a person holds every place.
   */
  join(pid: string, name: string, tab: string | null): General | null {
    let g: General | null = (tab ? this.generals.find((x) => x && this.held(x) && x.tab === tab) : null) ?? null;
    for (let i = 0; i < MAX_GENERALS && !g; i++) {
      const c = this.generals[(this.nextTake + i) % MAX_GENERALS];
      if (c && c.pid === null && !this.held(c)) g = c;
    }
    if (!g) return null;
    if (g.tab !== tab || !this.held(g)) {
      this.nextTake = (g.slot + 1) % MAX_GENERALS;
      g.joinedAt = this.t;
    }
    return this.take(g.slot, pid, name, tab);
  }

  /** A person takes a place over, as it stands. Null when a person holds it already. */
  take(slot: number, pid: string, name: string, tab: string | null): General | null {
    const g = this.generals[slot];
    if (!g || g.pid !== null) return null;
    g.pid = pid;
    if (!g.pids.includes(pid)) g.pids.push(pid);
    g.tab = tab;
    g.leftAt = 0;
    g.ai = false;
    g.name = name;
    g.pending = 0;
    this.slotOfPid.set(pid, g.slot);
    return g;
  }

  /** Puts a computer general on an empty slot, at a free start, with a Core and its first Haulers. */
  seat(slot: number): General {
    const used = new Set(this.generals.flatMap((g) => (g ? [g.start] : [])));
    // Its own start when that is free (it always is in a war begun with eight); else any that is.
    const start = !used.has(slot) ? slot : (STARTS.map((_, i) => i).find((i) => !used.has(i)) ?? slot);
    const g: General = {
      slot, pid: null, pids: [], tab: null, name: COMPUTER_NAMES[slot % COMPUTER_NAMES.length]!, color: ARMY_COLORS[slot % ARMY_COLORS.length]!, team: slot, lithium: START_LITHIUM, plasma: 0, pending: 0,
      upgrades: { weapons: 0, armour: 0 }, start, leftAt: 0, joinedAt: -1e9, routedAt: 0, ai: true, immuneUntil: 0, alertAt: -100,
    };
    this.generals[slot] = g;
    const s = STARTS[start]!;
    const core = this.addBuilding("core", slot, s.cx - 1, s.cz - 1, true);
    for (let i = 0; i < START_HAULERS; i++) {
      const u = this.spawnBeside(core, "hauler");
      if (u) this.autoGather(u);
    }
    return g;
  }

  /** Every place has a general: a computer is put on each empty one. */
  fill(): void {
    for (let slot = 0; slot < MAX_GENERALS; slot++) if (!this.generals[slot]) this.seat(slot);
  }

  /**
   * The person commanding here has gone: a computer takes over at once and
   * plays on with everything as it stands. The place is kept for them (their
   * tab) for the grace period; after that anyone may be given it.
   */
  leave(pid: string): void {
    const g = this.generalOf(pid);
    if (!g) return;
    g.pid = null;
    g.ai = true;
    // (Never 0, which says nobody is waited for: a war's very first moment counts too.)
    g.leftAt = Math.max(this.t, DT / 2);
    g.pending = 0;
    g.name = COMPUTER_NAMES[g.slot % COMPUTER_NAMES.length]!;
  }

  /** Everything of a place disappears, and it is empty (see `fill`). */
  wipe(slot: number): void {
    const g = this.generals[slot];
    if (!g) return;
    for (const u of this.units) if (u.owner === slot && !u.dead) this.kill(u, true);
    this.units = this.units.filter((u) => !u.dead);
    this.index();
    for (const b of [...this.buildings.values()]) if (b.owner === slot && !b.dead) this.raze(b, true);
    const prefixes = new Set(g.pids);
    const ids: string[] = [];
    for (const p of this.build.all()) {
      const dash = p.id.lastIndexOf("-");
      if (dash > 0 && prefixes.has(p.id.slice(0, dash))) ids.push(p.id);
    }
    if (ids.length > 0) this.host.removePieces(ids, "left");
    for (const pid of g.pids) this.slotOfPid.delete(pid);
    this.generals[slot] = null;
  }

  // ── Money and supply ───────────────────────────────────────────────────

  /** The supply a general's army takes up: the units they have. (What is queued takes none until it comes out: see `tick`.) */
  supplyUsed(slot: number): number {
    let n = 0;
    for (const u of this.units) if (u.owner === slot && !u.dead) n += UNITS[u.kind].supply;
    return n;
  }

  supplyMax(slot: number): number {
    let n = 0;
    for (const b of this.buildings.values()) if (b.owner === slot && !b.dead && b.doneAt === 0) n += BUILDINGS[b.kind].supply ?? 0;
    return Math.min(MAX_SUPPLY, n);
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
    // (Nobody builds a siege engine here.)
    if (!g || piece.type === "trebuchet" || !piece.id.startsWith(`${pid}-`) || this.blocks(piece)) return false;
    const price = this.priceOf(piece);
    if (g.lithium - g.pending < price) return false;
    g.pending += price;
    return true;
  }

  /** The pieces that really went in: paid for now. */
  placed(pid: string, pieces: readonly Piece[]): void {
    const g = this.generalOf(pid);
    if (!g) return;
    g.pending = 0;
    for (const p of pieces) g.lithium = Math.max(0, g.lithium - this.priceOf(p));
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
      return (!!b && y0 < Math.ceil(BUILDINGS[b.kind].height / LEVEL)) || (y0 < 1 && this.fieldAt.has(`${x},${z}`));
    };
    // A wall stands on the edge between two cells: it cuts in only when both are taken.
    if (piece.type === "wall") return piece.rot % 2 === 0 ? taken(x0, z0 - 1) && taken(x0, z0) : taken(x0 - 1, z0) && taken(x0, z0);
    return taken(x0, z0);
  }

  // ── Buildings ──────────────────────────────────────────────────────────

  /** Why a general cannot put this building here, or "" when they can. */
  cannotBuild(slot: number, kind: BuildingKind, cx: number, cz: number, free = false): string {
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
    if (kind === "tap") {
      const f = this.fieldAt.get(`${cx},${cz}`);
      if (!f || f.kind !== "vent") return "A Tap goes on a plasma vent";
      if (this.footprint.has(`${cx},${cz}`)) return "That vent already has a Tap";
      return "";
    }
    for (let x = cx; x < cx + def.size; x++) {
      for (let z = cz; z < cz + def.size; z++) {
        if (!this.nav.clearGround(x, z) || this.footprint.has(`${x},${z}`)) return "Something is in the way";
        // Nothing built in the cell, on its ground or along its inner edges.
        if (this.build.occupant({ type: "floor", x, y: 0, z, rot: 0 })) return "Something is built there";
        if (x > cx && this.build.occupant({ type: "wall", x, y: 0, z, rot: 1 })) return "Something is built there";
        if (z > cz && this.build.occupant({ type: "wall", x, y: 0, z, rot: 0 })) return "Something is built there";
      }
    }
    return "";
  }

  /** A routed general's free Core is ready. */
  routedFree(g: General): boolean {
    return g.routedAt > 0 && this.t - g.routedAt >= ROUTED_WAIT;
  }

  /** A general puts a building down; it prints itself from there. */
  orderBuilding(slot: number, kind: BuildingKind, cx: number, cz: number): string {
    const g = this.generals[slot];
    if (!g) return "Not now";
    const why = this.cannotBuild(slot, kind, cx, cz);
    if (why) return why;
    const def = BUILDINGS[kind];
    if (g.pid) {
      const at = this.host.positionOf(g.pid);
      const mx = (cx + def.size / 2) * CELL, mz = (cz + def.size / 2) * CELL;
      if (!at || Math.hypot(at[0] - mx, at[2] - mz) > BUILD_REACH + (def.size * CELL) / 2) return "Too far away: go closer";
    }
    if (!(kind === "core" && this.routedFree(g))) {
      const short = this.pay(g, def.lithium, def.plasma);
      if (short) return short;
    } else g.lithium = Math.max(g.lithium, ROUTED_LITHIUM);
    this.addBuilding(kind, slot, cx, cz, false);
    return "";
  }

  addBuilding(kind: BuildingKind, owner: number, cx: number, cz: number, finished: boolean): Building {
    const def = BUILDINGS[kind];
    const b: Building = {
      id: this.nextBuilding++, kind, owner, cx, cz, hp: finished ? def.hp : def.hp * 0.1, doneAt: finished ? 0 : this.t + def.time, startedAt: this.t,
      queue: [], research: null, rally: null, field: kind === "tap" ? (this.fieldAt.get(`${cx},${cz}`)?.id ?? 0) : 0, tk: 0, tid: 0, coolAt: 0, stunUntil: 0, rev: 1, dead: false,
    };
    this.buildings.set(b.id, b);
    for (let x = cx; x < cx + def.size; x++) for (let z = cz; z < cz + def.size; z++) this.footprint.set(`${x},${z}`, b.id);
    this.nav.fill(cx, cz, def.size, true);
    // Whoever stands where it goes is moved out of the way.
    for (const u of this.units) {
      if (u.dead || UNITS[u.kind].air || u.inside || u.cx < cx || u.cx >= cx + def.size || u.cz < cz || u.cz >= cz + def.size) continue;
      this.putOnGround(u, u.x, u.z);
    }
    const g = this.generals[owner];
    if (g && kind === "core") g.routedAt = 0;
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
    for (let x = b.cx; x < b.cx + def.size; x++) for (let z = b.cz; z < b.cz + def.size; z++) this.footprint.delete(`${x},${z}`);
    // (A vent stays a vent under a Tap that has gone.)
    if (b.kind !== "tap") this.nav.fill(b.cx, b.cz, def.size, false);
    this.happened.gone.push({ unit: false, id: b.id, at: this.centreOf(b), kind: b.kind, owner: b.owner, left });
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
    return [b.cx * CELL + half, 0, b.cz * CELL + half];
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
      // (Supply is no bar to queueing: a unit there is no room for waits, made, until there is.)
      if (b.queue.length >= 8) why = "Its queue is full";
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
      if (!b || b.dead || b.owner !== slot) continue;
      b.rally = { x: clampEdge(x), z: clampEdge(z), l: Math.max(0, Math.round(y / LEVEL)), field: field?.kind === "crystal" ? field.id : 0 };
      b.rev++;
    }
    return "";
  }

  // ── Units: making and losing them ──────────────────────────────────────

  addUnit(kind: UnitKind, owner: number, x: number, z: number): Unit {
    const def = UNITS[kind];
    const u: Unit = {
      id: this.nextUnit++, kind, owner, x, y: def.air ? FLIGHT_HEIGHT : 0, z, cx: Math.floor(x / CELL), cz: Math.floor(z / CELL), level: 0, heading: 0, hp: def.hp,
      order: { k: "stop" }, queue: [], goal: null, group: 0, arrived: true, tk: 0, tid: 0, coolAt: 0, stunUntil: 0, downUntil: 0, deployedAt: 0, packedAt: 0,
      carry: 0, phase: 0, digUntil: 0, field: 0, cargo: [], inside: 0, empAt: 0, stuck: 0, linger: 0, hitUntil: 0, post: -1, dead: false,
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
    if (u.post >= 0) {
      const post = this.posts[u.post];
      if (post) {
        post.unit = 0;
        post.deadAt = this.t;
      }
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
      return u && !u.dead && u.owner === slot && !u.inside ? [u] : [];
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
    for (const u of units) {
      const mine = this.fit(u, order);
      if (queue && u.order.k !== "stop" && u.order.k !== "hold") {
        if (u.queue.length < 12) u.queue.push(mine);
        continue;
      }
      u.queue = [];
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
    if (tk === T_GENERAL) {
      const g = this.generals[id as number];
      const at = g?.pid ? this.host.positionOf(g.pid) : null;
      return at ? [at[0], at[2]] : null;
    }
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
      case "attack":
        u.tk = order.tk;
        u.tid = order.id;
        break;
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
      u.goal = { x, z, ox, oz, reach: 0, key: "", seeds: [], breach: false, radius, wx: ox, wz: oz, set: true };
      return;
    }
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const level = this.nav.dropTo(Math.min(l, 80), cx, cz);
    // Somewhere that cannot be stood on (a building, a field): beside it.
    const seeds: Node[] = level >= 0 ? [{ x: cx, z: cz, l: level }] : this.nav.around(cx, cz, 1);
    this.route(u, x, z, seeds, radius, breach && !!def.weapon && def.weapon.wear > 0, ox, oz);
  }

  /** Sets a ground unit going to any of `seeds` (and from there to its own spot, when it has one). */
  private route(u: Unit, x: number, z: number, seeds: readonly Node[], radius: number, breach: boolean, ox = x, oz = z): void {
    const def = UNITS[u.kind];
    const first = seeds[0];
    const key = `${classOf(def)}|${breach ? this.teamOf(u.owner) : "-"}|${seeds.length}|${first ? `${first.x},${first.z},${first.l}` : ""}`;
    // (A step of the way is 10: see nav.ts.)
    const reach = ox === x && oz === z ? 0 : (Math.ceil(Math.hypot(ox - x, oz - z) / CELL) + 1) * 10;
    u.goal = { x, z, ox, oz, reach, key, seeds, breach, radius, wx: 0, wz: 0, set: false };
  }

  private flowOf(u: Unit, goal: Goal): Flow {
    let flow = this.flows.get(goal.key);
    // Worked out again when the build has changed (not more than about twice a second each).
    if (!flow || (flow.version !== this.nav.version && this.t - flow.at > 0.5)) {
      const owner = u.owner;
      const made = this.nav.flow(goal.seeds, classOf(UNITS[u.kind]), goal.breach ? (o) => o !== NO_OWNER && this.hostile(owner, o) : null, this.t);
      flow = Object.assign(made, { used: this.t });
      this.flows.set(goal.key, flow);
      if (this.flows.size > 48) {
        // The longest unused go (each is a number for every cell of the map: a room has only so much memory).
        const old = [...this.flows].sort((a, b) => a[1].used - b[1].used).slice(0, 16);
        for (const [k] of old) this.flows.delete(k);
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
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]!;
      if (u.dead || u.inside) continue;
      if (this.t < u.downUntil || this.t < u.stunUntil) continue;
      this.think(u, i);
    }
    this.separate();
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
        // Made, it comes out when the army has room for it; until then it waits at the door.
        if (q.left <= 0 && this.supplyUsed(b.owner) + UNITS[q.kind].supply > this.supplyMax(b.owner)) q.left = 0;
        else if (q.left <= 0) {
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

  /** A new unit sets off: to the rally point, or (a Hauler with none) to the nearest crystals. */
  private sendOut(u: Unit, b: Building): void {
    const r = b.rally;
    if (u.kind === "hauler") {
      if (r?.field) return this.begin(u, { k: "gather", field: r.field }, 0, 1);
      if (!r) return this.autoGather(u);
    }
    if (r) this.begin(u, { k: "move", x: r.x, z: r.z, l: r.l }, this.nextGroup++, 2);
  }

  /** Sends a Hauler to the nearest crystals that have any left. */
  private autoGather(u: Unit): void {
    let best: Field | null = null, bestD = Infinity;
    for (const f of this.fields) {
      if (f.kind !== "crystal" || f.amount <= 0) continue;
      const d = dist2(u.x, u.z, mid(f.cx), mid(f.cz)) + (this.digger.has(f.id) ? 400 : 0);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (best && bestD < 150 * 150) this.begin(u, { k: "gather", field: best.id }, 0, 1);
  }

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

  private think(u: Unit, i: number): void {
    const def = UNITS[u.kind];
    const order = u.order;
    if (u.kind === "hauler" && (order.k === "gather" || order.k === "return")) return this.haul(u);
    if (order.k === "load") return this.board(u, order);
    if (order.k === "unload") return this.unload(u, order);
    if (order.k === "emp") return this.pulse(u, order);

    let firing = false;
    if (def.weapon) firing = this.fight(u, def, def.weapon, i);
    if (order.k === "attack") {
      // Close in on the target until it can be hit.
      const spot = this.spotOf(order.tk, order.id);
      if (!spot) return this.done(u);
      if (firing) {
        u.goal = null;
        return;
      }
      if (!u.goal || dist2(u.goal.x, u.goal.z, spot[0], spot[1]) > 64) {
        if (def.air) this.head_(u, spot[0], spot[1], 0, 1, false);
        else this.approach(u, order.tk, order.id, spot);
      }
      this.travel(u, def);
      return;
    }
    if (order.k === "move" || order.k === "amove" || order.k === "patrol") {
      // Attack-move: stand and fight whatever comes in range, then carry on.
      if (firing && order.k !== "move") return;
      if (!u.goal) return this.done(u);
      this.travel(u, def);
      if (u.arrived) {
        if (order.k === "patrol") {
          // Back the other way.
          const back: Order = { k: "patrol", x: order.bx, z: order.bz, l: order.bl, bx: order.x, bz: order.z, bl: order.l };
          this.begin(u, back, u.group, u.goal?.radius ?? 2);
        } else this.done(u);
      }
      return;
    }
    // Standing: artillery sets up where it stops.
    if (def.deploy && u.deployedAt === 0 && this.t >= u.packedAt) u.deployedAt = this.t + def.deploy;
  }

  /** The order is finished: on to the next one queued, or stand. */
  private done(u: Unit): void {
    const next = u.queue.shift();
    if (next) return this.begin(u, next, u.group, u.goal?.radius ?? 2);
    u.order = u.order.k === "hold" ? u.order : { k: "stop" };
    u.goal = null;
    u.arrived = true;
  }

  /** Heads for somewhere a target can be shot from. */
  private approach(u: Unit, tk: TargetKind, id: number | string, spot: [number, number]): void {
    let seeds: Node[];
    if (tk === T_BUILDING) {
      const b = this.buildings.get(id as number)!;
      seeds = this.nav.around(b.cx, b.cz, BUILDINGS[b.kind].size);
    } else if (tk === T_UNIT) {
      const t = this.unitById.get(id as number)!;
      seeds = UNITS[t.kind].air ? [{ x: Math.floor(t.x / CELL), z: Math.floor(t.z / CELL), l: 0 }] : [{ x: t.cx, z: t.cz, l: t.level }];
    } else {
      const cx = Math.floor(spot[0] / CELL), cz = Math.floor(spot[1] / CELL);
      seeds = [{ x: cx, z: cz, l: 0 }, ...this.nav.around(cx, cz, 1)];
    }
    this.route(u, spot[0], spot[1], seeds, 1, false);
  }

  /**
   * Shoots at what it is aimed at, or finds something to aim at. Returns true
   * when it has a target in range (so it should stand, not walk on).
   */
  private fight(u: Unit, def: UnitDef, w: Weapon, i: number): boolean {
    const range = w.range * (u.level > 0 && !def.air ? HIGH_GROUND : 1);
    const ordered = u.order.k === "attack";
    // Is what it has still there, and in range?
    if (u.tk) {
      const ok = this.canHit(u.x, u.z, u.level, !!def.air, u.owner, w, range, u.tk, u.tid, ordered);
      if (ok === "gone" || (ok !== "ok" && !ordered)) u.tk = 0;
      else if (ok !== "ok") return false;
    }
    // Looks for something now and then (not every unit on the same step).
    if (!u.tk && (this.step + i) % 3 === 0 && u.order.k !== "move") {
      const found = this.findTarget(u.x, u.z, u.level, !!def.air, u.owner, w, range);
      if (found) {
        u.tk = found[0];
        u.tid = found[1];
      }
    }
    if (!u.tk) return false;
    const spot = this.spotOf(u.tk, u.tid);
    if (spot) u.heading = Math.atan2(spot[0] - u.x, spot[1] - u.z);
    // Artillery fires only once set up.
    if (def.deploy) {
      if (u.deployedAt === 0) {
        if (this.t >= u.packedAt) u.deployedAt = this.t + def.deploy;
        return true;
      }
      if (this.t < u.deployedAt) return true;
    }
    if (this.t >= u.coolAt) {
      u.coolAt = this.t + w.cooldown;
      this.shoot([u.x, u.y + def.height * 0.7, u.z], u.owner, w, u.tk, u.tid);
    }
    return true;
  }

  /** Whether a weapon at a spot can hit a target now: "ok", "far" (out of range or no line), or "gone". */
  private canHit(x: number, z: number, level: number, air: boolean, owner: number, w: Weapon, range: number, tk: TargetKind, tid: number | string, ordered: boolean): "ok" | "far" | "gone" {
    let tx: number, tz: number, tl = 0, slack = 0, flying = false;
    if (tk === T_UNIT) {
      const t = this.unitById.get(tid as number);
      if (!t || t.dead || t.inside) return "gone";
      if (!ordered && !this.hostile(owner, t.owner)) return "gone";
      flying = !!UNITS[t.kind].air;
      if (flying ? !w.air : !w.ground) return "gone";
      tx = t.x;
      tz = t.z;
      tl = t.level;
    } else if (tk === T_BUILDING) {
      const b = this.buildings.get(tid as number);
      if (!b || b.dead || !w.ground) return "gone";
      if (!ordered && !this.hostile(owner, b.owner)) return "gone";
      [tx, , tz] = this.centreOf(b);
      slack = (BUILDINGS[b.kind].size * CELL) / 2;
    } else if (tk === T_GENERAL) {
      const g = this.generals[tid as number];
      const at = g?.pid ? this.host.positionOf(g.pid) : null;
      if (!g || !at || !w.ground) return "gone";
      tx = at[0];
      tz = at[2];
      tl = Math.max(0, Math.floor((at[1] - 0.9) / LEVEL + 0.2));
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
    // A straight shot needs a clear line; drones and shells in an arc do not.
    if (!w.lob && !air && !flying && !this.nav.clearLine(x, z, tx, tz, Math.max(level, tl))) return "far";
    return "ok";
  }

  /** The nearest enemy a weapon at a spot can hit, or null. */
  private findTarget(x: number, z: number, level: number, air: boolean, owner: number, w: Weapon, range: number): [TargetKind, number] | null {
    let best: [TargetKind, number] | null = null, bestD = range * range;
    const min2 = (w.minRange ?? 0) ** 2;
    this.nearby(x, z, range, (o) => {
      if (o.dead || o.inside || !this.hostile(owner, o.owner)) return;
      const flying = !!UNITS[o.kind].air;
      if (flying ? !w.air : !w.ground) return;
      const d = dist2(x, z, o.x, o.z);
      if (d >= bestD || d < min2) return;
      if (!w.lob && !air && !flying && !this.nav.clearLine(x, z, o.x, o.z, Math.max(level, o.level))) return;
      bestD = d;
      best = [T_UNIT, o.id];
    });
    if (best || !w.ground) return best;
    for (const b of this.buildings.values()) {
      if (b.dead || !this.hostile(owner, b.owner)) continue;
      const c = this.centreOf(b);
      const d = Math.max(0, Math.hypot(c[0] - x, c[2] - z) - (BUILDINGS[b.kind].size * CELL) / 2);
      if (d * d >= bestD || d * d < min2) continue;
      if (!w.lob && !air && !this.nav.clearLine(x, z, c[0], c[2], level)) continue;
      bestD = d * d;
      best = [T_BUILDING, b.id];
    }
    return best;
  }

  /** A weapon fires at a target: it lands at once, or (a shell in an arc) where the target was, a moment later. */
  private shoot(from: Vec, owner: number, w: Weapon, tk: TargetKind, tid: number | string): void {
    const spot = this.spotOf(tk, tid);
    if (!spot) return;
    const g = this.generals[owner];
    const damage = w.damage * (1 + (g?.upgrades.weapons ?? 0) * UPGRADE_STEP);
    const ty = tk === T_UNIT ? (this.unitById.get(tid as number)?.y ?? 0) + 1 : tk === T_BUILDING ? 2 : tk === T_GENERAL ? (this.generalSpot(tid as number)?.[1] ?? 1) : 1.5;
    const to: Vec = [spot[0], ty, spot[1]];
    if (w.lob) {
      const time = Math.max(1, Math.hypot(to[0] - from[0], to[2] - from[2]) / SHELL_SPEED);
      this.shells.push({ x: to[0], z: to[2], landAt: this.t + time, owner, weapon: w, damage });
      this.happened.shots.push({ from, to: [to[0], 0, to[2]], look: w.look, time, owner, hit: 0 });
      return;
    }
    this.happened.shots.push({ from, to, look: w.look, time: 0, owner, hit: tk === T_UNIT ? (tid as number) : tk === T_BUILDING ? -(tid as number) : 0 });
    if (w.splash > 0) return this.blast(to, w.splash, damage, owner, w);
    if (tk === T_UNIT) {
      const t = this.unitById.get(tid as number);
      if (t) this.hurtUnit(t, damage, owner, from[0], from[2]);
    } else if (tk === T_BUILDING) {
      const b = this.buildings.get(tid as number);
      if (b) this.hurtBuilding(b, damage, owner);
    } else if (tk === T_GENERAL) this.hitGeneral(tid as number, to, owner);
    else if (w.wear > 0) this.wearPiece(tid as string, w.wear, to, owner);
  }

  private generalSpot(slot: number): Vec | null {
    const g = this.generals[slot];
    return g?.pid ? this.host.positionOf(g.pid) : null;
  }

  /** A blast: everything of the enemy's near it is hurt (less at its edge) and thrown, pieces are worn, and generals fly. */
  blast(at: Vec, radius: number, damage: number, owner: number, w: Pick<Weapon, "air" | "ground" | "wear">): void {
    this.happened.blasts.push({ at, radius });
    const air = at[1] > FLIGHT_HEIGHT / 2;
    this.nearby(at[0], at[2], radius + 4, (o) => {
      if (o.dead || o.inside || (owner !== -1 && !this.hostile(owner, o.owner))) return;
      const def = UNITS[o.kind];
      // A blast on the ground does not reach the drones, nor one in the air the ground.
      if (!!def.air !== air) return;
      const d = Math.hypot(o.x - at[0], o.z - at[2]) - def.radius;
      if (d > radius) return;
      const near = 1 - 0.6 * Math.max(0, d / radius);
      this.hurtUnit(o, damage * near, owner, at[0], at[2]);
      if (!o.dead && !def.air) this.throwUnit(o, at, near, damage);
    });
    if (air) return;
    for (const b of [...this.buildings.values()]) {
      if (b.dead || (owner !== -1 && !this.hostile(owner, b.owner))) continue;
      const c = this.centreOf(b);
      const d = Math.max(0, Math.hypot(c[0] - at[0], c[2] - at[2]) - (BUILDINGS[b.kind].size * CELL) / 2);
      if (d <= radius) this.hurtBuilding(b, damage * (1 - 0.6 * (d / radius)), owner);
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
    for (const g of this.generals) {
      if (!g?.pid || (owner !== -1 && !this.hostile(owner, g.slot))) continue;
      const p = this.host.positionOf(g.pid);
      if (p && Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) <= radius + 2.5) this.hitGeneral(g.slot, at, owner);
    }
  }

  /** A general is hit: thrown, unless they were thrown only just now. Nothing else ever happens to a general. */
  private hitGeneral(slot: number, from: Vec, _owner: number): void {
    const g = this.generals[slot];
    if (!g?.pid || this.t < g.immuneUntil || this.host.isDown(g.pid)) return;
    // (About four seconds in the air and getting up, then the time they cannot be thrown again.)
    g.immuneUntil = this.t + 4 + GENERAL_IMMUNE;
    this.host.throwBuilder(g.pid, from);
  }

  private hurtUnit(u: Unit, damage: number, by: number, fromX: number, fromZ: number): void {
    const g = this.generals[u.owner];
    u.hp -= damage * (1 - (g?.upgrades.armour ?? 0) * UPGRADE_STEP);
    u.hitUntil = this.t + 0.3;
    if (u.hp <= 0) return this.kill(u, false);
    if (g) this.underAttack(g, u.x, u.z);
    // Standing idle and shot at from out of reach: goes for whoever is shooting.
    if (u.order.k === "stop" && !u.tk && UNITS[u.kind].weapon && by !== u.owner && u.owner !== NEUTRAL) {
      this.begin(u, { k: "amove", x: fromX, z: fromZ, l: 0, auto: true }, this.nextGroup++, 3);
    }
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
    this.host.wear(at, list, by >= 0 && by < MAX_GENERALS ? (this.generals[by]?.pid ?? "army") : "army");
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
        this.happened.zaps.push({ from: [c[0], BUILDINGS.laser.height, c[2]], to: [s.x, 9, s.z] });
        zapped = true;
        break;
      }
      if (!zapped) this.blast([s.x, 0.5, s.z], s.weapon.splash, s.damage, s.owner, s.weapon);
    }
  }

  /** A turret looks for something to shoot. */
  private guard(b: Building): void {
    const w = BUILDINGS[b.kind].weapon;
    if (!w || b.dead || b.doneAt !== 0 || this.t < b.stunUntil) return;
    const c = this.centreOf(b);
    if (b.tk && this.canHit(c[0], c[2], 0, true, b.owner, w, w.range, b.tk, b.tid, false) !== "ok") b.tk = 0;
    if (!b.tk && (this.step + b.id) % 3 === 0) {
      // (A turret stands above the walls round it: it needs no line.)
      const found = this.findTarget(c[0], c[2], 0, true, b.owner, w, w.range);
      if (found) {
        b.tk = found[0];
        b.tid = found[1];
      }
    }
    if (b.tk && this.t >= b.coolAt) {
      b.coolAt = this.t + w.cooldown;
      this.shoot([c[0], BUILDINGS[b.kind].height * 0.8, c[2]], b.owner, w, b.tk, b.tid);
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
          if (u.order.k === "return") return this.done(u);
          u.phase = 1;
        }
        return;
      }
    }
    // Phase 1: to the crystals.
    let f = this.fieldById.get(u.field);
    if (!f || f.kind !== "crystal" || f.amount <= 0) {
      const other = this.otherPatch(u, f);
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

  /** Moves a unit one step toward its goal. Sets `arrived` when it is there (or as near as it will get). */
  private travel(u: Unit, def: UnitDef): void {
    const goal = u.goal;
    if (!goal || u.arrived) return;
    // Artillery waits until it has packed up.
    if (def.deploy && this.t < u.packedAt) return;
    const reach = def.speed * DT;
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
      u.y = FLIGHT_HEIGHT;
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
          // A wall of the enemy's in the way: it is shot down.
          const wall = this.build.occupant({ type: "wall", x: this.nav.wallX, y: this.nav.wallL, z: this.nav.wallZ, rot: this.nav.wallRot });
          if (wall && def.weapon) {
            u.tk = T_PIECE;
            u.tid = wall.id;
            if (this.t >= u.coolAt && (!def.deploy || (u.deployedAt > 0 && this.t >= u.deployedAt))) {
              u.coolAt = this.t + def.weapon.cooldown;
              this.shoot([u.x, u.y + def.height * 0.7, u.z], u.owner, def.weapon, T_PIECE, wall.id);
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
    u.heading = Math.atan2(dx, dz);
    const s = Math.min(reach, d);
    const bx = u.x, bz = u.z;
    this.shift(u, u.x + (dx / d) * s, u.z + (dz / d) * s, classOf(def));
    // In the cell it was heading for: the next one is chosen from there (so it never doubles back to a spot it was pushed past).
    if (u.cx === Math.floor(goal.wx / CELL) && u.cz === Math.floor(goal.wz / CELL) && d < CELL * 0.6) goal.set = false;
    const moved = Math.hypot(u.x - bx, u.z - bz);
    if (moved < s * 0.3) {
      // Held up: look again for the way, and give up in the end.
      u.stuck += DT;
      goal.set = false;
      if (u.stuck > 5) u.arrived = true;
    } else u.stuck = Math.max(0, u.stuck - DT * 0.5);
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
    u.x = nx;
    u.z = nz;
    u.cx = cx;
    u.cz = cz;
    u.level = l;
    u.y = this.nav.heightAt(l, nx, nz);
  }

  /** Units standing in each other push apart (ground with ground, drones with drones). Haulers at work pass through. */
  private separate(): void {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]!;
      if (u.dead || u.inside || this.t < u.downUntil) continue;
      const def = UNITS[u.kind];
      if (u.kind === "hauler" && (u.order.k === "gather" || u.order.k === "return")) continue;
      // Artillery set up does not budge.
      if (def.deploy && u.deployedAt > 0) continue;
      let px = 0, pz = 0;
      this.nearby(u.x, u.z, def.radius + 3.5, (o, j) => {
        if (j === i || o.dead || o.inside) return;
        const od = UNITS[o.kind];
        if (!!od.air !== !!def.air || (!def.air && o.level !== u.level)) return;
        if (o.kind === "hauler" && (o.order.k === "gather" || o.order.k === "return")) return;
        const gap = def.radius + od.radius + 0.3;
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
        const give = (gap - d) * (o.arrived && !u.arrived ? 0.7 : u.arrived && !o.arrived ? 0.2 : 0.45);
        px += (dx / d) * give;
        pz += (dz / d) * give;
      });
      if (px === 0 && pz === 0) continue;
      const len = Math.hypot(px, pz), max = 0.5;
      if (len > max) {
        px = (px / len) * max;
        pz = (pz / len) * max;
      }
      if (def.air) {
        u.x = clampEdge(u.x + px);
        u.z = clampEdge(u.z + pz);
      } else this.shift(u, u.x + px, u.z + pz, classOf(def));
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
      const p = g?.pid ? this.host.positionOf(g.pid) : null;
      if (g && p) stamp(gridOf(g.team), p[0], p[2], generalSight(p[1]));
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
    // A general who left and has not come back: everything of theirs goes.
    // A place kept for someone who has not come back is anyone's now.
    for (const g of this.generals) {
      if (g && g.pid === null && g.leftAt > 0 && this.t - g.leftAt >= LEAVE_GRACE) {
        g.leftAt = 0;
        g.tab = null;
      }
    }
    if (this.step % 600 === 0) this.forgetIds();
    // Units whose floor has gone come down to what is under them; idle Haulers by crystals go back to work.
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
    // Sentries come back to a field nobody holds.
    if (this.step % 600 === 0) this.postSentries(false);
  }

  /** Stands a neutral sentry at every empty post (`all`), or at those long empty with nobody of anyone's near. */
  postSentries(all: boolean): void {
    for (let i = 0; i < this.posts.length; i++) {
      const post = this.posts[i]!;
      if (post.unit || this.units.length >= MAX_UNITS) continue;
      if (!all) {
        if (this.t - post.deadAt < 300) continue;
        let near = false;
        this.nearby(post.x, post.z, 80, (o) => {
          if (o.owner !== NEUTRAL && dist2(o.x, o.z, post.x, post.z) < 80 * 80) near = true;
        });
        for (const b of this.buildings.values()) if (dist2(...xz(this.centreOf(b)), post.x, post.z) < 80 * 80) near = true;
        if (near) continue;
      }
      const u = this.addUnit("trooper", NEUTRAL, post.x, post.z);
      u.order = { k: "hold" };
      u.post = i;
      u.heading = Math.atan2(u.x, u.z);
      post.unit = u.id;
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
      next: [this.nextUnit, this.nextBuilding, this.nextGroup, this.nextTake],
      generals: this.generals,
      units: this.units.filter((u) => !u.dead).map((u) => ({ ...u, goal: null, tk: 0, tid: 0 })),
      buildings: [...this.buildings.values()].map((b) => ({ ...b, tk: 0, tid: 0 })),
      fields: this.fields.map((f) => [f.id, Math.round(f.amount), f.refillAt]),
      posts: this.posts.map((p) => [p.unit, p.deadAt]),
    };
  }

  /** Takes up where a snapshot left off. Returns false (and stays empty) when it cannot be read. */
  restore(data: unknown): boolean {
    try {
      const s = data as { v: number; t: number; step: number; next: number[]; generals: (General | null)[]; units: Unit[]; buildings: Building[]; fields: [number, number, number][]; posts: [number, number][] };
      if (!s || s.v !== 1 || !Array.isArray(s.units) || !Array.isArray(s.buildings) || s.generals.length !== MAX_GENERALS) return false;
      this.t = s.t;
      this.step = s.step;
      [this.nextUnit, this.nextBuilding, this.nextGroup] = s.next as [number, number, number];
      this.nextTake = (s.next[3] ?? 0) % MAX_GENERALS;
      s.generals.forEach((g, i) => {
        this.generals[i] = g;
        if (!g) return;
        // (A war saved before there were always eight: each place has its own side and its own colour now.)
        g.team = g.slot;
        g.color = ARMY_COLORS[g.slot % ARMY_COLORS.length]!;
        g.joinedAt ??= -1e9;
        delete (g as { asked?: unknown }).asked;
        for (const pid of g.pids) this.slotOfPid.set(pid, g.slot);
      });
      for (const [id, amount, refillAt] of s.fields) {
        const f = this.fieldById.get(id);
        if (f) {
          f.amount = amount;
          f.refillAt = refillAt;
        }
      }
      for (const b of s.buildings) {
        if (!BUILDING_KINDS.includes(b.kind)) continue;
        this.buildings.set(b.id, b);
        const size = BUILDINGS[b.kind].size;
        for (let x = b.cx; x < b.cx + size; x++) for (let z = b.cz; z < b.cz + size; z++) this.footprint.set(`${x},${z}`, b.id);
        this.nav.fill(b.cx, b.cz, size, true);
      }
      for (const u of s.units) {
        if (!UNIT_KINDS.includes(u.kind)) continue;
        // Whatever they were doing, they pick it up again from where they stand.
        const order = u.order;
        u.linger ??= 0;
        u.goal = null;
        u.arrived = true;
        this.units.push(u);
        this.unitById.set(u.id, u);
        if (order.k !== "stop" && order.k !== "hold" && !u.inside) this.begin(u, order, 0, 2);
      }
      s.posts.forEach(([unit, deadAt], i) => {
        const post = this.posts[i];
        if (post) {
          post.unit = this.unitById.has(unit) ? unit : 0;
          post.deadAt = deadAt;
        }
      });
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
      for (const pid of g.pids) if (pid !== g.pid && !used.has(pid)) this.slotOfPid.delete(pid);
      g.pids = g.pids.filter((pid) => pid === g.pid || used.has(pid));
    }
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
const article = (label: string) => (/^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`);
