import { LEVEL } from "../../game/constants";
/**
 * Mojave's kit: every unit and building a general can make, with its price,
 * strength and weapon. Plain data, shared by the server (which decides
 * everything) and the page (which shows it). Distances in metres, times in
 * seconds.
 *
 * The model is StarCraft's: two resources, supply, buildings that make units,
 * and units that are each strong against some things and weak against others.
 */

/** New kinds go on the end: the position in these lists is how they are sent. */
export const UNIT_KINDS = ["hauler", "trooper", "scout", "tank", "artillery", "missile", "gunship", "transport", "emp", "titan"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];
export const BUILDING_KINDS = ["core", "tap", "relay", "foundry", "armory", "skyport", "titanbay", "sentry", "flak", "laser"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export interface Weapon {
  range: number;
  /** Nearer than this it cannot fire (artillery). */
  minRange?: number;
  damage: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Everything this near the hit takes damage (falling off with distance), and is thrown. 0: one target, which only staggers. */
  splash: number;
  air: boolean;
  ground: boolean;
  /** Fired in a high arc: walls do not shelter from it, and it lands where it was aimed, a moment later. */
  lob?: boolean;
  /** Hits a built piece takes from one shot (a wall of lattice takes 2). */
  wear: number;
  /** How it is drawn: a line of light, a shell, or a missile. */
  look: "bullet" | "shell" | "missile" | "laser";
}

export interface UnitDef {
  label: string;
  /** The letter that orders one, with its building selected. */
  key: string;
  lithium: number;
  plasma: number;
  supply: number;
  hp: number;
  /** m/s. */
  speed: number;
  sight: number;
  /** Half its width, for crowding and for the crosshair. */
  radius: number;
  height: number;
  air?: boolean;
  /** Small enough to go through a door cut in a wall. */
  infantry?: boolean;
  weapon?: Weapon;
  /** Seconds to make. */
  time: number;
  madeAt: BuildingKind;
  /** Buildings the general must have (finished) before this can be ordered. */
  needs?: readonly BuildingKind[];
  /** Supply of ground units it can carry (the transport). */
  cargo?: number;
  /** Seconds to set up before firing, and to pack up before moving (the artillery). */
  deploy?: number;
  /** What it is for, in a few words. */
  blurb: string;
}

export const UNITS: Readonly<Record<UnitKind, UnitDef>> = {
  hauler: { label: "Hauler", key: "H", lithium: 50, plasma: 0, supply: 1, hp: 40, speed: 9, sight: 80, radius: 1.3, height: 1.8, time: 12, madeAt: "core", blurb: "Mines lithium and carries it to a Core" },
  trooper: {
    label: "Trooper", key: "T", lithium: 50, plasma: 0, supply: 1, hp: 45, speed: 7, sight: 90, radius: 0.6, height: 1.9, infantry: true, time: 14, madeAt: "foundry",
    weapon: { range: 28, damage: 6, cooldown: 0.8, splash: 0, air: true, ground: true, wear: 0.05, look: "bullet" },
    blurb: "Cheap infantry: goes through doors, shoots at anything",
  },
  scout: {
    label: "Scout buggy", key: "C", lithium: 75, plasma: 0, supply: 2, hp: 80, speed: 20, sight: 170, radius: 1.4, height: 1.3, time: 16, madeAt: "foundry",
    weapon: { range: 26, damage: 8, cooldown: 0.6, splash: 0, air: false, ground: true, wear: 0.04, look: "bullet" },
    blurb: "Fast, sees far: for exploring and for raiding Haulers",
  },
  tank: {
    label: "Tank", key: "K", lithium: 150, plasma: 50, supply: 3, hp: 180, speed: 10, sight: 100, radius: 2, height: 2.2, time: 26, madeAt: "foundry",
    weapon: { range: 36, damage: 30, cooldown: 2.2, splash: 2.5, air: false, ground: true, wear: 0.25, look: "shell" },
    blurb: "The front line: tough, and its shells break walls",
  },
  artillery: {
    label: "Rail artillery", key: "R", lithium: 150, plasma: 100, supply: 3, hp: 90, speed: 7, sight: 90, radius: 2, height: 2.4, time: 30, madeAt: "foundry", needs: ["armory"], deploy: 2,
    weapon: { range: 95, minRange: 22, damage: 60, cooldown: 5, splash: 5, air: false, ground: true, lob: true, wear: 1, look: "shell" },
    blurb: "Outranges everything, breaks forts; sets up to fire and is helpless up close",
  },
  missile: {
    label: "Missile truck", key: "M", lithium: 100, plasma: 50, supply: 2, hp: 90, speed: 11, sight: 110, radius: 1.8, height: 2.2, time: 22, madeAt: "foundry", needs: ["armory"],
    weapon: { range: 55, damage: 22, cooldown: 1.6, splash: 0, air: true, ground: false, wear: 0, look: "missile" },
    blurb: "Shoots down drones from far off; cannot hit the ground",
  },
  gunship: {
    label: "Gunship drone", key: "G", lithium: 100, plasma: 75, supply: 2, hp: 90, speed: 18, sight: 110, radius: 1.8, height: 1.2, air: true, time: 24, madeAt: "skyport",
    weapon: { range: 30, damage: 9, cooldown: 0.5, splash: 0, air: true, ground: true, wear: 0.04, look: "bullet" },
    blurb: "Flies over walls",
  },
  transport: {
    label: "Transport drone", key: "U", lithium: 100, plasma: 50, supply: 2, hp: 120, speed: 16, sight: 90, radius: 2.6, height: 2.4, air: true, cargo: 8, time: 24, madeAt: "skyport",
    blurb: "Carries ground units over walls and behind the lines",
  },
  emp: {
    label: "EMP drone", key: "E", lithium: 75, plasma: 100, supply: 2, hp: 60, speed: 16, sight: 100, radius: 1.4, height: 1.2, air: true, time: 26, madeAt: "skyport", needs: ["armory"],
    blurb: "Its pulse stops every enemy unit and turret near a spot for a few seconds",
  },
  titan: {
    label: "Titan walker", key: "I", lithium: 400, plasma: 300, supply: 8, hp: 900, speed: 6, sight: 110, radius: 3.2, height: 7, time: 60, madeAt: "titanbay",
    weapon: { range: 42, damage: 70, cooldown: 2.5, splash: 4, air: true, ground: true, wear: 0.5, look: "shell" },
    blurb: "The late game: slow, enormous, and very hard to stop",
  },
};

export interface BuildingDef {
  label: string;
  /** The letter that picks it in the build menu. */
  key: string;
  lithium: number;
  plasma: number;
  hp: number;
  /** Cells along each side of its square footprint. */
  size: number;
  /** Seconds to print itself. */
  time: number;
  sight: number;
  height: number;
  /** How far across it is drawn, m (inside its cells): what builders bump into and throws land on. */
  wide: number;
  needs?: readonly BuildingKind[];
  /** A turret: it goes up only within GUARD_RADIUS of a finished Command Core of its own army, and never that near another army's. */
  nearCore?: boolean;
  /** Supply it adds to its general's limit. */
  supply?: number;
  weapon?: Weapon;
  /** The second page of the build menu (the advanced ones). */
  advanced?: boolean;
  blurb: string;
}

export const BUILDINGS: Readonly<Record<BuildingKind, BuildingDef>> = {
  core: { label: "Command Core", key: "C", lithium: 400, plasma: 0, hp: 1500, size: 3, time: 60, sight: 140, height: 14, wide: 11.4, supply: 12, blurb: "Makes Haulers, takes their lithium. Lose every Core and you are routed" },
  tap: { label: "Tap", key: "T", lithium: 75, plasma: 0, hp: 400, size: 1, time: 20, sight: 60, height: 5, wide: 3.8, blurb: "On a plasma vent: draws plasma while the vent lasts" },
  relay: { label: "Relay mast", key: "R", lithium: 100, plasma: 0, hp: 300, size: 1, time: 15, sight: 90, height: 12, wide: 3.0, supply: 10, blurb: "Raises your army limit by 10" },
  foundry: { label: "Foundry", key: "F", lithium: 150, plasma: 0, hp: 800, size: 2, time: 30, sight: 90, height: 7, wide: 9.2, needs: ["core"], blurb: "Makes Troopers and vehicles" },
  armory: { label: "Armory", key: "M", lithium: 125, plasma: 50, hp: 600, size: 2, time: 30, sight: 80, height: 6, wide: 9.2, needs: ["foundry"], advanced: true, blurb: "Upgrades weapons and armour; unlocks artillery, missile trucks and the EMP" },
  skyport: { label: "Skyport", key: "K", lithium: 150, plasma: 100, hp: 700, size: 2, time: 35, sight: 100, height: 9, wide: 9.8, needs: ["foundry"], advanced: true, blurb: "Makes drones" },
  titanbay: { label: "Titan bay", key: "T", lithium: 250, plasma: 200, hp: 900, size: 3, time: 50, sight: 90, height: 12, wide: 14.2, needs: ["armory", "skyport"], advanced: true, blurb: "Makes the Titan walker" },
  sentry: {
    label: "Sentry turret", key: "E", lithium: 100, plasma: 0, hp: 350, size: 1, time: 18, sight: 90, height: 4, wide: 2.2, needs: ["foundry"], nearCore: true,
    weapon: { range: 36, damage: 10, cooldown: 0.6, splash: 0, air: false, ground: true, wear: 0, look: "bullet" },
    blurb: "Guards a spot against ground units; can go up on a floor",
  },
  flak: {
    label: "Flak turret", key: "L", lithium: 75, plasma: 25, hp: 300, size: 1, time: 18, sight: 100, height: 4, wide: 2.2, needs: ["foundry"], nearCore: true,
    weapon: { range: 48, damage: 16, cooldown: 0.7, splash: 0, air: true, ground: false, wear: 0, look: "bullet" },
    blurb: "Guards a spot against drones; can go up on a floor",
  },
  laser: { label: "Point-defence laser", key: "P", lithium: 100, plasma: 75, hp: 250, size: 1, time: 22, sight: 80, height: 6, wide: 2.2, needs: ["armory"], nearCore: true, advanced: true, blurb: "Shoots artillery shells out of the sky near it; can go up on a floor" },
};

/** What each building makes, in the order of its buttons. */
export const MAKES: Readonly<Record<BuildingKind, readonly UnitKind[]>> = (() => {
  const makes = Object.fromEntries(BUILDING_KINDS.map((b) => [b, [] as UnitKind[]])) as Record<BuildingKind, UnitKind[]>;
  for (const kind of UNIT_KINDS) makes[UNITS[kind].madeAt].push(kind);
  return makes;
})();

/** The Armory's upgrades: three levels each. Every level is a tenth more damage dealt, or a tenth less taken. */
export const UPGRADES = ["weapons", "armour"] as const;
export type UpgradeKind = (typeof UPGRADES)[number];
export const UPGRADE_KEYS: Readonly<Record<UpgradeKind, string>> = { weapons: "E", armour: "R" };
export const UPGRADE_LEVELS = 3;
/** Price and time of level 1, 2, 3 (lithium and plasma alike). */
export const UPGRADE_COST = [100, 175, 250] as const;
export const UPGRADE_TIME = [40, 60, 80] as const;
export const UPGRADE_STEP = 0.1;

/** The most supply a general can ever have, and the most units in the world (StarCraft's own ceilings). */
export const MAX_SUPPLY = 200;
export const MAX_UNITS = 1700;
/** Generals at once. */
export const MAX_GENERALS = 8;
/** What a new general has in the bank, and beside the Core. */
export const START_LITHIUM = 50;
export const START_HAULERS = 4;

/** Lithium a Hauler carries in one load, and the seconds it takes to dig it. */
export const LOAD = 8;
export const DIG_TIME = 2.5;
/** Plasma a Tap draws each second. */
export const TAP_RATE = 1.6;
/** Upkeep: with this much supply in use, income is multiplied by this. */
export function upkeep(supplyUsed: number): number {
  return supplyUsed > 150 ? 0.6 : supplyUsed > 100 ? 0.8 : 1;
}

/** What a built piece costs in lithium: there is one material here. */
export const PIECE_COST = 8;

/** How high drones fly, m. */
export const FLIGHT_HEIGHT = 14;
/** Turrets (sentry, flak, point-defence laser) go up only this close to a finished Core of their own army, m (centre to centre): an army guards its own base, nobody builds guns in someone else's (not within this of another army's Core either, so a Core dropped by someone's base does not let turrets in). */
export const GUARD_RADIUS = 75;

/**
 * How many times a weapon's `wear` counts on a wall (floors and ramps take it
 * as it is). 4 (2026-11-27, the user: "too hard to destroy walls, make it 4
 * times easier"): a wall goes down in a quarter of the shots it took before.
 */
export const WALL_WEAR = 4;
/** The EMP: how wide, how long it stops things, and how long until the drone can pulse again. */
export const EMP = { radius: 12, stun: 6, cooldown: 30, range: 40 } as const;
/** How far a general sees on foot; standing higher adds this much for every metre, up to three times as far. */
export const GENERAL_SIGHT = 120;
export const SIGHT_PER_METRE = 2.4;
/** Units and buildings on an upper storey see and shoot this much further. */
export const HIGH_GROUND = 1.3;
/** Units go after an enemy on their own within this share of their sight: they see further than they chase. */
export const CHASE_OF_SIGHT = 0.5;
/** With no page connected to the room at all for this long (and a little more), whoever the war still believes is serving an army is taken to have gone, seconds. */
export const LEAVE_GRACE = 60;
/** A routed general may drop a new Core, free, after this long. */
export const ROUTED_WAIT = 20;
/** A routed general's free Core comes with at least this much lithium: enough for the first Haulers. */
export const ROUTED_LITHIUM = 200;

/**
 * The space a building in cells (cx, cz) fills as it is drawn, m: [x0, y0,
 * z0, x1, y1, z1], in the middle of its cells, on storey `l` (a turret up on a floor). (The very top, a mast's tip or
 * a turret's barrel, is let through.)
 */
export function buildingBox(kind: BuildingKind, cx: number, cz: number, l = 0): [number, number, number, number, number, number] {
  const def = BUILDINGS[kind];
  const mx = (cx + def.size / 2) * 5, mz = (cz + def.size / 2) * 5, h = def.wide / 2, y = l * LEVEL;
  return [mx - h, y, mz - h, mx + h, y + def.height * 0.92, mz + h];
}
