import { CELL } from "../../game/constants";
import { HALF_CELLS } from "./world";

/**
 * Mojave's map: fixed, the same on every visit, as StarCraft's maps were.
 * Eight starting locations round the edge (four corners, four sides), each
 * with a crystal field and a plasma vent; a second field a little way toward
 * the middle from each (the natural expansion); and richer fields in the
 * middle, where everyone's armies meet. The ground is flat: chokepoints and
 * high ground are what generals build.
 *
 * Positions are whole cells (5 m), the same grid everything is built on.
 */

export interface Field {
  id: number;
  kind: "crystal" | "vent";
  /** The one cell it fills. */
  cx: number;
  cz: number;
  /** What is left in it, and what it holds when full. */
  amount: number;
  full: number;
  /** Which group of fields it belongs to (a Hauler whose patch is busy goes to another of the same site). */
  site: number;
  /** When it fills again after running dry (ms), or 0. */
  refillAt: number;
}

export interface Start {
  /** The cell at the middle of the Command Core's 3 by 3 footprint. */
  cx: number;
  cz: number;
  /** Where the general stands on arriving, m. */
  spawn: readonly [number, number];
}

const CORNER = 72, SIDE = 80;
const START_CELLS: readonly (readonly [number, number])[] = [
  [-CORNER, -CORNER], [0, -SIDE], [CORNER, -CORNER], [SIDE, 0],
  [CORNER, CORNER], [0, SIDE], [-CORNER, CORNER], [-SIDE, 0],
];

/** How much a crystal patch and a vent hold at a start, at a natural expansion, and in the middle. */
const MAIN = { crystal: 1500, vent: 5000 }, NATURAL = { crystal: 1200, vent: 4000 }, RICH = { crystal: 2500, vent: 8000 };
/** A field that runs dry fills again after this long, ms. */
export const REFILL_MS = 5 * 60_000;

export const STARTS: readonly Start[] = START_CELLS.map(([cx, cz]) => {
  const d = Math.hypot(cx, cz);
  // The general arrives a few cells from the Core, on the side toward the middle of the map.
  return { cx, cz, spawn: [(cx - (cx / d) * 4 + 0.5) * CELL, (cz - (cz / d) * 4 + 0.5) * CELL] as const };
});

/** The fields of the whole map, full. (A fresh list each time: the caller keeps what is left in them.) */
export function makeFields(): Field[] {
  const fields: Field[] = [];
  const taken = new Set<string>();
  let site = 0;
  const add = (kind: Field["kind"], x: number, z: number, amount: number, s: number) => {
    let cx = Math.round(x), cz = Math.round(z);
    // Two patches rounding to one cell: the second moves along.
    for (let n = 0; taken.has(`${cx},${cz}`) && n < 8; n++) cx += 1;
    taken.add(`${cx},${cz}`);
    fields.push({ id: fields.length + 1, kind, cx, cz, amount, full: amount, site: s, refillAt: 0 });
  };
  /** An arc of crystal patches round (x, z), opening toward (ox, oz), and a vent to one side. */
  const cluster = (x: number, z: number, outX: number, outZ: number, patches: number, radius: number, hold: { crystal: number; vent: number }, ventAt: number) => {
    const s = site++;
    const out = Math.atan2(outX, outZ);
    for (let i = 0; i < patches; i++) {
      const a = out + ((i - (patches - 1) / 2) * (Math.PI * 0.62)) / Math.max(1, patches - 1);
      add("crystal", x + Math.sin(a) * radius, z + Math.cos(a) * radius, hold.crystal, s);
    }
    add("vent", x + Math.sin(out + Math.PI / 2) * ventAt, z + Math.cos(out + Math.PI / 2) * ventAt, hold.vent, s);
  };
  for (const [cx, cz] of START_CELLS) {
    const d = Math.hypot(cx, cz), ox = cx / d, oz = cz / d;
    // The main field, on the side away from the middle; the natural, a walk toward the middle.
    cluster(cx, cz, ox, oz, 8, 7, MAIN, 7);
    cluster(cx - ox * 24, cz - oz * 24, ox, oz, 6, 5, NATURAL, 5);
  }
  // The middle: four rich fields and one richer still at the very centre.
  for (const [x, z] of [[30, 0], [-30, 0], [0, 30], [0, -30]] as const) cluster(x, z, x, z, 8, 5, RICH, 5);
  cluster(0, 0, 0, 1, 8, 5, RICH, 6);
  return fields.filter((f) => Math.abs(f.cx) < HALF_CELLS - 1 && Math.abs(f.cz) < HALF_CELLS - 1);
}

/** The sites in the middle that neutral sentries guard: where each sentry stands, m. */
export function sentryPosts(): [number, number][] {
  const posts: [number, number][] = [];
  const ring = (x: number, z: number, n: number, r: number) => {
    for (let i = 0; i < n; i++) posts.push([(x + Math.sin((i / n) * Math.PI * 2) * r + 0.5) * CELL, (z + Math.cos((i / n) * Math.PI * 2) * r + 0.5) * CELL]);
  };
  for (const [x, z] of [[30, 0], [-30, 0], [0, 30], [0, -30]] as const) ring(x, z, 14, 8.5);
  ring(0, 0, 24, 9.5);
  return posts;
}

/** The middle of a cell, m. */
export const mid = (c: number) => (c + 0.5) * CELL;
/** The cell a spot is in. */
export const cellOf = (m: number) => Math.floor(m / CELL);
