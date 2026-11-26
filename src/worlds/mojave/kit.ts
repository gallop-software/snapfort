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
  hauler: { label: "Hauler", key: "H", lithium: 50, plasma: 0, supply: 1, hp: 40, speed: 9, sight: 40, radius: 1.3, height: 1.8, time: 12, madeAt: "core", blurb: "Mines lithium and carries it to a Core" },
  trooper: {
    label: "Trooper", key: "T", lithium: 50, plasma: 0, supply: 1, hp: 45, speed: 7, sight: 45, radius: 0.6, height: 1.9, infantry: true, time: 14, madeAt: "foundry",
    weapon: { range: 28, damage: 6, cooldown: 0.8, splash: 0, air: true, ground: true, wear: 0.05, look: "bullet" },
    blurb: "Cheap infantry: goes through doors, shoots at anything",
  },
  scout: {
    label: "Scout buggy", key: "C", lithium: 75, plasma: 0, supply: 2, hp: 80, speed: 20, sight: 85, radius: 1.4, height: 1.3, time: 16, madeAt: "foundry",
    weapon: { range: 26, damage: 8, cooldown: 0.6, splash: 0, air: false, ground: true, wear: 0.04, look: "bullet" },
    blurb: "Fast, sees far: for exploring and for raiding Haulers",
  },
  tank: {
    label: "Tank", key: "K", lithium: 150, plasma: 50, supply: 3, hp: 180, speed: 10, sight: 50, radius: 2, height: 2.2, time: 26, madeAt: "foundry",
    weapon: { range: 36, damage: 30, cooldown: 2.2, splash: 2.5, air: false, ground: true, wear: 0.25, look: "shell" },
    blurb: "The front line: tough, and its shells break walls",
  },
  artillery: {
    label: "Rail artillery", key: "R", lithium: 150, plasma: 100, supply: 3, hp: 90, speed: 7, sight: 45, radius: 2, height: 2.4, time: 30, madeAt: "foundry", needs: ["armory"], deploy: 2,
    weapon: { range: 95, minRange: 22, damage: 60, cooldown: 5, splash: 5, air: false, ground: true, lob: true, wear: 1, look: "shell" },
    blurb: "Outranges everything, breaks forts; sets up to fire and is helpless up close",
  },
  missile: {
    label: "Missile truck", key: "M", lithium: 100, plasma: 50, supply: 2, hp: 90, speed: 11, sight: 55, radius: 1.8, height: 2.2, time: 22, madeAt: "foundry", needs: ["armory"],
    weapon: { range: 55, damage: 22, cooldown: 1.6, splash: 0, air: true, ground: false, wear: 0, look: "missile" },
    blurb: "Shoots down drones from far off; cannot hit the ground",
  },
  gunship: {
    label: "Gunship drone", key: "G", lithium: 100, plasma: 75, supply: 2, hp: 90, speed: 18, sight: 55, radius: 1.8, height: 1.2, air: true, time: 24, madeAt: "skyport",
    weapon: { range: 30, damage: 9, cooldown: 0.5, splash: 0, air: true, ground: true, wear: 0.04, look: "bullet" },
    blurb: "Flies over walls",
  },
  transport: {
    label: "Transport drone", key: "T", lithium: 100, plasma: 50, supply: 2, hp: 120, speed: 16, sight: 45, radius: 2.6, height: 2.4, air: true, cargo: 8, time: 24, madeAt: "skyport",
    blurb: "Carries ground units over walls and behind the lines",
  },
  emp: {
    label: "EMP drone", key: "E", lithium: 75, plasma: 100, supply: 2, hp: 60, speed: 16, sight: 50, radius: 1.4, height: 1.2, air: true, time: 26, madeAt: "skyport", needs: ["armory"],
    blurb: "Its pulse stops every enemy unit and turret near a spot for a few seconds",
  },
  titan: {
    label: "Titan walker", key: "T", lithium: 400, plasma: 300, supply: 8, hp: 900, speed: 6, sight: 55, radius: 3.2, height: 7, time: 60, madeAt: "titanbay",
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
  needs?: readonly BuildingKind[];
  /** Supply it adds to its general's limit. */
  supply?: number;
  weapon?: Weapon;
  /** The second page of the build menu (the advanced ones). */
  advanced?: boolean;
  blurb: string;
}

