import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { DOWN_TIME, RISE_TIME } from "../game/fall";

/** Full running speed, m/s: the stride is at its widest here. */
export const AVATAR_RUN_SPEED = 26;
/**
 * How flat a builder lies `t` seconds after coming down from a throw: 1 for
 * DOWN_TIME, then easing to 0 over RISE_TIME as they get up. 0 before landing.
 */
export function downness(t: number): number {
  if (t < 0) return 0;
  if (t < DOWN_TIME) return 1;
  const k = Math.min(1, (t - DOWN_TIME) / RISE_TIME);
  return 1 - k * k * (3 - 2 * k);
}

/** The local player's jacket. */
export const DEFAULT_AVATAR_COLOR = "#f07356";

function plainMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(`builder-${name}`, scene);
  m.diffuseColor = color;
  m.specularColor = Color3.Black();
  return m;
}

const shared = new WeakMap<Scene, Record<"navy" | "skin" | "sun" | "teal" | "ink" | "cream", StandardMaterial>>();

/** Materials every builder has in common, made once per scene. */
function sharedMaterials(scene: Scene) {
  let mats = shared.get(scene);
  if (!mats) {
    mats = {
      navy: plainMaterial(scene, "navy", new Color3(0.17, 0.22, 0.33)),
      skin: plainMaterial(scene, "skin", new Color3(0.87, 0.67, 0.52)),
      sun: plainMaterial(scene, "sun", new Color3(1, 0.79, 0.22)),
      teal: plainMaterial(scene, "teal", new Color3(0.18, 0.56, 0.55)),
      ink: plainMaterial(scene, "ink", new Color3(0.12, 0.13, 0.17)),
      cream: plainMaterial(scene, "cream", new Color3(1, 0.95, 0.85)),
    };
    shared.set(scene, mats);
  }
  return mats;
}

/**
 * A builder's body and its running animation, with hips, knees, shoulders and
 * elbows that bend. Used for the local player and for everyone else in the world.
 */
export class Avatar {
  /** Put this at the builder's feet. */
  readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly meshes: Mesh[] = [];
  private readonly nodes: TransformNode[] = [];
  private jacket!: StandardMaterial;
  private stride = 0;
  /** 0 standing still to 1 moving, eased so the limbs settle smoothly. */
  private swing = 0;
  /** Undoes the body's lean so the legs hang straight down from the hips. */
  private legsUpright!: TransformNode;
  /** Turns the legs toward the direction of travel. */
  private legsTurn!: TransformNode;
  /** Current angle of the legs from the facing direction, radians (positive = toward the right). */
  private legYaw = 0;
  /** Seconds into a tumble (0 when not tumbling). */
  private tumbleTime = 0;
  /** Left then right: hip, knee, shoulder and elbow joints. */
  private readonly hips: TransformNode[] = [];
  private readonly knees: TransformNode[] = [];
  private readonly shoulders: TransformNode[] = [];
  private readonly elbows: TransformNode[] = [];

  constructor(scene: Scene, shadows: ShadowGenerator | null, color = DEFAULT_AVATAR_COLOR) {
    this.root = new TransformNode("builder", scene);
    this.body = new TransformNode("builder-body", scene);
    this.body.parent = this.root;
    this.buildAvatar(scene, shadows, color);
  }

  setColor(color: string): void {
    this.jacket.diffuseColor = Color3.FromHexString(color);
  }

  setEnabled(on: boolean): void {
    this.root.setEnabled(on);
  }

  dispose(): void {
    this.jacket.dispose();
    for (const mesh of this.meshes) mesh.dispose();
    for (const node of this.nodes) node.dispose();
    this.body.dispose();
    this.root.dispose();
  }

