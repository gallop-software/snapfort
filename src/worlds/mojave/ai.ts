import { CELL } from "../../game/constants";
import { BUILDINGS, COMPUTER, MAX_SUPPLY, UNITS, UPGRADE_COST, UPGRADE_LEVELS, type BuildingKind, type UnitKind } from "./kit";
import { mid, STARTS } from "./map";
import { NEUTRAL, T_BUILDING, type Building, type General, type Sim, type Unit } from "./sim";

/**
 * The computer: one army, always pink (slot COMPUTER), played by the same
 * rules as a person and through the same calls (it pays the same prices, has
 * the same supply, and is told nothing a person is not: what it sees, and
 * where the starts and the Cores are, which everyone can see on the map). It
 * has no body, so it builds wherever its own base is, and it builds no walls.
 *
 * Hard, and fair (user, 2026-11-27: "Make pink really good. it's too easy"; it
 * was medium the same morning). It gets no more than a person: the same income,
 * prices, supply (200) and sight. It is strong by playing well: Haulers on
 * every patch and its natural expansion taken early, its money always spent on
 * four Foundries, two Skyports and a Titan bay, upgrades to the top, Relays
 * well ahead of need, and waves that come as soon as it has a few units and
 * grow to most of its army. A wave goes for the army it meets before the
 * buildings, is fed by everything made while it is out, and turns back only
 * when nearly gone. It leaves nobody alone: there is no time of peace.
 *
 * Nothing of its own is saved: what it is in the middle of is worked out
 * again from the board after a restart.
 */

// ── HARD: everything that sets how hard it is ───────────────────────────────
/** Haulers it keeps for its first Core, and more for each other Core, up to the most. */
const HAULERS_FIRST = 20, HAULERS_MORE = 14, HAULERS_MOST = 40;
/** The fighting supply of its first wave, how much more each next one waits for, and the most. */
const FIRST_WAVE = 12, WAVE_STEP = 10, BIGGEST_WAVE = 160;
/** Seconds between waves at least, and the longest a wave stays out before coming home. */
const WAVE_GAP = 40, WAVE_TIME = 600;
/** A wave down to this share of the supply it set out with (and was sent since) comes home to gather again. */
const RETREAT_AT = 0.2;
/** Units made while a wave is in join it, together, once this much fighting supply of them has gathered (or 40% of the wave's). */
const REINFORCE_AT = 8;
/** A wave gathers this far short of its target before it goes in, m, all within GATHERED m of the spot (or for GATHER_TIME s at most). */
const STAGE = 110, GATHERED = 35, GATHER_TIME = 50;
/** A wave waits to be this many times as strong as it has seen its target army to be. */
const STRONGER = 1.3;
/** What a turret counts for, in the supply of units it is as strong as. */
const TURRET_WORTH = 4;
/** An enemy unit it can see this near a wave's middle is what the wave goes for, m. */
const ENGAGE_RANGE = 70;
/** Enemies this near any of its buildings are driven off by everyone at home, m. */
const DEFEND_RANGE = 110;
/** A wave sent out less than this long ago comes back to defend too, s (and any wave, when what is at its base outnumbers those at home). */
const RECALL_WITHIN = 90;
/** Upgrades go this far: as far as a person's. */
const TOP_UPGRADE = UPGRADE_LEVELS;
/** It takes its natural expansion this long after it began, s. */
const EXPAND_AFTER = 240;
/** Lithium it always keeps back from units, for buildings. */
const KEEP_BACK = 50;
/** With everything in BUILD_ORDER up, this much lithium in the bank is spent on another Foundry, up to the most. */
const SPARE = 500, MOST_FOUNDRIES = 6;
/** How the army is made up: tanks to troopers, and the most of each kind it keeps. */
const TANKS_PER_TROOPER = 0.6;
const MOST: Partial<Record<UnitKind, number>> = { scout: 2, missile: 8, artillery: 4, gunship: 8, titan: 3 };

