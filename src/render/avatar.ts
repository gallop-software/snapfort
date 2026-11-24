import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { DOWN_TIME, RISE_TIME } from "../game/fall";
import type { OutfitBuilder, OutfitRig } from "../worlds/pageDoors";

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

export type StandInPose = "stand" | "runA" | "runB" | "air";

/** The local player's jacket. */
export const DEFAULT_AVATAR_COLOR = "#f07356";

function plainMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(`builder-${name}`, scene);
  m.diffuseColor = color;
  m.specularColor = Color3.Black();
  return m;
}

/** Plain colours every builder in a scene has in common, by name, made once per scene. */
const shared = new WeakMap<Scene, Map<string, StandardMaterial>>();

/**
 * A builder's skeleton and its running animation, with hips, knees, shoulders
 * and elbows that bend, dressed in the world's outfit. Used for the local
 * player and for everyone else in the world.
 */
export class Avatar {
  /** Put this at the builder's feet. */
  readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly meshes: Mesh[] = [];
  private readonly nodes: TransformNode[] = [];
  /** The part of the outfit in the player's colour. */
  private jacket!: StandardMaterial;
  /** Materials of this builder's own (disposed with it). */
  private readonly owned: StandardMaterial[] = [];
  /** Parts of the outfit that can be shown and hidden by name. */
  private readonly extras = new Map<string, Mesh[]>();
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

  constructor(scene: Scene, shadows: ShadowGenerator | null, outfit: OutfitBuilder, color = DEFAULT_AVATAR_COLOR) {
    this.root = new TransformNode("builder", scene);
    this.body = new TransformNode("builder-body", scene);
    this.body.parent = this.root;
    this.buildAvatar(scene, shadows, outfit, color);
  }

  /** Shows or hides a named extra part of the outfit (a world's own: rocket flames, say). */
  setExtra(name: string, on: boolean): void {
    for (const mesh of this.extras.get(name) ?? []) mesh.setEnabled(on);
  }

  setColor(color: string): void {
    this.jacket.diffuseColor = Color3.FromHexString(color);
  }

  setEnabled(on: boolean): void {
    this.root.setEnabled(on);
  }