  /**
   * Animates the builder. `facingYaw` is where they look, (vx, vz) their
   * horizontal velocity in m/s. Place `root` at their feet first.
   */
  animate(dt: number, facingYaw: number, vx: number, vz: number, onGround: boolean, tumbling = false, down = 0): void {
    if (tumbling) return this.tumble(dt);
    if (down > 0) return this.lie(down);
    if (this.tumbleTime > 0) {
      // Back on their feet: upright again.
      this.tumbleTime = 0;
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;
      for (const joint of [...this.shoulders, ...this.hips]) joint.rotation.z = 0;
    }
    // Turn toward the view direction along the shortest arc.
    let diff = (facingYaw - this.root.rotation.y) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.root.rotation.y += diff * Math.min(1, dt * 16);

    const speed = Math.hypot(vx, vz);
    const moving = onGround && speed > 0.5;
    // How much of a sprint this is: 0 at a stroll, 1 at full running speed.
    const effort = Math.min(1, speed / AVATAR_RUN_SPEED);
    this.stride += dt * (moving ? 7 + effort * 11 : 0);
    this.swing += ((moving ? 1 : 0) - this.swing) * Math.min(1, dt * 10);
    const ease = Math.min(1, dt * 18);
    const to = (node: TransformNode, target: number) => (node.rotation.x += (target - node.rotation.x) * ease);

    const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    // Which way the builder is travelling compared with the way they face:
    // 0 forward, +pi/2 right, -pi/2 left, pi backwards.
    const travel = moving ? wrap(Math.atan2(vx, vz) - this.root.rotation.y) : 0;
    const backwards = Math.abs(travel) > 1.75;
    // The legs turn toward the direction of travel (up to about 70 degrees, so a
    // pure sidestep is a sideways run with the hips turned), while the upper
    // body keeps facing where the builder is looking. Backwards is a backpedal.
    const legTarget = moving ? Math.max(-1.25, Math.min(1.25, backwards ? wrap(travel - Math.PI) : travel)) : 0;
    this.legYaw += (legTarget - this.legYaw) * Math.min(1, dt * 12);
    // Run the cycle backwards when backpedalling.
    if (backwards) this.stride -= 2 * dt * (moving ? 7 + effort * 11 : 0);

    if (!onGround) {
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

  /**
   * Thrown through the air: head-over-heels flips, a slow sideways roll, and
   * arms and legs flailing out of time with each other. Spins around the
   * middle of the body, not the feet.
   */
  private tumble(dt: number): void {
    const t = (this.tumbleTime += dt);
    const feet = this.root.position.clone();
    this.root.rotation.x = t * 8.5;
    this.root.rotation.z = Math.sin(t * 2.1) * 1.1 + t * 2.4;
    this.root.rotation.y += dt * 3;
    // Keep the middle of the body where the feet were told to be plus its height.
    const middle = new Vector3(0, 0.95, 0);
    const turned = Vector3.TransformCoordinates(middle, Matrix.RotationYawPitchRoll(this.root.rotation.y, this.root.rotation.x, this.root.rotation.z));
    this.root.position.set(feet.x + middle.x - turned.x, feet.y + middle.y - turned.y, feet.z + middle.z - turned.z);
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? 1 : -1;
      this.shoulders[side]!.rotation.x = -1.6 + Math.sin(t * 15 + side * 2.3) * 1.5;
      this.shoulders[side]!.rotation.z = s * (0.9 + Math.sin(t * 11 + side) * 0.6);
      this.elbows[side]!.rotation.x = -0.5 - Math.abs(Math.sin(t * 13 + side)) * 1.2;
      this.hips[side]!.rotation.x = Math.sin(t * 12 + side * 2.8) * 1.3;
      this.hips[side]!.rotation.z = s * Math.abs(Math.sin(t * 9 + side)) * 0.5;
      this.knees[side]!.rotation.x = 0.3 + Math.abs(Math.sin(t * 14 + side * 1.7)) * 1.4;
    }
    this.body.rotation.set(Math.sin(t * 7) * 0.3, 0, Math.sin(t * 5) * 0.3);
    this.body.position.y = 0;
    this.legYaw = 0;
    this.holdLegs();
  }

  /**
   * Flat on their back where they came down, arms and legs out (down = 1),
   * swinging back up onto their feet as `down` falls to 0.
   */
  private lie(down: number): void {
    this.tumbleTime = Math.max(this.tumbleTime, 1e-3);
    this.root.rotation.x = (-Math.PI / 2) * down;
    this.root.rotation.z = 0;
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? 1 : -1;
      this.shoulders[side]!.rotation.x = -0.3 * down;
      this.shoulders[side]!.rotation.z = s * 1.25 * down;
      this.elbows[side]!.rotation.x = -0.35 * down;
      this.hips[side]!.rotation.x = -0.1 * down;
      this.hips[side]!.rotation.z = s * 0.28 * down;
      this.knees[side]!.rotation.x = 0.25 * down;
    }
    this.body.rotation.set(0, 0, 0);
    this.body.position.y = 0;
    this.legYaw = 0;
    this.holdLegs();
  }

  /** Keeps the legs upright under the leaning body and pointed along legYaw. */
  private holdLegs(): void {
    this.legsUpright.rotation.set(-this.body.rotation.x, 0, -this.body.rotation.z);
    this.legsTurn.rotation.y = this.legYaw - this.body.rotation.y;
  }

  /**
   * An original builder: work jacket in the player's colour (coral for the local player), navy trousers, teal tool pack and a
   * sunflower-yellow hard hat. Human proportions, built from simple shapes,
   * with hips, knees, shoulders and elbows that bend.
   */
  private buildAvatar(scene: Scene, shadows: ShadowGenerator | null, color: string): void {
    const { navy, skin, sun, teal, ink, cream } = sharedMaterials(scene);
    const coral = (this.jacket = plainMaterial(scene, "jacket", Color3.FromHexString(color)));

    const add = (mesh: Mesh, material: StandardMaterial, parent: TransformNode, x: number, y: number, z: number) => {
      mesh.material = material;
      mesh.parent = parent;
      mesh.position.set(x, y, z);
      mesh.isPickable = false;
      shadows?.addShadowCaster(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    const joint = (name: string, parent: TransformNode, x: number, y: number, z: number) => {
      const node = new TransformNode(name, scene);
      node.parent = parent;
      this.nodes.push(node);
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
