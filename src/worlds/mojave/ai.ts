import { CELL } from "../../game/constants";
import { BUILDINGS, MAX_SUPPLY, NEWCOMER_PEACE, UNITS, type BuildingKind, type UnitKind } from "./kit";
import { mid, STARTS } from "./map";
import { NEUTRAL, T_BUILDING, type Building, type General, type Sim } from "./sim";

/**
 * A computer general: plays by the same rules as a person, through the same
 * orders (it has no body, so it is never thrown, and it builds no walls). It
 * mines, builds up, raises an army, and sends it at the nearest enemy when it
 * is big enough. Deliberately not clever: something to fight, and to learn
 * against.
 *
 * Every place no person commands is played by one: a place a person has just
 * left is taken up as it stands, whatever they had built, and a place a
 * person takes over simply stops being played here. So nothing is remembered
 * that cannot be made up afresh from what stands on the map.
 */

interface Mind {
  /** How big the army must be before the next attack (supply). */
  wave: number;
  /** When it last sent an attack. */
  sentAt: number;
}

export class Bots {
  private readonly minds = new Map<number, Mind>();

  constructor(private readonly sim: Sim) {}

  /** Called every couple of seconds: each computer general does the next sensible thing. */
  think(): void {
    for (const g of this.sim.generals) {
      if (g?.ai) this.run(g);
      // (A person commands here now: what the computer was in the middle of is forgotten.)
      else if (g) this.minds.delete(g.slot);
    }
  }