  dispose(): void {
    for (const material of this.owned) material.dispose();
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
      for (const shoulder of this.shoulders) shoulder.rotation.y = 0;
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
   * arms and legs flailing out of time with each other: the arms flung wide
   * and nearly straight, not tucked in by the sides. Spins around the middle
   * of the body, not the feet.
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
      // Away from the body: the first of each pair is on the -x side, where a negative turn about z goes outward.
      const s = side === 0 ? -1 : 1;
      // Out from the body (z: from well out to above the shoulder), sweeping
      // forward and back (y) and windmilling (x), the elbows barely bent.
      this.shoulders[side]!.rotation.x = -0.3 + Math.sin(t * 10 + side * 2.3) * 1.1;
      this.shoulders[side]!.rotation.y = Math.sin(t * 8 + side * 2.6) * 0.7;
      this.shoulders[side]!.rotation.z = s * (1.55 + Math.sin(t * 6 + side * 1.9) * 0.55);
      this.elbows[side]!.rotation.x = -0.15 - Math.abs(Math.sin(t * 9 + side)) * 0.45;
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
   * Sets a fixed pose at once (no easing), for baking distant stand-ins:
   * standing, the two halves of a running stride, or in the air.
   */
  setPose(pose: StandInPose): void {
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.body.position.y = 0;
    this.legYaw = 0;
    const run = pose === "runA" || pose === "runB";
    const p = pose === "runA" ? Math.PI / 2 : -Math.PI / 2;
    this.body.rotation.set(run ? 0.22 : pose === "air" ? 0.1 : 0, 0, 0);
    for (let side = 0; side < 2; side++) {
      const ph = p + side * Math.PI;
      this.shoulders[side]!.rotation.set(run ? Math.sin(ph) * 1.0 : pose === "air" ? (side === 0 ? -2.2 : -1.6) : 0, 0, 0);
      this.elbows[side]!.rotation.set(run ? -1.1 : pose === "air" ? -0.5 : -0.15, 0, 0);
      this.hips[side]!.rotation.set(run ? -Math.sin(ph) * 0.9 : pose === "air" ? (side === 0 ? -1.0 : 0.45) : 0, 0, 0);
      this.knees[side]!.rotation.set(run ? 0.08 + 1.6 * Math.max(0, Math.cos(ph)) ** 1.5 + (Math.sin(ph) > 0 ? 0.4 : 0) : pose === "air" ? (side === 0 ? 1.4 : 0.9) : 0.05, 0, 0);
    }
    this.holdLegs();
  }

  /**
   * The body's parts in their current pose, split into the jacket (to be
   * tinted per builder) and everything else, each painted its colour, ready to
   * be merged into one mesh (see standIns.ts).
   */
  partsForBaking(): { jacket: Mesh[]; rest: Mesh[] } {
    const jacket: Mesh[] = [];
    const rest: Mesh[] = [];
    for (const mesh of this.meshes) {
      mesh.computeWorldMatrix(true);
      if (mesh.material === this.jacket) jacket.push(mesh);
      else rest.push(mesh);
    }
    return { jacket, rest };
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
      // Away from the body: the first of each pair is on the -x side, where a negative turn about z goes outward.
      const s = side === 0 ? -1 : 1;
      this.shoulders[side]!.rotation.x = -0.3 * down;
      this.shoulders[side]!.rotation.y = 0;
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
   * The skeleton every world dresses (see OutfitRig in worlds/pageDoors.ts):
   * hips, knees, shoulders and elbows that bend, the legs hanging from a pelvis
   * that stays upright and turns toward the direction of travel. The world's
   * outfit hangs the body parts on it.
   */
  private buildAvatar(scene: Scene, shadows: ShadowGenerator | null, outfit: OutfitBuilder, color: string): void {
    const joint = (name: string, parent: TransformNode, x: number, y: number, z: number) => {
      const node = new TransformNode(name, scene);
      node.parent = parent;
      this.nodes.push(node);
      node.position.set(x, y, z);
      return node;
    };
    this.legsUpright = joint("pelvis", this.body, 0, 0.9, 0);
    this.legsTurn = joint("pelvis-turn", this.legsUpright, 0, 0, 0);
    for (const side of [-1, 1]) {
      const hip = joint("hip", this.legsTurn, side * 0.13, 0, 0);
      this.hips.push(hip);
      this.knees.push(joint("knee", hip, 0, -0.45, 0));
    }
    for (const side of [-1, 1]) {
      const shoulder = joint("shoulder", this.body, side * 0.32, 1.46, 0);
      this.shoulders.push(shoulder);
      this.elbows.push(joint("elbow", shoulder, 0, -0.31, 0));
    }
    const rig: OutfitRig = {
      scene,
      body: this.body,
      hips: this.hips,
      knees: this.knees,
      shoulders: this.shoulders,
      elbows: this.elbows,
      add: (mesh, material, parent, x, y, z) => {
        mesh.material = material;
        mesh.parent = parent;
        mesh.position.set(x, y, z);
        mesh.isPickable = false;
        shadows?.addShadowCaster(mesh);
        this.meshes.push(mesh);
        return mesh;
      },
      shared: (name, r, g, b) => {
        let mats = shared.get(scene);
        if (!mats) shared.set(scene, (mats = new Map()));
        let m = mats.get(name);
        if (!m) mats.set(name, (m = plainMaterial(scene, name, new Color3(r, g, b))));
        return m;
      },
      own: (name, hex) => {
        const m = plainMaterial(scene, name, Color3.FromHexString(hex));
        this.owned.push(m);
        return m;
      },
    };
    const dressed = outfit(rig, color);
    this.jacket = dressed.tint;
    for (const [name, meshes] of Object.entries(dressed.extras ?? {})) {
      this.extras.set(name, meshes);
      for (const mesh of meshes) mesh.setEnabled(false);
    }
  }
}
