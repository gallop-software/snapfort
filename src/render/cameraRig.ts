import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import type { Scene } from "@babylonjs/core/scene";
import { CAMERA_LINES } from "./physicsGroups";

/** Radians turned per pixel of mouse movement at mouse speed 1. */
const SENSITIVITY = 0.0045;
const MAX_PITCH = 1.4;
const DISTANCE = 4.6;
const SHOULDER = 1.15;
const HEAD = 0.8;
/** Closest the camera comes to the pivot when something is behind it. */
const MIN_DISTANCE = 0.5;
/** Space kept between the camera (or the shoulder point) and whatever blocks it. */
const CLEARANCE = 0.35;
/** After being pulled in, the camera waits this long with a clear view before easing back out. */
const HOLD = 0.35;
/** How fast the camera eases back out, per second. */
const EASE_OUT = 3;

/** Field of view normally, and the zoom steps of the trebuchet scope (radians). */
const FOV = 0.9;
export const SCOPE_ZOOMS = [0.9, 0.55, 0.32, 0.18] as const;

/**
 * Third-person camera: sits behind the builder's shoulder and looks where the
 * mouse points. On a trebuchet it becomes a scope instead: the camera sits at
 * `scope` (above the trebuchet), looks freely all the way round, and zooms.
 */
export class CameraRig {
  readonly camera: FreeCamera;
  /** Multiplies mouse look speed (the player's setting). */
  sensitivity = 1;
  yaw = 0;
  pitch = 0.22;
  /** Unit vector the camera looks along. */
  readonly forward = new Vector3(0, 0, 1);
  /** The point beside the builder's head that the view line passes through. Aiming starts here. */
  readonly pivot = new Vector3();
  /** Where the scope looks from while on a trebuchet; null for the normal camera. */
  scope: Vector3 | null = null;
  /** Index into SCOPE_ZOOMS. */
  zoom = 0;

  private distance = DISTANCE;
  private shoulder = SHOULDER;
  private distanceHold = 0;
  private shoulderHold = 0;
  private readonly head = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly hit = new PhysicsRaycastResult();

  constructor(private readonly scene: Scene) {
    this.camera = new FreeCamera("camera", new Vector3(0, 3, -8), scene);
    this.camera.minZ = 0.15;
    this.camera.maxZ = 2000;
    this.camera.fov = FOV;
    this.camera.inputs.clear();
  }

  look(dx: number, dy: number): void {
    // Zoomed in, the mouse turns the view less, so aiming stays precise.
    const k = SENSITIVITY * this.sensitivity * (this.scope ? SCOPE_ZOOMS[this.zoom]! / FOV : 1);
    this.yaw += dx * k;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dy * k));
  }

  update(playerCentre: Vector3, dt: number): void {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    // Camera up: perpendicular to the view and to its right.
    Vector3.CrossToRef(this.forward, this.right, this.up);
    if (this.scope) {
      // Scope: straight from the trebuchet's vantage point, nothing behind or around to dodge.
      this.pivot.copyFrom(this.scope);
      this.camera.position.copyFrom(this.scope);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      this.camera.fov = SCOPE_ZOOMS[this.zoom]!;
      return;
    }
    this.camera.fov = FOV;
    this.head.set(playerCentre.x, playerCentre.y + HEAD, playerCentre.z);
    const physics = this.scene.getPhysicsEngine() as PhysicsEngine | null;

    // Slide the over-the-shoulder point toward the head when a wall is right beside the builder,
    // so the view never starts inside a wall.
    let shoulderTarget = SHOULDER;
    if (physics) {
      this.head.addToRef(this.right.scale(SHOULDER + CLEARANCE), this.to);
      physics.raycastToRef(this.head, this.to, this.hit, CAMERA_LINES);
      if (this.hit.hasHit) shoulderTarget = Math.max(0, this.hit.hitDistance - CLEARANCE);
    }
    [this.shoulder, this.shoulderHold] = settle(this.shoulder, shoulderTarget, this.shoulderHold, dt);
    this.head.addToRef(this.right.scale(this.shoulder), this.pivot);

    // Pull the camera in when anything is between it and the builder. Five lines
    // (centre and around the edges of the view) instead of one, so the camera does
    // not flicker in and out as a wall edge passes across a single line.
    let target = DISTANCE;
    if (physics) {
      for (const [r, u] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.22], [0, -0.22]] as const) {
        this.pivot.addToRef(this.right.scale(r), this.from).addInPlace(this.up.scale(u));
        this.from.subtractToRef(this.forward.scale(DISTANCE + CLEARANCE), this.to);
        physics.raycastToRef(this.from, this.to, this.hit, CAMERA_LINES);
        if (this.hit.hasHit) target = Math.min(target, Math.max(MIN_DISTANCE, this.hit.hitDistance - CLEARANCE));
      }
    }
    [this.distance, this.distanceHold] = settle(this.distance, target, this.distanceHold, dt);

    this.pivot.subtractToRef(this.forward.scale(this.distance), this.camera.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}

/**
 * Moves a length toward its target: straight in when something is in the way
 * (so walls never cover the view), but back out only after the way has been
 * clear for a moment, and then smoothly. Returns the new length and hold time.
 */
function settle(current: number, target: number, hold: number, dt: number): [number, number] {
  if (target < current) return [target, HOLD];
  if (hold > 0) return [current, hold - dt];
  return [current + (target - current) * Math.min(1, dt * EASE_OUT), 0];
}
