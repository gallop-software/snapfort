import { CELL } from "../../game/constants";
import { BUILDINGS, COMPUTER, COMPUTER_SUPPLY, NEWCOMER_PEACE, UNITS, UPGRADE_COST, type BuildingKind, type UnitKind } from "./kit";
import { mid, STARTS } from "./map";
import { NEUTRAL, T_BUILDING, type Building, type General, type Sim, type Unit } from "./sim";

/**
 * The computer: one army, always pink (slot COMPUTER), played by the same
 * rules as a person and through the same calls (it pays the same prices, has
 * the same supply, and is told nothing a person is not: what it sees, and
 * where the starts and the Cores are, which everyone can see on the map). It
 * has no body, so it builds wherever its own base is, and it builds no walls.
 *
 * Medium (user, 2026-11-27: "make it a good opponent, but don't make it
 * impossible to beat"): it mines, builds up in a sensible order, counters what
 * it sees (missile trucks for drones, artillery for turrets), defends its base,
 * and attacks in waves that grow. What keeps it beatable is below under
 * MEDIUM: it thinks every two seconds, stops at 120 supply, takes upgrades to
 * level 2, never makes a Titan, leaves an army alone for its first five
 * minutes, and pulls a wave back when it has lost most of it, which is the
 * moment to strike back.
 *
 * Nothing of its own is saved: what it is in the middle of is worked out
 * again from the board after a restart.
 */

// ── MEDIUM: everything that sets how hard it is ─────────────────────────────
/** Haulers it keeps for its first Core, and more for each other Core, up to the most. */
const HAULERS_FIRST = 16, HAULERS_MORE = 8, HAULERS_MOST = 24;
/** The fighting supply of its first wave, how much more each next one waits for, and the most. */
const FIRST_WAVE = 14, WAVE_STEP = 8, BIGGEST_WAVE = 60;
/** Seconds between waves at least, and the longest a wave stays out before coming home. */
const WAVE_GAP = 90, WAVE_TIME = 360;
/** A wave down to this share of the supply it set out with comes home to gather again. */
const RETREAT_AT = 0.35;
/** Enemies this near any of its buildings are driven off by everyone at home, m. */
const DEFEND_RANGE = 90;
/** A wave sent out less than this long ago comes back to defend too, s. */
const RECALL_WITHIN = 60;
/** Upgrades go this far (a person's go to 3). */
const TOP_UPGRADE = 2;
/** It takes its natural expansion this long after it began, s. */
const EXPAND_AFTER = 600;
/** Lithium it always keeps back from units, for buildings. */
const KEEP_BACK = 50;
/** How the army is made up: tanks to troopers, and the most of each kind it keeps. */
const TANKS_PER_TROOPER = 0.5;
const MOST: Partial<Record<UnitKind, number>> = { scout: 2, missile: 6, artillery: 3, gunship: 6 };

/** What it builds, in order: each once the one before it stands. (`core` 2: the natural expansion, after EXPAND_AFTER.) */
const BUILD_ORDER: readonly [BuildingKind, number][] = [
  ["foundry", 1], ["tap", 1], ["relay", 1], ["sentry", 1], ["foundry", 2], ["armory", 1], ["flak", 1], ["skyport", 1], ["core", 2], ["tap", 2], ["sentry", 2],
];

/** What it is in the middle of. */
interface Mind {
  /** The army this is for (when it was begun): one begun afresh starts with a fresh mind. */
  bornAt: number;
  /** Fighting supply the next wave waits for. */
  wave: number;
  sentAt: number;
  /** The units out on the wave, the supply they set out with, whose army they went for, and where. */
  out: Set<number>;
  outSupply: number;
  target: number;
  at: [number, number];
  /** It has seen an enemy drone, an enemy turret. */
  sawAir: boolean;
  sawForts: boolean;
  /** When it last put up a Relay mast (they stand at once: a little time for supply to be used before the next). */
  relayAt: number;
}

export class Computer {
  private mind: Mind | null = null;

  constructor(private readonly sim: Sim) {}

