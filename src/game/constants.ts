/** Shared grid. Everything in the game snaps to it. Units are metres. */

/** Width and depth of one grid cell: big, so a few pieces make a room. */
export const CELL = 5;
/** Height of one storey. CELL : LEVEL is 4 : 3, so ramps climb at about 37 degrees. */
export const LEVEL = 3.75;
/** Thickness of walls, floors and ramps. */
export const THICK = 0.3;

/** Buildable area: cells from -WORLD_HALF_CELLS to WORLD_HALF_CELLS - 1 on x and z. */
export const WORLD_HALF_CELLS = 48;
/** Highest storey a piece can sit on: storeys 0 to 80, so the tallest towers top out at about 304 m. */
export const MAX_LEVEL = 80;
