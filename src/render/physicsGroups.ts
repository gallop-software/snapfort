/**
 * Physics collision groups. The character controller puts the builder's own
 * capsule into the physics world, so camera and crosshair lines must skip it or
 * they hit the builder (the camera then zooms into the back of his head).
 */
export const BUILDER_GROUP = 2;
/** A trebuchet's frame: crosshair lines hit it (to remove it, say), builders walk through it. */
export const FRAME_GROUP = 8;
/** Falling rubble: collides with the world and other rubble, never with builders or camera lines. */
export const DEBRIS_GROUP = 4;

/** Raycast filter: everything except the builder. */
export const IGNORE_BUILDER = { collideWith: ~(BUILDER_GROUP | DEBRIS_GROUP) };

/** Camera lines: like IGNORE_BUILDER, and through trebuchet frames too (they are mostly open). */
export const CAMERA_LINES = { collideWith: ~(BUILDER_GROUP | DEBRIS_GROUP | FRAME_GROUP) };