  /** Every couple of seconds while the war runs: the next sensible things. */
  think(): void {
    const sim = this.sim;
    const g = sim.generals[COMPUTER];
    if (!g?.ai) {
      this.mind = null;
      return;
    }
    if (!this.mind || this.mind.bornAt !== g.bornAt) {
      this.mind = { bornAt: g.bornAt, wave: FIRST_WAVE, sentAt: -1e9, out: new Set(), outSupply: 0, target: -1, at: [0, 0], sawAir: false, sawForts: false, relayAt: -1e9 };
    }
    const mind = this.mind;
    const slot = g.slot;

    const mine: Building[] = [];
    for (const b of sim.buildings.values()) if (b.owner === slot && !b.dead) mine.push(b);
    const units: Unit[] = [];
    const count = new Map<UnitKind, number>();
    for (const u of sim.units) {
      if (u.dead || u.owner !== slot) continue;
      units.push(u);
      count.set(u.kind, (count.get(u.kind) ?? 0) + 1);
    }
    for (const b of mine) for (const q of b.queue) count.set(q.kind, (count.get(q.kind) ?? 0) + 1);
    const n = (kind: UnitKind) => count.get(kind) ?? 0;
    const built = (kind: BuildingKind) => mine.filter((b) => b.kind === kind && b.doneAt === 0);
    const cores = built("core").sort((a, b) => a.id - b.id);
    const home = cores[0];

    // Routed: a new Core where it began (or the nearest clear ground) as soon as one is free.
    if (!home) {
      mind.out.clear();
      if (sim.routedFree(g)) {
        const s = STARTS[g.start]!;
        const spot = sim.clearSpot(slot, "core", s.cx - 1, s.cz - 1);
        if (spot) sim.orderBuilding(slot, "core", spot[0], spot[1]);
      }
      return;
    }
    const hc = sim.centreOf(home);
    // Toward the middle of the map from its base: where its army gathers.
    const d = Math.hypot(hc[0], hc[2]) || 1;
    const rally: [number, number] = [hc[0] - (hc[0] / d) * 30, hc[2] - (hc[2] / d) * 30];

    this.look(g, mind);

    // ── Money ──
    const used = sim.supplyUsed(slot), max = sim.supplyMax(slot);
    const wantHaulers = Math.min(HAULERS_MOST, HAULERS_FIRST + (cores.length - 1) * HAULERS_MORE);
    for (const core of cores) {
      if (core.queue.length < 2 && n("hauler") < wantHaulers && sim.supplyUsed(slot) < sim.supplyMax(slot) && sim.make(slot, core.id, "hauler") === "") count.set("hauler", n("hauler") + 1);
    }
    // Supply before it runs out (more ahead the more it makes at once).
    const makers = built("foundry").length + built("skyport").length;
    if (max < COMPUTER_SUPPLY && max - used < 4 + makers * 3 && sim.t - mind.relayAt > 8 && g.lithium >= BUILDINGS.relay.lithium) {
      if (this.placeNear(g, "relay", home)) mind.relayAt = sim.t;
    }

    // ── Building up ──
    // The next thing it builds: units wait for it, except Haulers (money first).
    let reserveL = KEEP_BACK, reserveP = 0;
    for (const [kind, want] of BUILD_ORDER) {
      if (mine.filter((b) => b.kind === kind).length >= want) continue;
      if (kind === "core" && (sim.t - g.bornAt < EXPAND_AFTER || !this.natural(g))) continue;
      const def = BUILDINGS[kind];
      if ((def.needs ?? []).some((need) => built(need).length === 0)) break;
      if (g.lithium >= def.lithium && g.plasma >= def.plasma) {
        const placed = kind === "tap" ? this.placeTap(g, cores) : kind === "core" ? this.expand(g) : this.placeNear(g, kind, home);
        // (Nowhere to put it: on to the next, rather than waiting for ever.)
        if (placed || kind === "tap" || kind === "core") continue;
      }
      reserveL = Math.max(KEEP_BACK, def.lithium);
      reserveP = def.plasma;
      break;
    }
    const afford = (kind: UnitKind) => g.lithium - reserveL >= UNITS[kind].lithium && g.plasma - reserveP >= UNITS[kind].plasma;
    const room = (kind: UnitKind) => sim.supplyUsed(slot) + UNITS[kind].supply <= sim.supplyMax(slot);
    const has = (kind: BuildingKind) => built(kind).length > 0;
    const make = (b: Building, kind: UnitKind) => {
      if (afford(kind) && room(kind) && sim.make(slot, b.id, kind) === "") count.set(kind, n(kind) + 1);
    };

    // ── The army: what it has seen decides the mix ──
    for (const b of built("foundry")) {
      if (b.queue.length >= 2) continue;
      let kind: UnitKind = "trooper";
      if (n("scout") < 1) kind = "scout";
      else if (mind.sawAir && has("armory") && n("missile") < Math.min(MOST.missile!, 2 + Math.floor(n("trooper") / 6))) kind = "missile";
      else if (mind.sawForts && has("armory") && n("artillery") < MOST.artillery!) kind = "artillery";
      else if (n("tank") < n("trooper") * TANKS_PER_TROOPER && g.plasma - reserveP >= UNITS.tank.plasma) kind = "tank";
      else if (sim.t - g.bornAt > EXPAND_AFTER && n("scout") < MOST.scout!) kind = "scout";
      make(b, kind);
    }
    for (const b of built("skyport")) if (b.queue.length < 1 && n("gunship") < MOST.gunship!) make(b, "gunship");
    for (const b of built("armory")) {
      if (b.research) continue;
      const kind = g.upgrades.weapons <= g.upgrades.armour ? "weapons" : "armour";
      const level = g.upgrades[kind];
      const cost = UPGRADE_COST[level] ?? Infinity;
      if (level < TOP_UPGRADE && g.lithium - reserveL >= cost + 150 && g.plasma - reserveP >= cost) sim.research(slot, b.id, kind);
    }
    for (const b of mine) if (!b.rally && (b.kind === "foundry" || b.kind === "skyport")) sim.rally(slot, [b.id], rally[0], 0, rally[1]);

    // ── Fighting ──
    const fighters = units.filter((u) => UNITS[u.kind].weapon && !u.inside && u.kind !== "hauler");
    for (const id of [...mind.out]) if (!sim.unitById.get(id) || sim.unitById.get(id)!.dead) mind.out.delete(id);
    const wave = fighters.filter((u) => mind.out.has(u.id));
    const atHome = fighters.filter((u) => !mind.out.has(u.id));
    const supplyOf = (list: Unit[]) => list.reduce((s, u) => s + UNITS[u.kind].supply, 0);

    // Its base attacked: everyone at home goes for the attackers (and a wave only just sent comes back for them).
    const threat = this.threat(g, mine, hc);
    if (threat) {
      const back = sim.t - mind.sentAt < RECALL_WITHIN ? wave : [];
      if (back.length > 0) mind.out.clear();
      const go = [...atHome, ...back].filter((u) => u.order.k !== "amove" || Math.hypot(u.order.x - threat[0], u.order.z - threat[1]) > 40);
      if (go.length > 0) sim.command(slot, go.map((u) => u.id), { k: "amove", x: threat[0], z: threat[1], l: 0 });
    } else {
      // Nothing at home to fight: whoever is idle away from the gathering place goes back to it.
      const stray = atHome.filter((u) => (u.order.k === "stop" || u.order.k === "hold") && Math.hypot(u.x - rally[0], u.z - rally[1]) > 50);
      if (stray.length > 0) sim.command(slot, stray.map((u) => u.id), { k: "move", x: rally[0], z: rally[1], l: 0 });
    }

    // A wave out: on to the next thing of its target's, or home when it has lost too much, or been out too long.
    if (mind.out.size > 0) {
      const left = supplyOf(wave);
      if (left < mind.outSupply * RETREAT_AT || sim.t - mind.sentAt > WAVE_TIME) {
        // (A plain move: they turn for home and do not stop to fight on the way.)
        sim.command(slot, wave.map((u) => u.id), { k: "move", x: rally[0], z: rally[1], l: 0 });
        mind.out.clear();
      } else {
        const [wx, wz] = middleOf(wave);
        const target = this.targetOf(mind.target, wx, wz) ?? this.nextTarget(g, wx, wz);
        if (!target) {
          sim.command(slot, wave.map((u) => u.id), { k: "amove", x: rally[0], z: rally[1], l: 0 });
          mind.out.clear();
        } else {
          const c = sim.centreOf(target);
          mind.target = target.owner;
          const moved = Math.hypot(c[0] - mind.at[0], c[2] - mind.at[1]) > 5;
          mind.at = [c[0], c[2]];
          // Those that got there and stopped (or all of them, for a new target): near it, an attack on it; further, an
          // attack-move to the ground before it (fighting whatever they meet on the way).
          const idle = wave.filter((u) => moved || u.order.k === "stop" || u.order.k === "hold");
          const close = idle.filter((u) => Math.hypot(u.x - c[0], u.z - c[2]) < 70);
          const far = idle.filter((u) => !close.includes(u));
          if (close.length > 0) sim.command(slot, close.map((u) => u.id), { k: "attack", tk: T_BUILDING, id: target.id });
          if (far.length > 0) {
            const [fx, fz] = this.before(target, wx, wz);
            sim.command(slot, far.map((u) => u.id), { k: "amove", x: fx, z: fz, l: 0 });
          }
        }
      }
      return;
    }

    // Big enough, and long enough since the last: the next wave.
    if (!threat && supplyOf(atHome) >= mind.wave && sim.t - mind.sentAt >= WAVE_GAP) {
      const target = this.nextTarget(g, hc[0], hc[2]);
      if (!target) return;
      const c = sim.centreOf(target);
      mind.out = new Set(atHome.map((u) => u.id));
      mind.outSupply = supplyOf(atHome);
      mind.sentAt = sim.t;
      mind.target = target.owner;
      mind.at = [c[0], c[2]];
      mind.wave = Math.min(BIGGEST_WAVE, mind.wave + WAVE_STEP);
      const [fx, fz] = this.before(target, ...middleOf(atHome));
      sim.command(slot, atHome.map((u) => u.id), { k: "amove", x: fx, z: fz, l: 0 });
    }
  }