  private run(g: General): void {
    const sim = this.sim;
    const mind = this.minds.get(g.slot) ?? { wave: 14, sentAt: 0 };
    this.minds.set(g.slot, mind);
    const mine = [...sim.buildings.values()].filter((b) => b.owner === g.slot && !b.dead);
    const done = (kind: BuildingKind) => mine.filter((b) => b.kind === kind && b.doneAt === 0);
    const any = (kind: BuildingKind) => mine.filter((b) => b.kind === kind);
    const units = sim.units.filter((u) => u.owner === g.slot && !u.dead);
    const count = (kind: UnitKind) => units.filter((u) => u.kind === kind).length + mine.reduce((n, b) => n + b.queue.filter((q) => q.kind === kind).length, 0);
    const cores = done("core");
    const home = cores[0] ?? any("core")[0];

    // Routed: it begins again with a new Core as soon as that is free, back where it started (or on the nearest clear ground).
    if (!home) {
      if (sim.routedFree(g)) this.restart(g);
      return;
    }
    const used = sim.supplyUsed(g.slot), max = sim.supplyMax(g.slot);

    // Haulers first: money is everything.
    const wantHaulers = Math.min(18, 10 + cores.length * 4);
    for (const core of cores) if (core.queue.length < 2 && count("hauler") < wantHaulers && used < max) sim.make(g.slot, core.id, "hauler");
    // Idle Haulers go back to work.
    for (const u of units) if (u.kind === "hauler" && u.order.k === "stop") this.sendToCrystals(g, u.id, u.x, u.z);

    // Supply before it runs out.
    const printingRelay = any("relay").some((b) => b.doneAt !== 0);
    if (max < MAX_SUPPLY && used + 6 > max && !printingRelay && g.lithium >= BUILDINGS.relay.lithium) this.placeNear(g, "relay", home);

    // The build-up, in order: each once the last is under way and there is money for it.
    const plan: [BuildingKind, number][] = [["foundry", 1], ["tap", 1], ["sentry", 1], ["armory", 1], ["foundry", 2], ["skyport", 1], ["flak", 1], ["sentry", 2], ["titanbay", 1]];
    for (const [kind, n] of plan) {
      if (any(kind).length >= n) continue;
      const def = BUILDINGS[kind];
      if ((def.needs ?? []).some((need) => done(need).length === 0)) break;
      if (g.lithium >= def.lithium && g.plasma >= def.plasma) {
        if (kind === "tap") this.placeTap(g, home);
        else this.placeNear(g, kind, home);
      }
      break;
    }

    // The army: whatever the factories can make, the dearest it can afford first.
    const room = () => sim.supplyUsed(g.slot) < sim.supplyMax(g.slot) - 1;
    for (const b of done("foundry")) {
      if (b.queue.length >= 2 || !room()) continue;
      const picks: UnitKind[] = ["artillery", "tank", "missile", "scout", "trooper"];
      const wanted = picks.find((k) => {
        const def = UNITS[k];
        if ((def.needs ?? []).some((need) => done(need).length === 0)) return false;
        if (k === "artillery" && count("artillery") >= 4) return false;
        if (k === "missile" && count("missile") >= 3) return false;
        if (k === "scout" && count("scout") >= 2) return false;
        // Keep something back for buildings.
        return g.lithium >= def.lithium + 50 && g.plasma >= def.plasma;
      });
      if (wanted) sim.make(g.slot, b.id, wanted);
    }
    for (const b of done("skyport")) if (b.queue.length < 1 && room() && g.lithium >= 150 && g.plasma >= 75 && count("gunship") < 8) sim.make(g.slot, b.id, "gunship");
    for (const b of done("titanbay")) if (b.queue.length < 1 && room() && g.lithium >= 450 && g.plasma >= 300) sim.make(g.slot, b.id, "titan");
    for (const b of done("armory")) {
      if (b.research) continue;
      if (g.lithium > 400 && g.plasma > 200) sim.research(g.slot, b.id, g.upgrades.weapons <= g.upgrades.armour ? "weapons" : "armour");
    }

    // Fighting: defend when attacked near home, attack when the army is big enough.
    const army = units.filter((u) => UNITS[u.kind].weapon);
    const armySupply = army.reduce((n, u) => n + UNITS[u.kind].supply, 0);
    const c = sim.centreOf(home);
    const threat = this.enemyNear(g, c[0], c[2], 90);
    const idle = army.filter((u) => u.order.k === "stop");
    if (threat) {
      if (idle.length > 0) sim.command(g.slot, idle.map((u) => u.id), { k: "amove", x: threat[0], z: threat[1], l: 0 });
      return;
    }
    if (armySupply >= mind.wave && sim.t - mind.sentAt > 45) {
      const target = this.nearestEnemy(g, c[0], c[2]);
      if (target) {
        mind.sentAt = sim.t;
        mind.wave = Math.min(120, mind.wave + 10);
        sim.command(g.slot, army.map((u) => u.id), { k: "attack", tk: T_BUILDING, id: target.id });
        // Whatever the attack order leaves them doing once it is down: on to the next.
        return;
      }
    }
    // An attack whose target has gone: on to the next one, or home.
    if (sim.t - mind.sentAt < 400 && mind.sentAt > 0 && idle.length > army.length / 2 && idle.length >= 6) {
      const far = idle.filter((u) => Math.hypot(u.x - c[0], u.z - c[2]) > 120);
      const target = far.length > 0 ? this.nearestEnemy(g, far[0]!.x, far[0]!.z) : null;
      if (target && far.length >= 4) sim.command(g.slot, far.map((u) => u.id), { k: "attack", tk: T_BUILDING, id: target.id });
    }
    // New units gather in front of the base, toward the middle of the map.
    const rallyX = c[0] - Math.sign(c[0]) * 30 || 30, rallyZ = c[2] - Math.sign(c[2]) * 30 || 30;
    for (const b of mine) if (!b.rally && (b.kind === "foundry" || b.kind === "skyport" || b.kind === "titanbay")) sim.rally(g.slot, [b.id], rallyX, 0, rallyZ);
  }

