import { SIGHT_GRID, sightIndex, stamp } from "../sim";

/**
 * What this general sees now. Mojave is never dark: the land always shows.
 * But an enemy is only known of while this general's own units, buildings or
 * self have it in sight (the server sends nothing else), so the page keeps
 * the same grid the server does: to tell what is live from what is only
 * remembered, and to know when a spot has been looked at again.
 */
export class Sight {
  /** In sight now: 1 for each sight cell. */
  readonly visible = new Uint8Array(SIGHT_GRID * SIGHT_GRID);

  /** Whether a spot is in this general's sight now. */
  sees(x: number, z: number): boolean {
    return this.visible[sightIndex(x, z)] === 1;
  }

  /** What is seen now: each source is a spot and how far it sees from there. */
  look(sources: readonly (readonly [number, number, number])[]): void {
    this.visible.fill(0);
    for (const [x, z, range] of sources) stamp(this.visible, x, z, range);
  }

  clear(): void {
    this.visible.fill(0);
  }
}
