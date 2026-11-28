import { CELL } from "../../game/constants";
import { BUILDINGS, COMPUTER, GUARD_RADIUS, MAX_SUPPLY, UNITS, UPGRADE_COST, UPGRADE_LEVELS, type BuildingKind, type UnitKind } from "./kit";
import { mid, SITES, STARTS } from "./map";
import { NEUTRAL, T_BUILDING, type Building, type General, type Sim, type Unit } from "./sim";

/**
 * The computer: one army, always pink (slot COMPUTER), played by the same
 * rules as a person and through the same calls (it pays the same prices, has
 * the same supply, and is told nothing a person is not: what it sees, and
 * where the starts and the Cores are, which everyone can see on the map). It
 * has no body, so it builds wherever its own base is, and it builds no walls.
 *
 * Hard, and fair (user, 2026-11-27: "Make pink really good. it's too easy"). It
 * gets no more than a person: the same income, prices, supply (200) and sight.
 *
 * Its plan (the user, the same day: "the number one goal starting off is to
 * have a strong booming economy. so defense and expansion, as fast as
 * possible... then building the most advanced units possible"): Haulers on
 * every patch; a Foundry, then every Core its first turrets, and a new base as
 * soon as it has saved for one, on any free site (its natural, a start no
 * colour in play holds, or a rich field in the middle); each base its full
 * defence on the side trouble
 * comes from. Its army stays small and at home meanwhile. Once booming (three
 * guarded bases, or full), it builds what makes the most advanced army (Titan
 * bays, Skyports, an Armory and its upgrades) and makes Titans, Tanks and
 * gunships, and its waves begin: gathering out of reach until stronger than
 * what they have seen of the enemy, then in together.
 *
 * Nothing of its own is saved: what it is in the middle of is worked out
 * again from the board after a restart.
 */

// ── HARD: everything that sets how hard it is ───────────────────────────────
/** Haulers it keeps for each crystal patch by one of its Cores, and the most in all (supply, and upkeep). */
const HAULERS_PER_PATCH = 2.5, HAULERS_MOST = 60;
/** Bases it may have, and how many guarded ones make it booming (and free to attack). */
const MOST_CORES = 6, BOOM_CORES = 3;
/** A base's first turrets, and its full defence (and a Laser once it has an Armory). */
const BASIC_SENTRIES = 2, FULL_SENTRIES = 4, FULL_FLAK = 2;
/** Sentries a base may have, built from lithium to spare once booming. */
const MOST_SENTRIES = 8;
/** Turrets go this far out from their Core, in cells (toward where trouble comes from), this far apart, m. */
const TURRET_RINGS = [5, 6, 7, 4, 8] as const, TURRET_GAP = 8;
/** A site with another army's Core this near it is not settled, m. */
const SITE_TAKEN = 120;
/** Its army's fighting supply until it is booming, and the Troopers it keeps at home whatever it is saving for. */
const EARLY_ARMY = 24, HOME_GUARD = 6;
/** Once booming, Troopers are made only while they are less than this share of its army's fighting supply. */
const TROOPERS_AT_MOST = 0.2;
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
/** Lithium it always keeps back from units, for buildings. */
const KEEP_BACK = 50;
/** With everything in ADVANCED up, this much lithium in the bank is spent on another Foundry, up to the most. */
const SPARE = 500, MOST_FOUNDRIES = 6;
/** The most of each kind it keeps. */
const MOST: Partial<Record<UnitKind, number>> = { scout: 2, missile: 8, artillery: 4, gunship: 8, titan: 8 };

