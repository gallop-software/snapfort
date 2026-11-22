import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CharacterSupportedState, PhysicsCharacterController } from "@babylonjs/core/Physics/v2/characterController";
import type { Scene } from "@babylonjs/core/scene";
import { CELL, WORLD_HALF_CELLS } from "../game/constants";
import { Avatar, AVATAR_RUN_SPEED } from "./avatar";
import { BUILDER_GROUP } from "./physicsGroups";

const HEIGHT = 1.8;
const RADIUS = 0.4;
/** Fast on purpose: getting around quickly makes building quick. */
const WALK_SPEED = 16;
const RUN_SPEED = AVATAR_RUN_SPEED;
/** About two thirds of a storey: high enough to hop onto most things, not over a wall. */
const JUMP_HEIGHT = 2.6;
const GRAVITY = new Vector3(0, -26, 0);
const UP = Vector3.Up();
const DOWN = Vector3.Down();
const SPAWN = new Vector3(CELL / 2, HEIGHT / 2 + 0.05, -CELL * 1.5);
const WORLD_LIMIT = WORLD_HALF_CELLS * CELL + 12;

export interface MoveInput {
  /** -1..1, positive is to the right of the view. */
  strafe: number;
  /** -1..1, positive is forward. */
  forward: number;
  run: boolean;
  jump: boolean;
  /** The yaw movement is relative to (the camera's). */
  yaw: number;
}

type State = "ground" | "air" | "jump";

/** The builder: a Havok character controller with a small original avatar on top. */
export class Player {
  readonly controller: PhysicsCharacterController;
  readonly avatar: Avatar;
  /** Centre of the body. */
  readonly position = SPAWN.clone();
  onGround = false;

  private state: State = "air";
  private readonly desired = new Vector3();
  private readonly forwardDir = new Vector3();
  constructor(scene: Scene, shadows: ShadowGenerator) {
    this.controller = new PhysicsCharacterController(SPAWN.clone(), { capsuleHeight: HEIGHT, capsuleRadius: RADIUS }, scene);
    // Lets the builder walk over floor edges and ramp lips without hopping.
    this.controller.maxStepHeight = 0.4;
    // Own collision group, so camera and crosshair lines can skip the builder's body.
    this.controller.shape.filterMembershipMask = BUILDER_GROUP;
    this.controller.maxAcceleration = 340;
    // The controller's solver ignores speeds above this (default 10 m/s), which would cap running.
    this.controller.maxCharacterSpeedForSolver = 40;

    this.avatar = new Avatar(scene, shadows);
  }

  /** Advances the character. Call after each physics step. */
  step(dt: number, input: MoveInput): void {
    const cc = this.controller;
    const support = cc.checkSupport(dt, DOWN);
    const supported = support.supportedState === CharacterSupportedState.SUPPORTED;

    if (this.state === "jump") this.state = "air";
    else if (this.state === "air" && supported) this.state = "ground";
    else if (this.state === "ground" && !supported) this.state = "air";
    else if (this.state === "ground" && input.jump) this.state = "jump";
    this.onGround = this.state === "ground";

    let sx = input.strafe, fz = input.forward;
    const len = Math.hypot(sx, fz);
    if (len > 1) { sx /= len; fz /= len; }
    const speed = input.run ? RUN_SPEED : WALK_SPEED;
    const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
    this.forwardDir.set(sin, 0, cos);
    this.desired.set((sin * fz + cos * sx) * speed, 0, (cos * fz - sin * sx) * speed);

    // The controller eases toward the wanted velocity by a fraction per step; derive that
    // fraction from time so the builder feels the same at any frame rate.
    cc.acceleration = 1 - Math.exp(-dt * (this.state === "ground" ? 20 : 9));

    const current = cc.getVelocity();
    let out: Vector3;
    if (this.state === "jump") {
      const lift = Math.sqrt(2 * -GRAVITY.y * JUMP_HEIGHT);
      out = current.add(UP.scale(lift - current.y));
    } else if (this.state === "ground") {
      out = cc.calculateMovement(dt, this.forwardDir, support.averageSurfaceNormal, current, support.averageSurfaceVelocity, this.desired, UP);
      // Keep full horizontal speed when walking up a slope.
      out.subtractInPlace(support.averageSurfaceVelocity);
      if (out.dot(UP) > 1e-3) {
        const velLen = out.length();
        out.normalizeFromLength(velLen);
        const horizLen = velLen / support.averageSurfaceNormal.dot(UP);
        const c = support.averageSurfaceNormal.cross(out);
        out = c.cross(UP);
        out.scaleInPlace(horizLen);
      }
      out.addInPlace(support.averageSurfaceVelocity);
    } else {
      out = cc.calculateMovement(dt, this.forwardDir, UP, current, Vector3.ZeroReadOnly, this.desired, UP);
      out.y = current.y + GRAVITY.y * dt;
    }

    cc.setVelocity(out);
    cc.integrate(dt, support, GRAVITY);

    const p = cc.getPosition();
    if (p.y < -30 || Math.abs(p.x) > WORLD_LIMIT || Math.abs(p.z) > WORLD_LIMIT) {
      p.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, p.x));
      p.z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, p.z));
      if (p.y < -30) p.copyFrom(SPAWN);
      cc.setPosition(p);
    }
    this.position.copyFrom(p);
  }

  /** Height of the builder's feet above the ground. */
  get feetY(): number {
    return this.position.y - HEIGHT / 2;
  }

  respawn(): void {
    this.teleport(SPAWN.x, SPAWN.y, SPAWN.z);
  }

  teleport(x: number, y: number, z: number): void {
    this.controller.setPosition(new Vector3(x, y, z));
    this.controller.setVelocity(Vector3.Zero());
    this.position.set(x, y, z);
  }

  /** Moves the avatar to the character and animates it. Call before rendering. */
  animate(dt: number, facingYaw: number): void {
    this.avatar.root.position.set(this.position.x, this.position.y - HEIGHT / 2, this.position.z);
    const v = this.controller.getVelocity();
    this.avatar.animate(dt, facingYaw, v.x, v.z, this.onGround);
  }
}
