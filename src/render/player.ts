import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CharacterSupportedState, PhysicsCharacterController } from "@babylonjs/core/Physics/v2/characterController";
import type { Scene } from "@babylonjs/core/scene";
import { CELL, WORLD_HALF_CELLS } from "../game/constants";

const HEIGHT = 1.8;
const RADIUS = 0.4;
/** Fast on purpose: getting around quickly makes building quick. */
const WALK_SPEED = 16;
const RUN_SPEED = 26;
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
  readonly root: TransformNode;
  /** Centre of the body. */
  readonly position = SPAWN.clone();
  onGround = false;

  private state: State = "air";
  private readonly desired = new Vector3();
  private readonly forwardDir = new Vector3();
  private stride = 0;
  /** 0 standing still to 1 moving, eased so the limbs settle smoothly. */
  private swing = 0;
  /** Undoes the body's lean so the legs hang straight down from the hips. */
  private legsUpright!: TransformNode;
  /** Turns the legs toward the direction of travel. */
  private legsTurn!: TransformNode;
  /** Current angle of the legs from the facing direction, radians (positive = toward the right). */
  private legYaw = 0;
  /** Left then right: hip, knee, shoulder and elbow joints. */
  private readonly hips: TransformNode[] = [];
  private readonly knees: TransformNode[] = [];
  private readonly shoulders: TransformNode[] = [];
  private readonly elbows: TransformNode[] = [];
  private readonly body: TransformNode;

  constructor(scene: Scene, shadows: ShadowGenerator) {
    this.controller = new PhysicsCharacterController(SPAWN.clone(), { capsuleHeight: HEIGHT, capsuleRadius: RADIUS }, scene);
    // Lets the builder walk over floor edges and ramp lips without hopping.
    this.controller.maxStepHeight = 0.4;
    this.controller.maxAcceleration = 340;
    // The controller's solver ignores speeds above this (default 10 m/s), which would cap running.
    this.controller.maxCharacterSpeedForSolver = 40;

    this.root = new TransformNode("builder", scene);
    this.body = new TransformNode("builder-body", scene);
    this.body.parent = this.root;
    this.buildAvatar(scene, shadows);
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
    this.root.position.set(this.position.x, this.position.y - HEIGHT / 2, this.position.z);
    // Turn toward the view direction along the shortest arc.
    let diff = (facingYaw - this.root.rotation.y) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.root.rotation.y += diff * Math.min(1, dt * 16);

    const v = this.controller.getVelocity();
    const speed = Math.hypot(v.x, v.z);
    const moving = this.onGround && speed > 0.5;
    // How much of a sprint this is: 0 at a stroll, 1 at full running speed.
    const effort = Math.min(1, speed / RUN_SPEED);
    this.stride += dt * (moving ? 7 + effort * 11 : 0);
    this.swing += ((moving ? 1 : 0) - this.swing) * Math.min(1, dt * 10);
    const ease = Math.min(1, dt * 18);
    const to = (node: TransformNode, target: number) => (node.rotation.x += (target - node.rotation.x) * ease);

    const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    // Which way the builder is travelling compared with the way they face:
    // 0 forward, +pi/2 right, -pi/2 left, pi backwards.
    const travel = moving ? wrap(Math.atan2(v.x, v.z) - this.root.rotation.y) : 0;
    const backwards = Math.abs(travel) > 1.75;
    // The legs turn toward the direction of travel (up to about 70 degrees, so a
    // pure sidestep is a sideways run with the hips turned), while the upper
    // body keeps facing where the builder is looking. Backwards is a backpedal.
    const legTarget = moving ? Math.max(-1.25, Math.min(1.25, backwards ? wrap(travel - Math.PI) : travel)) : 0;
    this.legYaw += (legTarget - this.legYaw) * Math.min(1, dt * 12);
    // Run the cycle backwards when backpedalling.
    if (backwards) this.stride -= 2 * dt * (moving ? 7 + effort * 11 : 0);

    if (!this.onGround) {
      // In the air: one knee tucked up in front, the other trailing, arms up for balance.
      to(this.hips[0]!, -1.0);
      to(this.knees[0]!, 1.4);
      to(this.hips[1]!, 0.45);
      to(this.knees[1]!, 0.9);
      to(this.shoulders[0]!, -2.2);
      to(this.shoulders[1]!, -1.6);
      to(this.elbows[0]!, -0.4);
      to(this.elbows[1]!, -0.6);
      to(this.body, 0.1);
      this.body.rotation.z += (0 - this.body.rotation.z) * ease;
      this.body.position.y += (0 - this.body.position.y) * ease;
      this.body.rotation.y += (this.legYaw * 0.25 - this.body.rotation.y) * ease;
      this.holdLegs();
      return;
    }

    // Running cycle. Each leg swings from the hip; the knee folds while the leg
    // comes forward (heel kicks up behind) and nearly straightens to land.
    // Arms swing opposite to the legs with the elbows bent.
    const w = this.swing;
    const lean = (0.06 + 0.22 * effort) * w;
    const legSwing = (0.6 + 0.5 * effort) * w;
    const kneeFold = (0.7 + 1.5 * effort) * w;
    const armSwing = (0.5 + 0.7 * effort) * w;
    for (let side = 0; side < 2; side++) {
      const p = this.stride + side * Math.PI;
      to(this.hips[side]!, -Math.sin(p) * legSwing);
      to(this.knees[side]!, 0.08 + kneeFold * Math.max(0, Math.cos(p)) ** 1.5);
      to(this.shoulders[side]!, Math.sin(p) * armSwing);
      to(this.elbows[side]!, -(0.25 + 1.2 * effort * w));
    }
    // Lean into the run (forward, or sideways into a sidestep; back a little when
    // backpedalling), bob twice per stride, twist the shoulders a little, and
    // turn the chest a quarter of the way toward the legs.
    const sideways = Math.sin(this.legYaw) * (backwards ? -1 : 1);
    to(this.body, lean * (backwards ? -0.4 : Math.cos(this.legYaw)));
    this.body.rotation.z += (-sideways * 0.22 * effort * w - this.body.rotation.z) * ease;
    const bob = moving ? Math.abs(Math.sin(this.stride)) * (0.04 + 0.06 * effort) : 0;
    this.body.position.y += (bob - this.body.position.y) * ease;
    const twist = Math.sin(this.stride) * 0.12 * effort * w;
    this.body.rotation.y += (twist + this.legYaw * 0.25 - this.body.rotation.y) * ease;
    this.holdLegs();
  }

  /** Keeps the legs upright under the leaning body and pointed along legYaw. */
  private holdLegs(): void {
    this.legsUpright.rotation.set(-this.body.rotation.x, 0, -this.body.rotation.z);
    this.legsTurn.rotation.y = this.legYaw - this.body.rotation.y;
  }

  /**
   * An original builder: coral work jacket, navy trousers, teal tool pack and a
   * sunflower-yellow hard hat. Human proportions, built from simple shapes,
   * with hips, knees, shoulders and elbows that bend.
   */
  private buildAvatar(scene: Scene, shadows: ShadowGenerator): void {
    const mat = (name: string, r: number, g: number, b: number) => {
      const m = new StandardMaterial(`builder-${name}`, scene);
      m.diffuseColor = new Color3(r, g, b);
      m.specularColor = Color3.Black();
      return m;
    };
    const coral = mat("coral", 0.94, 0.45, 0.34);
    const navy = mat("navy", 0.17, 0.22, 0.33);
    const skin = mat("skin", 0.87, 0.67, 0.52);
    const sun = mat("sun", 1, 0.79, 0.22);
    const teal = mat("teal", 0.18, 0.56, 0.55);
    const ink = mat("ink", 0.12, 0.13, 0.17);
    const cream = mat("cream", 1, 0.95, 0.85);

    const add = (mesh: Mesh, material: StandardMaterial, parent: TransformNode, x: number, y: number, z: number) => {
      mesh.material = material;
      mesh.parent = parent;
      mesh.position.set(x, y, z);
      mesh.isPickable = false;
      shadows.addShadowCaster(mesh);
      return mesh;
    };
    const joint = (name: string, parent: TransformNode, x: number, y: number, z: number) => {
      const node = new TransformNode(name, scene);
      node.parent = parent;
      node.position.set(x, y, z);
      return node;
    };
    const limb = (name: string, radius: number, length: number) =>
      CreateCapsule(name, { radius, height: length, tessellation: 10, subdivisions: 1 }, scene);

    // Legs: thigh from the hip, shin from the knee, boot on the shin. Both hang
    // from a pelvis that stays upright and turns toward the direction of travel.
    this.legsUpright = joint("pelvis", this.body, 0, 0.9, 0);
    this.legsTurn = joint("pelvis-turn", this.legsUpright, 0, 0, 0);
    for (const side of [-1, 1]) {
      const hip = joint("hip", this.legsTurn, side * 0.13, 0, 0);
      add(limb("thigh", 0.115, 0.5), navy, hip, 0, -0.22, 0);
      const knee = joint("knee", hip, 0, -0.45, 0);
      add(CreateSphere("kneecap", { diameter: 0.21, segments: 8 }, scene), navy, knee, 0, 0, 0.01);
      add(limb("shin", 0.1, 0.46), navy, knee, 0, -0.2, 0);
      add(CreateBox("boot", { width: 0.2, height: 0.12, depth: 0.32 }, scene), ink, knee, 0, -0.39, 0.05);
      this.hips.push(hip);
      this.knees.push(knee);
    }
    // Body.
    add(CreateCapsule("torso", { radius: 0.24, height: 0.78, tessellation: 14, subdivisions: 1 }, scene), coral, this.body, 0, 1.2, 0);
    add(CreateCylinder("stripe", { diameter: 0.5, height: 0.06, tessellation: 14 }, scene), cream, this.body, 0, 1.12, 0);
    add(CreateCylinder("belt", { diameter: 0.46, height: 0.08, tessellation: 14 }, scene), ink, this.body, 0, 0.92, 0);
    add(CreateBox("pack", { width: 0.36, height: 0.44, depth: 0.18 }, scene), teal, this.body, 0, 1.24, -0.27);
    add(CreateBox("pack-flap", { width: 0.38, height: 0.1, depth: 0.2 }, scene), cream, this.body, 0, 1.42, -0.27);
    // Arms: upper arm from the shoulder, forearm and hand from the elbow.
    for (const side of [-1, 1]) {
      const shoulder = joint("shoulder", this.body, side * 0.32, 1.46, 0);
      add(limb("upper-arm", 0.085, 0.36), coral, shoulder, 0, -0.15, 0);
      const elbow = joint("elbow", shoulder, 0, -0.31, 0);
      add(limb("forearm", 0.075, 0.32), coral, elbow, 0, -0.13, 0);
      add(CreateSphere("hand", { diameter: 0.15, segments: 8 }, scene), skin, elbow, 0, -0.31, 0.01);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
    }
    // Head and hard hat.
    add(CreateCylinder("neck", { diameter: 0.14, height: 0.1, tessellation: 10 }, scene), skin, this.body, 0, 1.6, 0);
    add(CreateSphere("head", { diameter: 0.34, segments: 14 }, scene), skin, this.body, 0, 1.76, 0.01);
    for (const side of [-1, 1]) add(CreateSphere("eye", { diameter: 0.045, segments: 6 }, scene), ink, this.body, side * 0.065, 1.78, 0.165);
    add(CreateSphere("hat", { diameter: 0.4, segments: 14, slice: 0.5 }, scene), sun, this.body, 0, 1.82, 0);
    add(CreateCylinder("brim", { diameter: 0.46, height: 0.035, tessellation: 18 }, scene), sun, this.body, 0, 1.83, 0.03);
    add(CreateBox("crest", { width: 0.06, height: 0.05, depth: 0.32 }, scene), sun, this.body, 0, 2.02, 0);
  }
}