  private sendToCrystals(g: General, id: number, x: number, z: number): void {
    let best = 0, bestD = 120 * 120;
    for (const f of this.sim.fields) {
      if (f.kind !== "crystal" || f.amount <= 0) continue;
      const d = (mid(f.cx) - x) ** 2 + (mid(f.cz) - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = f.id;
      }
    }
    if (best) this.sim.command(g.slot, [id], { k: "gather", field: best });
  }

  /** Where an enemy unit is within `range` of a spot, or null. */
  private enemyNear(g: General, x: number, z: number, range: number): [number, number] | null {
    for (const u of this.sim.units) {
      if (u.dead || u.owner === NEUTRAL || !this.sim.hostile(g.slot, u.owner)) continue;
      if ((u.x - x) ** 2 + (u.z - z) ** 2 < range * range) return [u.x, u.z];
    }
    return null;
  }

  /** The nearest building of an enemy general (a Core for choice). */
  private nearestEnemy(g: General, x: number, z: number): Building | null {
    let best: Building | null = null, bestD = Infinity;
    for (const b of this.sim.buildings.values()) {
      if (b.dead || !this.sim.hostile(g.slot, b.owner)) continue;
      // A person who has only just taken a place over is left alone for a while.
      const theirs = this.sim.generals[b.owner];
      if (theirs && !theirs.ai && this.sim.t - theirs.joinedAt < NEWCOMER_PEACE) continue;
      const c = this.sim.centreOf(b);
      const d = Math.hypot(c[0] - x, c[2] - z) - (b.kind === "core" ? 60 : 0);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** A new Core where this general first stood, or as near to it as there is clear ground. */
  private restart(g: General): boolean {
    const s = STARTS[g.start]!;
    for (let r = 0; r <= 16; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.place(g, "core", s.cx - 1 + dx, s.cz - 1 + dz)) return true;
        }
      }
    }
    return false;
  }

  private place(g: General, kind: BuildingKind, cx: number, cz: number): boolean {
    return this.sim.orderBuilding(g.slot, kind, cx, cz) === "";
  }

  /** Puts a building on the nearest clear ground to the Core, on the side toward the middle of the map, a cell clear of everything. */
  private placeNear(g: General, kind: BuildingKind, home: Building): boolean {
    const sim = this.sim;
    const size = BUILDINGS[kind].size;
    const c = sim.centreOf(home);
    const hx = Math.floor(c[0] / CELL), hz = Math.floor(c[2] / CELL);
    // Toward the middle: the crystals are on the other side.
    const inX = -Math.sign(hx) || 1, inZ = -Math.sign(hz) || 1;
    for (let r = 3; r <= 14; r++) {
      for (let a = 0; a <= r; a++) {
        for (const [dx, dz] of [[a, r], [r, a]] as const) {
          const cx = hx + inX * dx - (inX < 0 ? size - 1 : 0), cz = hz + inZ * dz - (inZ < 0 ? size - 1 : 0);
          // A cell of room all round, so units can pass between buildings.
          let clear = true;
          for (let x = cx - 1; x <= cx + size && clear; x++) for (let z = cz - 1; z <= cz + size && clear; z++) if (!sim.nav.clearGround(x, z)) clear = false;
          if (clear && sim.cannotBuild(g.slot, kind, cx, cz) === "" && this.place(g, kind, cx, cz)) return true;
        }
      }
    }
    return false;
  }

  /** A Tap on the nearest vent that has none. */
  private placeTap(g: General, home: Building): boolean {
    const c = this.sim.centreOf(home);
    const vents = this.sim.fields
      .filter((f) => f.kind === "vent" && this.sim.cannotBuild(g.slot, "tap", f.cx, f.cz) === "")
      .sort((a, b) => Math.hypot(mid(a.cx) - c[0], mid(a.cz) - c[2]) - Math.hypot(mid(b.cx) - c[0], mid(b.cz) - c[2]));
    const near = vents[0];
    return !!near && Math.hypot(mid(near.cx) - c[0], mid(near.cz) - c[2]) < 120 && this.place(g, "tap", near.cx, near.cz);
  }
}
