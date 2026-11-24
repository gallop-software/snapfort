import { PIECE_DEFS, type MaterialId, type PieceType } from "./pieces";

/**
 * What a world is, as far as the shared rules are concerned. Every world has
 * the same building blocks and the same building rules; what it sets is how
 * things move, what its three materials and its siege engine are called and
 * how strong they are, and what its roofs look like. The worlds themselves
 * live in src/worlds/, one folder each; this file names none of them.
 *
 * Rules that depend on the world take it as an argument rather than reading a
 * "current" one: on the server, two worlds can run in the same process.
 */

/** One of a world's three materials. The slots are fixed (how builds are saved); what fills them is the world's. */
export interface MaterialRules {
  label: string;
  /** Base colour, RGB 0..1. */
  color: readonly [number, number, number];
  /** The highest storey (y, counting the ground storey as 0) it can be built on; Infinity for any. */
  maxLevel: number;
  /** Hits a piece of it takes before it breaks. */
  hits: number;
}

/** A world's siege engine (the trebuchet slot). Distances in metres, times in seconds. */
export interface SiegeRules {
  name: string;
  /** Nearer than this cannot be targeted, so nobody batters their own tower from inside. 0: no minimum. */
  minRange: number;
  /** Range from the ground... */
  baseRange: number;
  /** ...plus this many metres for every metre the engine stands higher. */
  rangePerMetre: number;
  /** Seconds between shots. */
  reload: number;
  /** Where the stone leaves, above the engine's base (also how tall the engine is to a stone). */
  launchHeight: number;
  /** Radius of the stone, for what it touches on the way. */
  stoneRadius: number;
  /** Pieces this close to the impact take a hit. */
  blastRadius: number;
  /** Builders this close to an impact are thrown. */
  throwRadius: number;
  /** How hard a builder right at the impact is thrown: sideways and upward speed, m/s. */
  throwOut: number;
  throwUp: number;
  /** How near a builder must be to get on, from the engine's centre. */
  boardReach: number;
  /** Hits the engine itself takes before it breaks. */
  hits: number;
  /**
   * Every shot takes this many seconds, however far: a fast, nearly straight
   * shot that hits the first thing in its line. Left out, shots are thrown in
   * a high arc, as a trebuchet's are.
   */
  shotSeconds?: number;
}

/** The shapes a roof can have: all on the same square base, so they attach, stand and fall alike. New ones go on the end. */
export const ROOF_SHAPES = ["pyramid", "dome"] as const;
export type RoofShape = (typeof ROOF_SHAPES)[number];

export interface Environment {
  /** Also the name of its folder in src/worlds/. */
  id: string;
  name: string;
  /** Its address on the site: "/" or "/<something>". */
  path: string;
  /** The name its shared world is saved under. Never change it: the builds are kept by this name. */
  room: string;
  /** Needs the Full Game to build in (anyone may visit). */
  paid: boolean;
  /** Its card on the menu, and what unlocking it promises. */
  card: { blurb: string; picture: string; perks: readonly string[] };

  /** Pull on builders, in m/s² (also their falls and throws). */
  gravity: number;
  /** How high a jump lifts the feet, m. */
  jumpHeight: number;
  /** Pull on stones, m/s². */
  stoneGravity: number;
  /** The shortest flights (the nearest shots) take this much longer than 1.5 s. */
  flightTime: number;
  /** Siege engines reach this much further. */
  range: number;
  /** Builders hit by a stone are thrown this much harder. */
  throwPower: number;
  /** A fall shorter than this does not knock a builder down, m. */
  knockdownDrop: number;
  /** Pull on rubble, m/s². */
  rubbleGravity: number;

  materials: Readonly<Record<MaterialId, MaterialRules>>;
  siege: SiegeRules;
  roof: RoofShape;
  /** Its own names for pieces ("Dome" for the roof), where they differ. */
  labels: Readonly<Partial<Record<PieceType, string>>>;
}

/** What a piece is called in a world. */
export function pieceLabel(type: PieceType, env: Environment): string {
  return type === "trebuchet" ? env.siege.name : (env.labels[type] ?? PIECE_DEFS[type].label);
}