/** Once booming: what makes the most advanced army, in order, each once the one before it stands. */
const ADVANCED: readonly [BuildingKind, number][] = [
  ["armory", 1], ["skyport", 1], ["titanbay", 1], ["foundry", 3], ["skyport", 2], ["titanbay", 2], ["foundry", 4],
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
  /** Its Cores with no room left round them for more turrets. */
  cramped: Set<number>;
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
      this.mind = { bornAt: g.bornAt, wave: FIRST_WAVE, sentAt: -1e9, out: new Set(), outSupply: 0, target: -1, at: [0, 0], sawAir: false, sawForts: false, relayAt: -1e9, foe: null, phase: "gather", stage: [0, 0], stageAt: 0, reserve: new Set(), strength: new Map(), cramped: new Set() };
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

    // ── Money first: Haulers on every patch, at every Core ──
    const used = sim.supplyUsed(slot), max = sim.supplyMax(slot);
    const wantHaulers = Math.min(HAULERS_MOST, cores.reduce((s, c) => s + Math.round(this.patchesNear(c) * HAULERS_PER_PATCH), 0));
    for (const core of cores) {
      if (core.queue.length < 2 && n("hauler") < wantHaulers && sim.supplyUsed(slot) < sim.supplyMax(slot) && sim.make(slot, core.id, "hauler") === "") count.set("hauler", n("hauler") + 1);
    }
    // Supply before it runs out (more ahead the more it makes at once).
    const makers = built("foundry").length + built("skyport").length + built("titanbay").length;
    if (max < MAX_SUPPLY && max - used < 6 + makers * 4 && sim.t - mind.relayAt > 5 && g.lithium >= BUILDINGS.relay.lithium) {
      if (this.placeNear(g, "relay", home)) mind.relayAt = sim.t;
    }

    // ── Building up: a defended economy first, as fast as it can; then what makes the most advanced army ──
    const has = (kind: BuildingKind) => built(kind).length > 0;
    const guard = new Map(cores.map((c) => [c.id, this.guardOf(slot, c)]));
    // (A Core with no room left round it for turrets counts as guarded: it does not hold everything else up.)
    const basic = (c: Building) => mind.cramped.has(c.id) || guard.get(c.id)!.sentry >= BASIC_SENTRIES;
    const full = (c: Building) => {
      const t = guard.get(c.id)!;
      return mind.cramped.has(c.id) || (t.sentry >= FULL_SENTRIES && t.flak >= FULL_FLAK && (!has("armory") || t.laser >= 1));
    };
    const booming = (cores.length >= BOOM_CORES && cores.every(basic)) || used >= MAX_SUPPLY - 6;
    let reserveL = KEEP_BACK, reserveP = 0;
    /**
     * The next thing on the list: built now if it can be paid for (true: on to the next thing); else saved for (false:
     * nothing after it). Until it is booming everything but Haulers waits for it; after, units wait only for its plasma
     * (and for a new Core's lithium, always worth saving for).
     */
    const build = (kind: BuildingKind, place: () => boolean): boolean => {
      const def = BUILDINGS[kind];
      if ((def.needs ?? []).some((need) => !has(need))) return true;
      if (g.lithium >= def.lithium && g.plasma >= def.plasma) {
        // (Nowhere to put it: on to the next, rather than waiting for ever.)
        place();
        return true;
      }
      reserveL = booming && kind !== "core" ? KEEP_BACK : Math.max(KEEP_BACK, def.lithium);
      reserveP = def.plasma;
      return false;
    };
    /** A turret at a Core, toward where trouble comes from; no room left there, and that Core is done with. */
    const turret = (c: Building, kind: BuildingKind) => () => {
      if (this.placeGuard(g, c, kind)) return true;
      mind.cramped.add(c.id);
      return false;
    };
    const site = cores.length < MOST_CORES && cores.every(basic) && (cores.length < BOOM_CORES || cores.every(full)) ? this.nextSite(g, cores) : null;
    ((): void => {
      if (!has("foundry") && !build("foundry", () => this.placeNear(g, "foundry", home))) return;
      if (this.freeVent(g, cores) && !build("tap", () => this.placeTap(g, cores))) return;
      // Every Core its first turrets, before anything else.
      for (const c of cores) if (!basic(c) && !build("sentry", turret(c, "sentry"))) return;
      // The next base.
      if (site && !build("core", () => this.settle(g, site))) return;
      // Every Core its full defence.
      for (const c of cores) {
        if (full(c)) continue;
        const t = guard.get(c.id)!;
        const kind: BuildingKind = t.sentry < FULL_SENTRIES ? "sentry" : t.flak < FULL_FLAK ? "flak" : "laser";
        if (!build(kind, turret(c, kind))) return;
      }
      if (mine.filter((b) => b.kind === "foundry").length < 2 && !build("foundry", () => this.placeNear(g, "foundry", home))) return;
      if (!booming) return;
      // Booming: what makes the most advanced army there is.
      for (const [kind, want] of ADVANCED) {
        if (mine.filter((b) => b.kind === kind).length >= want) continue;
        if (!build(kind, () => this.placeNear(g, kind, home))) return;
      }
      // All of that up, and lithium piling up all the same (plasma is what holds the army back): another Foundry, and
      // more Sentries at every base.
      if (g.lithium >= SPARE && mine.filter((b) => b.kind === "foundry").length < MOST_FOUNDRIES) this.placeNear(g, "foundry", home);
      for (const c of cores) if (g.lithium >= SPARE && !mind.cramped.has(c.id) && guard.get(c.id)!.sentry < MOST_SENTRIES) turret(c, "sentry")();
    })();
    const afford = (kind: UnitKind) => g.lithium - reserveL >= UNITS[kind].lithium && g.plasma - reserveP >= UNITS[kind].plasma;
    const room = (kind: UnitKind) => sim.supplyUsed(slot) + UNITS[kind].supply <= sim.supplyMax(slot);
    const make = (b: Building, kind: UnitKind) => {
      if (afford(kind) && room(kind) && sim.make(slot, b.id, kind) === "") count.set(kind, n(kind) + 1);
    };

    // ── The army: small until it is booming (its turrets hold the bases), then the most advanced it can make ──
    const fightingSupply = units.reduce((s, u) => s + (UNITS[u.kind].weapon && u.kind !== "hauler" ? UNITS[u.kind].supply : 0), 0)
      + mine.reduce((s, b) => s + b.queue.reduce((q, x) => q + (x.kind === "hauler" ? 0 : UNITS[x.kind].supply), 0), 0);
    if (booming) {
      // Plasma to Titans first (kept back for the next one while a Titan bay could make it), then Tanks, then drones.
      for (const b of built("titanbay")) if (b.queue.length < 1 && n("titan") < MOST.titan!) make(b, "titan");
      reserveP += has("titanbay") && n("titan") < MOST.titan! ? UNITS.titan.plasma : 0;
      for (const b of built("foundry")) {
        if (b.queue.length >= 2) continue;
        let kind: UnitKind = "tank";
        if (n("scout") < 1) kind = "scout";
        else if (mind.sawAir && has("armory") && n("missile") < Math.min(MOST.missile!, 2 + Math.floor(fightingSupply / 20))) kind = "missile";
        // (Artillery once it has a few Tanks to stand in front of it.)
        else if (mind.sawForts && has("armory") && n("tank") >= 4 && n("artillery") < MOST.artillery!) kind = "artillery";
        // What it wants cannot be paid for yet: a Trooper meanwhile, while they are a small part of the army (they
        // would take the room the better units need); else it waits.
        if (afford(kind)) make(b, kind);
        else if (n("trooper") * UNITS.trooper.supply < fightingSupply * TROOPERS_AT_MOST) make(b, "trooper");
      }
      for (const b of built("skyport")) if (b.queue.length < 1 && n("gunship") < MOST.gunship! && g.plasma - reserveP >= UNITS.gunship.plasma + UNITS.tank.plasma) make(b, "gunship");
      for (const b of built("armory")) {
        if (b.research) continue;
        const kind = g.upgrades.weapons <= g.upgrades.armour ? "weapons" : "armour";
        const level = g.upgrades[kind];
        const cost = UPGRADE_COST[level] ?? Infinity;
        if (level < TOP_UPGRADE && g.lithium - reserveL >= cost + 100 && g.plasma - reserveP >= cost) sim.research(slot, b.id, kind);
      }
    } else if (fightingSupply < EARLY_ARMY) {
      for (const b of built("foundry")) {
        if (b.queue.length >= 1) continue;
        // (A few Troopers for home whatever it is saving for; more only from what is over.)
        if (fightingSupply < HOME_GUARD && g.lithium >= UNITS.trooper.lithium && room("trooper")) {
          if (sim.make(slot, b.id, "trooper") === "") count.set("trooper", n("trooper") + 1);
        } else make(b, n("tank") < n("trooper") / 2 && afford("tank") ? "tank" : "trooper");
      }
    }
    for (const b of mine) if (!b.rally && (b.kind === "foundry" || b.kind === "skyport" || b.kind === "titanbay")) sim.rally(slot, [b.id], rally[0], 0, rally[1]);

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

    if (threat) return;
    // Not booming yet: no waves; its army stays at home.
    if (!booming) return;
    // Big enough for what it has seen of them (and long enough since the last): the next wave, to gather short of them.
    if (sim.t - mind.sentAt < WAVE_GAP || atHome.length === 0) return;
    const [hx, hz] = middleOf(atHome);
    const target = this.nextTarget(g, hx, hz);
    if (!target) return;
    const need = Math.min(BIGGEST_WAVE, Math.max(mind.wave, STRONGER * (mind.strength.get(target.owner) ?? 0)));
    const maxed = sim.supplyUsed(slot) >= MAX_SUPPLY - 6;
    if (supplyOf(atHome) < need && !(maxed && supplyOf(atHome) >= mind.wave)) return;
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

  /**
   * Where its next base goes: the nearest free site to its bases (its natural, a start no colour in play holds, or its
   * natural, or a rich field in the middle), as cells. None with a Core of its own on it, or another army's near it.
   */
  private nextSite(g: General, cores: Building[]): { cx: number; cz: number } | null {
    const sim = this.sim;
    const held = new Set<number>();
    for (const other of sim.generals) if (other && other.slot !== g.slot) held.add(other.start);
    let best: { cx: number; cz: number } | null = null, bestD = Infinity;
    for (const site of SITES) {
      if (site.start >= 0 && held.has(site.start)) continue;
      const x = mid(site.cx), z = mid(site.cz);
      let near = Infinity, taken = false;
      for (const b of sim.buildings.values()) {
        if (b.dead || b.kind !== "core") continue;
        const c = sim.centreOf(b), dd = Math.hypot(c[0] - x, c[2] - z);
        if (b.owner === g.slot ? dd < 60 : dd < SITE_TAKEN) taken = true;
      }
      if (taken) continue;
      for (const c of cores) near = Math.min(near, Math.hypot(sim.centreOf(c)[0] - x, sim.centreOf(c)[2] - z));
      if (near < bestD) {
        bestD = near;
        best = { cx: site.cx, cz: site.cz };
      }
    }
    return best;
  }

  /** A Core on a site (on the nearest clear ground to its middle). */
  private settle(g: General, site: { cx: number; cz: number }): boolean {
    const spot = this.sim.clearSpot(g.slot, "core", site.cx - 1, site.cz - 1, 6);
    return !!spot && this.sim.orderBuilding(g.slot, "core", spot[0], spot[1]) === "";
  }

  /** Crystal patches with crystals left within 60 m of a Core. */
  private patchesNear(core: Building): number {
    const c = this.sim.centreOf(core);
    let n = 0;
    for (const f of this.sim.fields) if (f.kind === "crystal" && f.amount > 0 && Math.hypot(mid(f.cx) - c[0], mid(f.cz) - c[2]) < 60) n++;
    return n;
  }

  /** Its turrets guarding a Core (within GUARD_RADIUS of it), by kind. */
  private guardOf(slot: number, core: Building): { sentry: number; flak: number; laser: number } {
    const sim = this.sim;
    const c = sim.centreOf(core);
    const t = { sentry: 0, flak: 0, laser: 0 };
    for (const b of sim.buildings.values()) {
      if (b.dead || b.owner !== slot || (b.kind !== "sentry" && b.kind !== "flak" && b.kind !== "laser")) continue;
      const a = sim.centreOf(b);
      if (Math.hypot(a[0] - c[0], a[2] - c[2]) <= GUARD_RADIUS) t[b.kind]++;
    }
    return t;
  }

  /** Which way trouble comes to a Core from: toward the nearest other army's Core, else the middle of the map (a unit vector). */
  private danger(g: General, core: Building): [number, number] {
    const sim = this.sim;
    const c = sim.centreOf(core);
    let tx = 0, tz = 0, bestD = Infinity;
    for (const b of sim.buildings.values()) {
      if (b.dead || b.kind !== "core" || b.owner === g.slot) continue;
      const o = sim.centreOf(b), dd = Math.hypot(o[0] - c[0], o[2] - c[2]);
      if (dd < bestD) {
        bestD = dd;
        tx = o[0];
        tz = o[2];
      }
    }
    const dx = tx - c[0], dz = tz - c[2], d = Math.hypot(dx, dz);
    return d > 1 ? [dx / d, dz / d] : [0, 1];
  }

  /** A turret by a Core, on the side trouble comes from, spread across it and TURRET_GAP from its others. */
  private placeGuard(g: General, core: Building, kind: BuildingKind): boolean {
    const sim = this.sim;
    const c = sim.centreOf(core);
    const [ux, uz] = this.danger(g, core);
    const towards = Math.atan2(ux, uz);
    const others: [number, number][] = [];
    for (const b of sim.buildings.values()) {
      if (!b.dead && b.owner === g.slot && BUILDINGS[b.kind].nearCore) others.push([sim.centreOf(b)[0], sim.centreOf(b)[2]]);
    }
    for (const r of TURRET_RINGS) {
      for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.9, -1.9, 2.5, -2.5, Math.PI]) {
        const a = towards + off;
        const cx = Math.floor((c[0] + Math.sin(a) * r * CELL) / CELL), cz = Math.floor((c[2] + Math.cos(a) * r * CELL) / CELL);
        const x = mid(cx), z = mid(cz);
        if (others.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < TURRET_GAP)) continue;
        if (sim.cannotBuild(g.slot, kind, cx, cz) === "" && sim.orderBuilding(g.slot, kind, cx, cz) === "") return true;
      }
    }
    return false;
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

  /** The nearest vent without a Tap within 70 m of one of its Cores (cells), or null. */
  private freeVent(g: General, cores: Building[]): [number, number] | null {
    const sim = this.sim;
    let best: [number, number] | null = null, bestD = 70;
    for (const f of sim.fields) {
      if (f.kind !== "vent" || f.amount <= 0 || sim.cannotBuild(g.slot, "tap", f.cx, f.cz, true) !== "") continue;
      for (const core of cores) {
        const c = sim.centreOf(core);
        const dd = Math.hypot(mid(f.cx) - c[0], mid(f.cz) - c[2]);
        if (dd < bestD) {
          bestD = dd;
          best = [f.cx, f.cz];
        }
      }
    }
    return best;
  }

  /** A Tap on the nearest vent without one, near one of its Cores. */
  private placeTap(g: General, cores: Building[]): boolean {
    const at = this.freeVent(g, cores);
    return !!at && this.sim.orderBuilding(g.slot, "tap", at[0], at[1]) === "";
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
