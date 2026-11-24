import type { BuildState } from "../../game/buildState";
import { CELL } from "../../game/constants";
import { gridBox } from "../../game/pieces";
import { EDGE } from "./space";

/**
 * Moon rovers: what the Moon's page and server halves agree on. Six rovers
 * stand on pads near where builders arrive. Anyone may drive one (visitors
 * too). The driver's page works out how it moves against what is built, as it
 * does for the builder on foot; the server passes that on to everyone and
 * refuses anything impossible. Leave the ground fast (off a ramp) and with so
 * little pull the rover does not come back down: it floats away into space,
 * turning over slowly every which way, its driver still in the seat. About
 * five seconds later the seat throws them clear and their rocket pack sets
 * them gently down on the Moon; the empty rover drifts on and reappears on its
 * pad. Driving off the edge of the building area ends the same way.
 */

export const ROVER_COUNT = 6;

export const ROVER = {
  /** Its body for bumping into things: a ball this big, resting on the ground. */
  radius: 1,
  /** How near a builder must be to get on, m. */
  boardReach: 6,
  /** Top speed, m/s, cruising and flat out (the run key). Twice what they first were (user, 2026-11-23). */
  cruise: 36,
  sprint: 60,
  /** Leaving the ground rising faster than this, m/s, the rover does not come back down. */
  liftOff: 6,
  /** How fast it floats away once it has left the ground for good, m/s, and for how long before the seat throws its driver clear, s (user, 2026-11-23: "after about 5 seconds"). */
  floatSpeed: 13,
  floatFor: 5,
  /** Past this far from the middle, the same: the edge of the Moon as far as building goes, m. */
  edge: EDGE + 8,
  /** An empty rover drifts this long before it is back on its pad, ms. */
  lostFor: 5000,
  /** A rover left somewhere with nobody on it goes home after this long, ms. */
  idleFor: 180_000,
  /** Faster than this between two reports, m/s, and the server does not believe it. */
  believable: 170,
  /** The driver's seat: its surface is this far above the ground under the rover, and this far behind its middle. */
  seatUp: 1.02,
  seatBack: 0.5,
  /** The rover turns over about a point this far above the ground under it (its middle), when it floats. */
  middleUp: 0.75,
} as const;

/** Where a rover is: x, y, z of the point under its middle (on the ground, when it is), which way it points (radians about the vertical), how far its nose is up, and how far it is rolled over. */
export type RoverPose = [number, number, number, number, number, number];

/** A rover as the server sends it: id, where, who is driving (or null). */
export type WireRover = [number, RoverPose, string | null];

/** From the server's half to the page's. */
export type ToPage =
  /** Every rover, on joining. */
  | { k: "all"; list: WireRover[] }
  /** Rovers that moved. */
  | { k: "poses"; list: [number, RoverPose][] }
  /** Who drives rover `id` now (null: nobody), and where it stands. */
  | { k: "rider"; id: number; by: string | null; pose: RoverPose }
  /** Rover `id` is drifting off into space from `pose`, moving at `v` m/s. */
  | { k: "lost"; id: number; pose: RoverPose; v: [number, number, number] }
  /** Getting on was refused. */
  | { k: "no"; why: "taken" | "far" };

/** From the page's half to the server's. */
export type ToServer =
  | { k: "board"; id: number }
  /** Got off, leaving it at `pose`. */
  | { k: "leave"; pose: RoverPose }
  /** Where the rover this builder drives is now. */
  | { k: "drive"; pose: RoverPose }
  /** Left the Moon (too high, or over the edge) at `pose`, moving at `v`: thrown clear. */
  | { k: "eject"; pose: RoverPose; v: [number, number, number] };

/** Builders arrive about here (the same spot as everywhere). */
const ARRIVAL: readonly [number, number] = [CELL / 2, -CELL * 1.5];
/** The pads are a ring this far out from it, m. */
const PAD_RING = 22;

/** True when nothing is built at ground level in cell (cx, cz), so a rover can stand there. */
function open(build: BuildState, cx: number, cz: number): boolean {
  for (const p of build.near((cx + 0.5) * CELL, 1, (cz + 0.5) * CELL)) {
    const b = gridBox(p);
    if (b[1] <= 1 && b[0] <= cx + 1 && b[3] >= cx && b[2] <= cz + 1 && b[5] >= cz) return false;
  }
  return true;
}

/**
 * Where each rover stands when it is at home: on its pad, or the nearest open
 * cell to it when someone has built there, no two in the same cell. Each
 * points away from where builders arrive.
 */
export function homes(build: BuildState): RoverPose[] {
  const taken = new Set<string>();
  const list: RoverPose[] = [];
  for (let i = 0; i < ROVER_COUNT; i++) {
    const a = ((i + 0.5) / ROVER_COUNT) * Math.PI * 2;
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
export function readPose(v: unknown): RoverPose | null {
  if (!Array.isArray(v) || v.length !== 6 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [x, y, z, yaw, pitch, roll] = v as number[];
  if (Math.abs(x!) > 700 || Math.abs(z!) > 700 || y! < -60 || y! > 800) return null;
  const r = (n: number) => Math.round(n * 100) / 100;
  /** An angle as sent: between minus and plus half a turn, to a thousandth. */
  const turn = (a: number) => Math.round(Math.atan2(Math.sin(a), Math.cos(a)) * 1000) / 1000;
  return [r(x!), r(y!), r(z!), turn(yaw!), turn(pitch!), turn(roll!)];
}

export function readVec(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 200)) return null;
  return [v[0] as number, v[1] as number, v[2] as number];
}