  /** Open ground just before a building, on the side toward (x, z): where a wave goes to attack it (nobody can stand inside one). */
  private before(b: Building, x: number, z: number): [number, number] {
    const c = this.sim.centreOf(b);
    const d = Math.hypot(x - c[0], z - c[2]) || 1;
    const out = (BUILDINGS[b.kind].size * CELL) / 2 + 14;
    return [c[0] + ((x - c[0]) / d) * out, c[2] + ((z - c[2]) / d) * out];
  }

  /** Whether a wave is out now (for checks). */
  get attacking(): boolean {
    return (this.mind?.out.size ?? 0) > 0;
  }

  /** What it has seen of its enemies: drones (it makes missile trucks) and turrets (artillery). */
  private look(g: General, mind: Mind): void {
    const sim = this.sim;
    if (!mind.sawAir) {
      for (const u of sim.units) {
        if (!u.dead && u.owner !== g.slot && u.owner !== NEUTRAL && UNITS[u.kind].air && sim.sees(g.team, u.x, u.z)) {
          mind.sawAir = true;
          break;
        }
      }
    }
    if (!mind.sawForts) {
      for (const b of sim.buildings.values()) {
        if (b.dead || b.owner === g.slot || !BUILDINGS[b.kind].nearCore) continue;
        const c = sim.centreOf(b);
        if (sim.sees(g.team, c[0], c[2])) {
          mind.sawForts = true;
          break;
        }
      }
    }
  }

