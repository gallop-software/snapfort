import type { Box } from "../../../game/keepOut";

/**
 * What Mars's page code shares about the air (see ../terraformerRules.ts): the
 * Terraformer's page half keeps it up to date every frame, and the scenery,
 * the sounds, the wings and the helicopters read it. One page shows one
 * world, so this is one value.
 */
export const sky = {
  /** How thick the air is now, 0..1. */
  air: 0,
  /** Where it is heading: 1 while a Terraformer runs, 0 when none does. */
  to: 0,
  /** Where the machine making it stands (the middle of its foot), or null when there is none. */
  source: null as { x: number; z: number } | null,
  /** The spaces filled by parts of the machine: solid to anything that flies. */
  solids: [] as Box[],
};
