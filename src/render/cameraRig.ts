import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import type { Scene } from "@babylonjs/core/scene";

/** Radians turned per pixel of mouse movement at mouse speed 1. */
const SENSITIVITY = 0.0045;
const MAX_PITCH = 1.4;
const DISTANCE = 4.6;
const SHOULDER = 1.15;
const HEAD = 0.8;

/** Third-person camera: sits behind the builder's shoulder and looks where the mouse points. */
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

  private distance = DISTANCE;
  private readonly wanted = new Vector3();
  private readonly hit = new PhysicsRaycastResult();

  constructor(private readonly scene: Scene) {
    this.camera = new FreeCamera("camera", new Vector3(0, 3, -8), scene);
    this.camera.minZ = 0.15;
    this.camera.maxZ = 2000;
    this.camera.fov = 0.9;
    this.camera.inputs.clear();
  }

  look(dx: number, dy: number): void {
    const k = SENSITIVITY * this.sensitivity;
    this.yaw += dx * k;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dy * k));
  }

  update(playerCentre: Vector3, dt: number): void {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.pivot.set(
      playerCentre.x + Math.cos(this.yaw) * SHOULDER,
      playerCentre.y + HEAD,
      playerCentre.z - Math.sin(this.yaw) * SHOULDER,
    );

    // Pull the camera in when a piece or the ground is between it and the builder.
    let target = DISTANCE;
    this.pivot.subtractToRef(this.forward.scale(DISTANCE + 0.4), this.wanted);
    const physics = this.scene.getPhysicsEngine() as PhysicsEngine | null;
    if (physics) {
      physics.raycastToRef(this.pivot, this.wanted, this.hit);
      if (this.hit.hasHit) target = Math.max(0.6, this.hit.hitDistance - 0.4);
    }
    // Snap in at once so walls never cover the view, ease back out.
    this.distance = target < this.distance ? target : this.distance + (target - this.distance) * Math.min(1, dt * 8);

    this.pivot.subtractToRef(this.forward.scale(this.distance), this.camera.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