  /** Where the nearest enemy unit to its base is, when one is within DEFEND_RANGE of any of its buildings; else null. */
  private threat(g: General, mine: Building[], hc: readonly number[]): [number, number] | null {
    const sim = this.sim;
    let best: [number, number] | null = null, bestD = Infinity;
    for (const u of sim.units) {
      if (u.dead || u.inside || u.owner === g.slot || u.owner === NEUTRAL) continue;
      let near = false;
      for (const b of mine) {
        const c = sim.centreOf(b);
        if ((c[0] - u.x) ** 2 + (c[2] - u.z) ** 2 < DEFEND_RANGE * DEFEND_RANGE) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      const dd = (u.x - hc[0]!) ** 2 + (u.z - hc[2]!) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = [u.x, u.z];
      }
    }
    return best;
  }

  /** Whether an army may be attacked: a person's, past its first NEWCOMER_PEACE seconds. */
  private fair(slot: number): boolean {
    const g = this.sim.generals[slot];
    return !!g && !g.ai && this.sim.t - g.bornAt >= NEWCOMER_PEACE;
  }

  /** The building of this army's nearest a spot (a Core counts as much nearer: it goes for those), or null. */
  private targetOf(slot: number, x: number, z: number): Building | null {
    if (slot < 0 || !this.fair(slot)) return null;
    let best: Building | null = null, bestD = Infinity;
    for (const b of this.sim.buildings.values()) {
      if (b.dead || b.owner !== slot) continue;
      const c = this.sim.centreOf(b);
      const dd = Math.hypot(c[0] - x, c[2] - z) - (b.kind === "core" ? 150 : 0);
      if (dd < bestD) {
        bestD = dd;
        best = b;
      }
    }
    return best;
  }