/** What it builds, in order: each once the one before it stands. (`core` 2: the natural expansion, after EXPAND_AFTER.) */
const BUILD_ORDER: readonly [BuildingKind, number][] = [
  ["foundry", 1], ["tap", 1], ["relay", 1], ["foundry", 2], ["armory", 1], ["sentry", 1], ["core", 2], ["tap", 2], ["skyport", 1], ["foundry", 3],
  ["flak", 1], ["titanbay", 1], ["foundry", 4], ["sentry", 2], ["skyport", 2], ["laser", 1], ["flak", 2],
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
  /** The enemy army a wave is fighting: where it was sent at them. */
  foe: [number, number] | null;
  /** A wave gathering short of its target, or gone in; where it gathers (and those made since gather), and since when. */
  phase: "gather" | "attack";
  stage: [number, number];
  stageAt: number;
  reserve: Set<number>;
  /** How strong each army it may attack has looked (fighting supply, and turrets), by slot: what a wave waits to outdo. */
  strength: Map<number, number>;
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
      this.mind = { bornAt: g.bornAt, wave: FIRST_WAVE, sentAt: -1e9, out: new Set(), outSupply: 0, target: -1, at: [0, 0], sawAir: false, sawForts: false, relayAt: -1e9, foe: null, phase: "gather", stage: [0, 0], stageAt: 0, reserve: new Set(), strength: new Map() };
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
    if (max < MAX_SUPPLY && max - used < 6 + makers * 4 && sim.t - mind.relayAt > 5 && g.lithium >= BUILDINGS.relay.lithium) {
      if (this.placeNear(g, "relay", home)) mind.relayAt = sim.t;
    }

    // ── Building up ──
    // The next thing it builds. Units do not wait for its lithium (a Foundry turns out only so much, and it makes more
    // than it spends: the buildings come out of the rest), except for a new Core, which is worth saving for; they do
    // wait for its plasma, which is scarce (a Tank's would otherwise always come first).
    let reserveL = KEEP_BACK, reserveP = 0, waiting = false;
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
      if (kind === "core") reserveL = Math.max(KEEP_BACK, def.lithium);
      reserveP = def.plasma;
      waiting = true;
      break;
    }
    // All of that up, and lithium piling up all the same: another Foundry to spend it.
    if (!waiting && g.lithium >= SPARE && mine.filter((b) => b.kind === "foundry").length < MOST_FOUNDRIES) this.placeNear(g, "foundry", home);
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
      else if (n("tank") < n("trooper") * TANKS_PER_TROOPER && g.plasma - reserveP >= UNITS.tank.plasma) kind = "tank";
      // (Artillery once it has a few Tanks to stand in front of it.)
      else if (mind.sawForts && has("armory") && n("tank") >= 3 && n("artillery") < MOST.artillery!) kind = "artillery";
      else if (sim.t - g.bornAt > EXPAND_AFTER && n("scout") < MOST.scout!) kind = "scout";
      // (What it wants cannot be paid for yet: a Trooper meanwhile, rather than the Foundry standing idle.)
      make(b, afford(kind) ? kind : "trooper");
    }
    // (Plasma goes to Tanks first: a gunship only with enough over for one.)
    for (const b of built("skyport")) if (b.queue.length < 1 && n("gunship") < MOST.gunship! && g.plasma - reserveP >= UNITS.gunship.plasma + UNITS.tank.plasma) make(b, "gunship");
    for (const b of built("titanbay")) if (b.queue.length < 1 && n("titan") < MOST.titan!) make(b, "titan");
    for (const b of built("armory")) {
      if (b.research) continue;
      const kind = g.upgrades.weapons <= g.upgrades.armour ? "weapons" : "armour";
      const level = g.upgrades[kind];
      const cost = UPGRADE_COST[level] ?? Infinity;
      if (level < TOP_UPGRADE && g.lithium - reserveL >= cost + 100 && g.plasma - reserveP >= cost) sim.research(slot, b.id, kind);
    }
    for (const b of mine) if (!b.rally && (b.kind === "foundry" || b.kind === "skyport")) sim.rally(slot, [b.id], rally[0], 0, rally[1]);

    // ── Fighting ──
    const fighters = units.filter((u) => UNITS[u.kind].weapon && !u.inside && u.kind !== "hauler");
    for (const id of [...mind.out]) if (!sim.unitById.get(id) || sim.unitById.get(id)!.dead) mind.out.delete(id);
    for (const id of [...mind.reserve]) if (!sim.unitById.get(id) || sim.unitById.get(id)!.dead || mind.out.has(id)) mind.reserve.delete(id);
    const wave = fighters.filter((u) => mind.out.has(u.id));
    const atHome = fighters.filter((u) => !mind.out.has(u.id));
    const supplyOf = (list: Unit[]) => list.reduce((s, u) => s + UNITS[u.kind].supply, 0);
    const ids = (list: Unit[]) => list.map((u) => u.id);
    /** The wave is over (won, lost, or called back): those still out, and those gathering to join it, go home. */
    const endWave = () => {
      const all = fighters.filter((u) => mind.out.has(u.id) || mind.reserve.has(u.id));
      if (all.length > 0) sim.command(slot, ids(all), { k: "move", x: rally[0], z: rally[1], l: 0 });
      mind.out.clear();
      mind.reserve.clear();
    };

    // Its base attacked: everyone at home goes for the attackers (and a wave only just sent, or any when what is at its
    // base outnumbers those at home, comes back for them).
    const threat = this.threat(g, mine, hc);
    if (threat) {
      const back = sim.t - mind.sentAt < RECALL_WITHIN || threat.supply > supplyOf(atHome) ? wave : [];
      if (back.length > 0) {
        mind.out.clear();
        mind.reserve.clear();
      }
      const go = [...atHome, ...back].filter((u) => u.order.k !== "amove" || Math.hypot(u.order.x - threat.x, u.order.z - threat.z) > 40);
      if (go.length > 0) sim.command(slot, ids(go), { k: "amove", x: threat.x, z: threat.z, l: 0 });
    } else {
      // Nothing at home to fight: whoever is idle away from the gathering place goes back to it (not those gathering to
      // join a wave).
      const stray = atHome.filter((u) => !mind.reserve.has(u.id) && (u.order.k === "stop" || u.order.k === "hold") && Math.hypot(u.x - rally[0], u.z - rally[1]) > 50);
      if (stray.length > 0) sim.command(slot, ids(stray), { k: "move", x: rally[0], z: rally[1], l: 0 });
    }

    // A wave out: it gathers short of its target, goes in together, on to the next thing of its target's; home when it
    // has lost nearly all of it, or been out too long.
    if (mind.out.size > 0) {
      const [sx, sz] = mind.stage;
      const near = (u: Unit) => Math.hypot(u.x - sx, u.z - sz) < GATHERED;
      /** Those who have just joined a wave gone in: sent on with the rest. */
      const joined = new Set<number>();
      if (!threat) {
        // What was made since it went gathers where the wave did. Gathering still, it is part of the wave; once the wave
        // has gone in, those gathered go in after it together, when there are enough of them to count.
        const fresh = atHome.filter((u) => !mind.reserve.has(u.id));
        if (fresh.length > 0 && (mind.phase === "gather" || supplyOf(fresh) >= REINFORCE_AT / 2)) {
          sim.command(slot, ids(fresh), { k: "amove", x: sx, z: sz, l: 0 });
          for (const u of fresh) mind.reserve.add(u.id);
        }
        const reserve = atHome.filter((u) => mind.reserve.has(u.id));
        const ready = reserve.filter(near);
        const join = mind.phase === "gather" ? reserve : supplyOf(ready) >= Math.max(REINFORCE_AT, supplyOf(wave) * 0.4) ? ready : [];
        if (join.length > 0) {
          for (const u of join) {
            mind.out.add(u.id);
            mind.reserve.delete(u.id);
          }
          mind.outSupply += supplyOf(join);
          wave.push(...join);
          if (mind.phase === "attack") for (const u of join) joined.add(u.id);
        }
      }
      const left = supplyOf(wave);
      if (left < mind.outSupply * RETREAT_AT || sim.t - mind.sentAt > WAVE_TIME) {
        // (A plain move: they turn for home and do not stop to fight on the way.)
        endWave();
        return;
      }
      if (mind.phase === "gather") {
        // Most of it there (or long enough waiting), and strong enough for what it sees of them now (or as big as it can
        // be): in together. Not yet: it waits there, and what is made meanwhile joins it.
        const there = wave.filter(near).length >= wave.length * 0.8 || sim.t - mind.stageAt >= GATHER_TIME;
        const strong = left >= STRONGER * (mind.strength.get(mind.target) ?? 0) || sim.supplyUsed(slot) >= MAX_SUPPLY - 6;
        if (!there || !strong) return;
        mind.phase = "attack";
        mind.at = [Infinity, Infinity];
      }
      const [wx, wz] = middleOf(wave);
      // An army of the enemy's in sight near it: that first, before any building.
      const foe = this.foeNear(g, wx, wz);
      if (foe) {
        if (!mind.foe || Math.hypot(foe[0] - mind.foe[0], foe[1] - mind.foe[1]) > 15) {
          mind.foe = foe;
          sim.command(slot, ids(wave), { k: "amove", x: foe[0], z: foe[1], l: 0 });
        }
        return;
      }
      if (mind.foe) {
        // (The fight is over: on to the buildings, all of them afresh.)
        mind.foe = null;
        mind.at = [Infinity, Infinity];
      }
      const target = this.targetOf(mind.target, wx, wz) ?? this.nextTarget(g, wx, wz);
      if (!target) {
        endWave();
        return;
      }
      const c = sim.centreOf(target);
      mind.target = target.owner;
      const moved = Math.hypot(c[0] - mind.at[0], c[2] - mind.at[1]) > 5;
      mind.at = [c[0], c[2]];
      // Those that got there and stopped (or all of them, for a new target): near it, an attack on it; further, an
      // attack-move to the ground before it (shooting whatever they meet on the way).
      const idle = wave.filter((u) => moved || joined.has(u.id) || u.order.k === "stop" || u.order.k === "hold");
      const close = idle.filter((u) => Math.hypot(u.x - c[0], u.z - c[2]) < 70);
      const far = idle.filter((u) => !close.includes(u));
      if (close.length > 0) sim.command(slot, ids(close), { k: "attack", tk: T_BUILDING, id: target.id });
      if (far.length > 0) {
        const [fx, fz] = this.before(target, wx, wz);
        sim.command(slot, ids(far), { k: "amove", x: fx, z: fz, l: 0 });
      }
      // The wave's gathering place keeps up with it, for those who come after.
      if (Math.hypot(wx - sx, wz - sz) > STAGE) mind.stage = this.stageFor(c[0], c[2], wx, wz);
      return;
    }

    // Big enough for what it has seen of them (and long enough since the last): the next wave, to gather short of them.
    if (threat || sim.t - mind.sentAt < WAVE_GAP || atHome.length === 0) return;
    const [hx, hz] = middleOf(atHome);
    const target = this.nextTarget(g, hx, hz);
    if (!target) return;
    const need = Math.min(BIGGEST_WAVE, Math.max(mind.wave, STRONGER * (mind.strength.get(target.owner) ?? 0)));
    const full = sim.supplyUsed(slot) >= MAX_SUPPLY - 6;
    if (supplyOf(atHome) < need && !(full && supplyOf(atHome) >= mind.wave)) return;
    const c = sim.centreOf(target);
    mind.out = new Set(ids(atHome));
    mind.reserve.clear();
    mind.outSupply = supplyOf(atHome);
    mind.sentAt = sim.t;
    mind.target = target.owner;
    mind.at = [c[0], c[2]];
    mind.wave = Math.min(BIGGEST_WAVE, mind.wave + WAVE_STEP);
    mind.foe = null;
    mind.phase = "gather";
    mind.stage = this.stageFor(c[0], c[2], hx, hz);
    mind.stageAt = sim.t;
    sim.command(slot, ids(atHome), { k: "amove", x: mind.stage[0], z: mind.stage[1], l: 0 });
  }

  /** Where a wave gathers before going in: STAGE short of (tx, tz) on the way from (x, z) (or where it is, already nearer). */
  private stageFor(tx: number, tz: number, x: number, z: number): [number, number] {
    const d = Math.hypot(x - tx, z - tz);
    if (d <= STAGE) return [x, z];
    return [tx + ((x - tx) / d) * STAGE, tz + ((z - tz) / d) * STAGE];
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

  /** What it has seen of its enemies: drones (it makes missile trucks), turrets (artillery), and how strong each army looks. */
  private look(g: General, mind: Mind): void {
    const sim = this.sim;
    // How strong: what of each it sees now, or what it saw before, fading (by half in a little over two minutes).
    const now = new Map<number, number>();
    for (const u of sim.units) {
      if (u.dead || u.inside || u.owner === g.slot || u.owner === NEUTRAL || !UNITS[u.kind].weapon || u.kind === "hauler" || !sim.sees(g.team, u.x, u.z)) continue;
      now.set(u.owner, (now.get(u.owner) ?? 0) + UNITS[u.kind].supply);
    }
    for (const b of sim.buildings.values()) {
      if (b.dead || b.owner === g.slot || !BUILDINGS[b.kind].weapon || b.doneAt !== 0) continue;
      const c = sim.centreOf(b);
      if (sim.sees(g.team, c[0], c[2])) now.set(b.owner, (now.get(b.owner) ?? 0) + TURRET_WORTH);
    }
    for (const slot of new Set([...now.keys(), ...mind.strength.keys()])) mind.strength.set(slot, Math.max(now.get(slot) ?? 0, (mind.strength.get(slot) ?? 0) * 0.995));
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

  /**
   * The nearest enemy unit to its base, when one is within DEFEND_RANGE of any of its buildings, and how much fighting
   * supply of the enemy's is that near them; else null.
   */
  private threat(g: General, mine: Building[], hc: readonly number[]): { x: number; z: number; supply: number } | null {
    const sim = this.sim;
    let best: { x: number; z: number; supply: number } | null = null, bestD = Infinity, supply = 0;
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
      if (UNITS[u.kind].weapon) supply += UNITS[u.kind].supply;
      const dd = (u.x - hc[0]!) ** 2 + (u.z - hc[2]!) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = { x: u.x, z: u.z, supply: 0 };
      }
    }
    if (best) best.supply = supply;
    return best;
  }

  /** The nearest armed unit, of an army it may attack, that it can see within ENGAGE_RANGE of (x, z); else null. */
  private foeNear(g: General, x: number, z: number): [number, number] | null {
    const sim = this.sim;
    let best: [number, number] | null = null, bestD = ENGAGE_RANGE * ENGAGE_RANGE;
    sim.nearby(x, z, ENGAGE_RANGE, (u) => {
      if (u.dead || u.inside || u.owner === g.slot || u.owner === NEUTRAL || !UNITS[u.kind].weapon || u.kind === "hauler" || !this.fair(u.owner)) return;
      const dd = (u.x - x) ** 2 + (u.z - z) ** 2;
      if (dd < bestD && sim.sees(g.team, u.x, u.z)) {
        bestD = dd;
        best = [u.x, u.z];
      }
    });
    return best;
  }

  /** Whether an army may be attacked: any person's, at any time (hard: no time of peace for a new one). */
  private fair(slot: number): boolean {
    const g = this.sim.generals[slot];
    return !!g && !g.ai;
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