export const BUILDINGS: Readonly<Record<BuildingKind, BuildingDef>> = {
  core: { label: "Command Core", key: "C", lithium: 400, plasma: 0, hp: 1500, size: 3, time: 60, sight: 70, height: 14, supply: 12, blurb: "Makes Haulers, takes their lithium. Lose every Core and you are routed" },
  tap: { label: "Tap", key: "T", lithium: 75, plasma: 0, hp: 400, size: 1, time: 20, sight: 30, height: 5, blurb: "On a plasma vent: draws plasma while the vent lasts" },
  relay: { label: "Relay mast", key: "R", lithium: 100, plasma: 0, hp: 300, size: 1, time: 15, sight: 45, height: 12, supply: 10, blurb: "Raises your army limit by 10" },
  foundry: { label: "Foundry", key: "F", lithium: 150, plasma: 0, hp: 800, size: 2, time: 30, sight: 45, height: 7, needs: ["core"], blurb: "Makes Troopers and vehicles" },
  armory: { label: "Armory", key: "M", lithium: 125, plasma: 50, hp: 600, size: 2, time: 30, sight: 40, height: 6, needs: ["foundry"], advanced: true, blurb: "Upgrades weapons and armour; unlocks artillery, missile trucks and the EMP" },
  skyport: { label: "Skyport", key: "K", lithium: 150, plasma: 100, hp: 700, size: 2, time: 35, sight: 50, height: 9, needs: ["foundry"], advanced: true, blurb: "Makes drones" },
  titanbay: { label: "Titan bay", key: "B", lithium: 250, plasma: 200, hp: 900, size: 3, time: 50, sight: 45, height: 12, needs: ["armory", "skyport"], advanced: true, blurb: "Makes the Titan walker" },
  sentry: {
    label: "Sentry turret", key: "E", lithium: 100, plasma: 0, hp: 350, size: 1, time: 18, sight: 45, height: 4, needs: ["foundry"],
    weapon: { range: 36, damage: 10, cooldown: 0.6, splash: 0, air: false, ground: true, wear: 0, look: "bullet" },
    blurb: "Guards a spot against ground units",
  },
  flak: {
    label: "Flak turret", key: "L", lithium: 75, plasma: 25, hp: 300, size: 1, time: 18, sight: 50, height: 4, needs: ["foundry"],
    weapon: { range: 48, damage: 16, cooldown: 0.7, splash: 0, air: true, ground: false, wear: 0, look: "bullet" },
    blurb: "Guards a spot against drones",
  },
  laser: { label: "Point-defence laser", key: "P", lithium: 100, plasma: 75, hp: 250, size: 1, time: 22, sight: 40, height: 6, needs: ["armory"], advanced: true, blurb: "Shoots artillery shells out of the sky near it" },
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
/** The EMP: how wide, how long it stops things, and how long until the drone can pulse again. */
export const EMP = { radius: 12, stun: 6, cooldown: 30, range: 40 } as const;
/** A general thrown by a hit cannot be thrown again for this long after getting up. */
export const GENERAL_IMMUNE = 5;
/** How far a general sees on foot; standing higher adds this much for every metre, up to three times as far. */
export const GENERAL_SIGHT = 60;
export const SIGHT_PER_METRE = 1.2;
/** Units and buildings on an upper storey see and shoot this much further. */
export const HIGH_GROUND = 1.3;
/** A place is kept for the person who left it for this long (a dropped connection may come back before then), seconds: a computer plays it meanwhile, and after that anyone may be given it. */
export const LEAVE_GRACE = 60;
/** A routed general may drop a new Core, free, after this long. */
export const ROUTED_WAIT = 20;
/** A routed general's free Core comes with at least this much lithium: enough for the first Haulers. */
export const ROUTED_LITHIUM = 200;
/** Computer generals leave a person who has just taken a place over alone for this long, seconds. */
export const NEWCOMER_PEACE = 240;