  /** The nearest army it may attack, and the building of it to go for. */
  private nextTarget(g: General, x: number, z: number): Building | null {
    let best: Building | null = null, bestD = Infinity;
    for (const other of this.sim.generals) {
      if (!other || other.slot === g.slot) continue;
      const b = this.targetOf(other.slot, x, z);
      if (!b) continue;
      const c = this.sim.centreOf(b);
      const dd = Math.hypot(c[0] - x, c[2] - z);
      if (dd < bestD) {
        bestD = dd;
        best = b;
      }
    }
    return best;
  }

  /** The middle of its natural expansion (cells), when nobody else has a Core there; else null. */
  private natural(g: General): [number, number] | null {
    const s = STARTS[g.start]!;
    const d = Math.hypot(s.cx, s.cz) || 1;
    const nx = Math.round(s.cx - (s.cx / d) * 24), nz = Math.round(s.cz - (s.cz / d) * 24);
    for (const b of this.sim.buildings.values()) {
      if (b.dead || b.kind !== "core" || b.owner === g.slot) continue;
      const c = this.sim.centreOf(b);
      if (Math.hypot(c[0] - mid(nx), c[2] - mid(nz)) < 60) return null;
    }
    return [nx, nz];
  }

  private expand(g: General): boolean {
    const at = this.natural(g);
    const spot = at && this.sim.clearSpot(g.slot, "core", at[0] - 1, at[1] - 1, 4);
    return !!spot && this.sim.orderBuilding(g.slot, "core", spot[0], spot[1]) === "";
  }

  /** A building on the nearest clear ground to the Core, on the side toward the middle of the map (the crystals are on the other), a cell clear all round. */
  private placeNear(g: General, kind: BuildingKind, home: Building): boolean {
    const sim = this.sim;
    const size = BUILDINGS[kind].size;
    const c = sim.centreOf(home);
    const hx = Math.floor(c[0] / CELL), hz = Math.floor(c[2] / CELL);
    const inX = -Math.sign(hx) || 1, inZ = -Math.sign(hz) || 1;
    for (let r = 3; r <= 14; r++) {
      for (let a = 0; a <= r; a++) {
        for (const [dx, dz] of [[a, r], [r, a], [-a, r], [r, -a]] as const) {
          const cx = hx + inX * dx - (inX < 0 ? size - 1 : 0), cz = hz + inZ * dz - (inZ < 0 ? size - 1 : 0);
          let clear = true;
          for (let x = cx - 1; x <= cx + size && clear; x++) for (let z = cz - 1; z <= cz + size && clear; z++) if (!sim.nav.clearGround(x, z)) clear = false;
          if (clear && sim.cannotBuild(g.slot, kind, cx, cz) === "" && sim.orderBuilding(g.slot, kind, cx, cz) === "") return true;
        }
      }
    }
    return false;
  }

  /** A Tap on the nearest vent without one, near one of its Cores. */
  private placeTap(g: General, cores: Building[]): boolean {
    const sim = this.sim;
    let best: [number, number] | null = null, bestD = 70;
    for (const f of sim.fields) {
      if (f.kind !== "vent" || f.amount <= 0 || sim.cannotBuild(g.slot, "tap", f.cx, f.cz) !== "") continue;
      for (const core of cores) {
        const c = sim.centreOf(core);
        const dd = Math.hypot(mid(f.cx) - c[0], mid(f.cz) - c[2]);
        if (dd < bestD) {
          bestD = dd;
          best = [f.cx, f.cz];
        }
      }
    }
    return !!best && sim.orderBuilding(g.slot, "tap", best[0], best[1]) === "";
  }
}

function middleOf(units: readonly Unit[]): [number, number] {
  let x = 0, z = 0;
  for (const u of units) {
    x += u.x;
    z += u.z;
  }
  return units.length ? [x / units.length, z / units.length] : [0, 0];
}
