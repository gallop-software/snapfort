/**
 * Physics collision groups. The character controller puts the builder's own
 * capsule into the physics world, so camera and crosshair lines must skip it or
 * they hit the builder (the camera then zooms into the back of his head).
 */
export const BUILDER_GROUP = 2;
/** Falling rubble: collides with the world and other rubble, never with builders or camera lines. */
export const DEBRIS_GROUP = 4;

/** Raycast filter: everything except the builder. */
export const IGNORE_BUILDER = { collideWith: ~(BUILDER_GROUP | DEBRIS_GROUP) };
