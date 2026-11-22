import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CharacterSupportedState, PhysicsCharacterController } from "@babylonjs/core/Physics/v2/characterController";
import type { Scene } from "@babylonjs/core/scene";
import { CELL, WORLD_HALF_CELLS } from "../game/constants";
import { DOWN_TIME, fallPosition, RISE_TIME, type Fall } from "../game/fall";
import { Avatar, AVATAR_RUN_SPEED, downness } from "./avatar";
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

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** The builder: a Havok character controller with a small original avatar on top. */
export class Player {
  readonly controller: PhysicsCharacterController;
  readonly avatar: Avatar;
  /** Centre of the body. */
  readonly position = SPAWN.clone();
  onGround = false;

  private state: State = "air";
  /** A flight planned by the server (thrown or falling), and when it started (performance.now()). */
  private fall: { fall: Fall; start: number } | null = null;
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

    if (this.fall) {
      // Following a planned flight, then lying flat, then getting up: no control.
      const t = this.fallTime;
      const p = fallPosition(this.fall.fall, t);
      cc.setPosition(new Vector3(p[0], p[1], p[2]));
      cc.setVelocity(Vector3.Zero());
      this.position.set(p[0], p[1], p[2]);
      this.onGround = t >= this.fall.fall.time;
      this.state = this.onGround ? "ground" : "air";
      if (t >= this.fall.fall.time + DOWN_TIME + RISE_TIME) this.fall = null;
      return;
    }

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
    this.settle();
  }

  /** Starts a flight planned by the server: thrown by a trebuchet, or falling. */
  startFall(fall: Fall): void {
    this.fall = { fall, start: performance.now() };
  }

  private get fallTime(): number {
    return this.fall ? (performance.now() - this.fall.start) / 1000 : 0;
  }

  /** In the air after a throw or fall. */
  get tumbling(): boolean {
    return this.fall !== null && this.fallTime < this.fall.fall.time;
  }

  /** From being thrown until back on their feet: no building, no moving. */
  get knockedDown(): boolean {
    return this.fall !== null;
  }

  /** 1 lying flat after coming down, easing to 0 while getting up. */
  get down(): number {
    if (!this.fall) return 0;
    return downness(this.fallTime - this.fall.fall.time);
  }

  /** Copies the controller's position out, keeping the builder inside the world. */
  private settle(): void {
    const cc = this.controller;
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

  /**
   * Puts the builder at the start, or the nearest open ground to it when
   * `isOpen` (cell x, z → free of pieces) says the start is built over, so
   * nobody begins boxed in inside someone's fort.
   */
  respawn(isOpen: (cx: number, cz: number) => boolean = () => true): void {
    const sx = Math.floor(SPAWN.x / CELL), sz = Math.floor(SPAWN.z / CELL);
    for (let r = 0; r <= 40; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dz of r === 0 ? [0] : Math.abs(dx) === r ? range(-r, r) : [-r, r]) {
          if (!isOpen(sx + dx, sz + dz)) continue;
          return this.teleport((sx + dx + 0.5) * CELL, SPAWN.y, (sz + dz + 0.5) * CELL);
        }
      }
    }
    this.teleport(SPAWN.x, SPAWN.y, SPAWN.z);
  }

  teleport(x: number, y: number, z: number): void {
    this.controller.setPosition(new Vector3(x, y, z));
    this.controller.setVelocity(Vector3.Zero());
    this.position.set(x, y, z);
    this.fall = null;
  }

  /** Moves the avatar to the character and animates it. Call before rendering. */
  animate(dt: number, facingYaw: number): void {
    this.avatar.root.position.set(this.position.x, this.position.y - HEIGHT / 2, this.position.z);
    const v = this.controller.getVelocity();
    this.avatar.animate(dt, facingYaw, v.x, v.z, this.onGround, this.tumbling, this.down);
  }
}
