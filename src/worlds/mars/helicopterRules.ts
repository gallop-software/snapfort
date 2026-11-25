import type { BuildState } from "../../game/buildState";
import { CELL } from "../../game/constants";
import { gridBox } from "../../game/pieces";

/**
 * Mars helicopters: what the page and server halves agree on. Three stand on
 * pads near where builders arrive. Anyone may fly one (visitors too), with one
 * passenger beside them.
 *
 * The science: a helicopter has flown on Mars (Ingenuity, 72 flights), but in
 * air under a hundredth as thick as the Earth's the rotors must be enormous
 * and spin fast to lift anything, and the battery does not last. So these are
 * a small cabin under two very long, slender rotors turning opposite ways, and
 * on red Mars they manage short, low hops and must set down to recharge. As a
 * Terraformer thickens the air the same machine flies longer, faster and far
 * higher.
 *
 * The pilot's page flies it against what is built, as it moves the builder on
 * foot; the server passes that on to everyone and refuses anything impossible.
 * Copied in pattern from the Moon's rovers.
 */

export const HELI_COUNT = 3;

export const HELI = {
  /** How near a builder must be to get in, m. */
  boardReach: 6,
  /** A shot hits it when it comes this near its middle, m. */
  hitSize: 2,
  /** Hit by a shot landing within this far, m, it is thrown this high and this far, taking this long to come down, s. */
  tossWithin: 7,
  tossUp: 14,
  tossOut: 22,
  tossFor: 5,
  /** Left in the air with nobody at the controls, it comes down about this fast, m/s. */
  sinkSpeed: 8,
  /** Left somewhere with nobody in it, it goes home after this long, ms. */
  idleFor: 180_000,
  /** Faster than this between two reports, m/s, and the server does not believe it. */
  believable: 110,
  /** Seconds to recharge from flat, standing on the ground. */
  recharge: 25,
  /** With the battery flat it comes down this fast, m/s (the rotors still turning in the air going by). */
  flatSink: 7,
  /** How fast it goes down on purpose, m/s. */
  descend: 9,
  /** Its body for bumping into things: this far across, m. (The rotors are far wider; they are let through.) */
  radius: 1.6,
  /** Its middle is this far above its skids. */
  middleUp: 1.2,
  /** Across the rotors, m. */
  rotor: 14,
} as const;

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));

/** Top speed in air this thick (0..1), m/s. */
export const speedIn = (air: number) => lerp(15, 34, air);
/** How fast it climbs, m/s. */
export const climbIn = (air: number) => lerp(4, 10, air);
/** How high above the ground it can fly, m: a hop over a wall on red Mars, over anything built in thick air. */
export const ceilingIn = (air: number) => lerp(40, 330, air);
/** Seconds of flight from a full battery. */
export const enduranceIn = (air: number) => lerp(40, 180, air);

/** Where a helicopter is: x, y, z of the point under its middle (the bottom of its skids), which way it points (radians about the vertical), how far its nose is down, and how far it is rolled. */
export type HeliPose = [number, number, number, number, number, number];

/** As the server sends one: id, where, who is in it (pilot, then passenger), and how full its battery is (0..1). */
export type WireHeli = [number, HeliPose, [string | null, string | null], number];

/** Where someone in seat `i` (0 the pilot, on the left; 1 the passenger) sits, and how they are turned. */
export function seatOf(pose: HeliPose, i: number): { x: number; y: number; z: number; yaw: number; pitch: number; roll: number } {
  const side = i === 0 ? -0.5 : 0.5, ahead = 0.55;
  const s = Math.sin(pose[3]), c = Math.cos(pose[3]);
  return { x: pose[0] + c * side + s * ahead, y: pose[1] + 0.85, z: pose[2] - s * side + c * ahead, yaw: pose[3], pitch: pose[4], roll: pose[5] };
}

/** From the server's half to the page's. */
export type HeliToPage =
  /** Every helicopter, on joining. */
  | { k: "heli-all"; list: WireHeli[] }
  /** Helicopters that moved. */
  | { k: "heli-poses"; list: [number, HeliPose][] }
  /** Who is in helicopter `id` now, where it stands, and its battery. */
  | { k: "heli-riders"; id: number; riders: [string | null, string | null]; pose: HeliPose; charge: number }
  /** Helicopter `id`, empty, comes down from `from` to rest at `to` over `seconds`, rising `arc` metres on the way when a shot threw it. */
  | { k: "heli-fall"; id: number; from: HeliPose; to: HeliPose; seconds: number; arc: number }
  /** Getting in was refused. */
  | { k: "heli-no"; why: "full" | "far" };

/** From the page's half to the server's. */
export type HeliToServer =
  | { k: "heli-board"; id: number }
  /** Got out, leaving it at `pose` with this much battery. */
  | { k: "heli-leave"; pose: HeliPose; charge: number }
  /** Where the helicopter this builder flies is now, and its battery. */
  | { k: "heli-fly"; pose: HeliPose; charge: number };

/** Builders arrive about here (the same spot as everywhere). */
const ARRIVAL: readonly [number, number] = [CELL / 2, -CELL * 1.5];
/** The pads are a ring this far out from it, m: room for the rotors. */
const PAD_RING = 36;

/** True when nothing is built at ground level in cell (cx, cz). */
function open(build: BuildState, cx: number, cz: number): boolean {
  for (const p of build.near((cx + 0.5) * CELL, 1, (cz + 0.5) * CELL)) {
    const b = gridBox(p);
    if (b[1] <= 1 && b[0] <= cx + 1 && b[3] >= cx && b[2] <= cz + 1 && b[5] >= cz) return false;
  }
  return true;
}

/** Where each stands when it is at home: on its pad, or the nearest open cell to it when someone has built there. */
export function homes(build: BuildState): HeliPose[] {
  const taken = new Set<string>();
  const list: HeliPose[] = [];
  for (let i = 0; i < HELI_COUNT; i++) {
    const a = ((i + 0.25) / HELI_COUNT) * Math.PI * 2;
    const px = Math.floor((ARRIVAL[0] + Math.sin(a) * PAD_RING) / CELL), pz = Math.floor((ARRIVAL[1] + Math.cos(a) * PAD_RING) / CELL);
    let cell: [number, number] = [px, pz];
    search: for (let r = 0; r <= 14; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (taken.has(`${px + dx},${pz + dz}`) || !open(build, px + dx, pz + dz)) continue;
          cell = [px + dx, pz + dz];
          break search;
        }
      }
    }
    taken.add(`${cell[0]},${cell[1]}`);
    list.push([(cell[0] + 0.5) * CELL, 0, (cell[1] + 0.5) * CELL, Math.round(a * 1000) / 1000, 0, 0]);
  }
  return list;
}

/** A pose from a message, or null when it is not one (or is far outside the world). */
export function readPose(v: unknown): HeliPose | null {
  if (!Array.isArray(v) || v.length !== 6 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [x, y, z, yaw, pitch, roll] = v as number[];
  if (Math.abs(x!) > 300 || Math.abs(z!) > 300 || y! < -5 || y! > 700) return null;
  const r = (n: number) => Math.round(n * 100) / 100;
  const turn = (a: number) => Math.round(Math.atan2(Math.sin(a), Math.cos(a)) * 1000) / 1000;
  return [r(x!), r(y!), r(z!), turn(yaw!), turn(pitch!), turn(roll!)];
}

/** A battery level from a message: 0..1, or `otherwise`. */
export function readCharge(v: unknown, otherwise: number): number {
  return typeof v === "number" && v >= 0 && v <= 1 ? Math.round(v * 1000) / 1000 : otherwise;
}
