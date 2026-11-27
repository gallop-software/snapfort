import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { Avatar } from "../../../render/avatar";
import type { Outfit, OutfitRig } from "../../pageDoors";
import { UNITS } from "../kit";
import { Many, place } from "./many";

/**
 * Troopers: soldiers on the skeleton every builder has, moving as the
 * generals do. They walk and run with arms and legs swinging, stand easy with
 * the rifle across them, bring it up to fire, flinch when a bullet finds
 * them, and fly flailing from a blast, land on their backs and get up.
 *
 * There may be hundreds in view, so no Trooper has a body of its own. The
 * figure is posed once for each frame of each movement (a flipbook: a run
 * cycle, the flail of a throw, and single poses) and each pose is one mesh
 * drawn for every Trooper in it at that moment, as distant builders are drawn
 * (render/standIns.ts). The uniform's marks take each army's colour.
 */

/** Frames in the run cycle, the walk cycle, and the flail of a throw. */
const RUN_FRAMES = 16;
const WALK_FRAMES = 12;
const FLAIL_FRAMES = 6;
/** The speeds the run and the walk were posed at, m/s: a Trooper's own, and half of it. */
const RUN_SPEED = UNITS.trooper.speed;
const WALK_SPEED = RUN_SPEED / 2;
/** How long one stride cycle takes at a speed (as a general's stride goes: render/avatar.ts), s. */
const cycleAt = (speed: number) => (Math.PI * 2) / (7 + Math.min(1, speed / 26) * 11);
/** How far one stride cycle carries a Trooper running, and walking, m: the feet keep to the ground they cover. */
const RUN_STRIDE = RUN_SPEED * cycleAt(RUN_SPEED);
const WALK_STRIDE = WALK_SPEED * cycleAt(WALK_SPEED);
/** Faster than this, a Trooper runs; slower, walks, m/s. */
const RUN_FROM = (RUN_SPEED + WALK_SPEED) / 2;
/** Where the body's middle is above the feet: a thrown Trooper turns over about it. */
export const TROOPER_MIDDLE = 0.95;

export const POSE_STAND = 0, POSE_AIM = 1, POSE_FLINCH = 2, POSE_DOWN = 3, POSE_RUN = 4, POSE_WALK = POSE_RUN + RUN_FRAMES, POSE_FLAIL = POSE_WALK + WALK_FRAMES;
const POSES = POSE_FLAIL + FLAIL_FRAMES;

/** How far through a stride cycle (0..1, on and on) moving `metres` further takes a Trooper going at `speed`. */
export const strideOn = (metres: number, speed: number) => metres / (speed >= RUN_FROM ? RUN_STRIDE : WALK_STRIDE);
/** The frame of the run or the walk a Trooper `stride` cycles on is in: the one its feet are in for the ground it has covered. */
export const strideFrame = (stride: number, speed: number) => {
  const p = stride - Math.floor(stride);
  return speed >= RUN_FROM ? POSE_RUN + (Math.floor(p * RUN_FRAMES) % RUN_FRAMES) : POSE_WALK + (Math.floor(p * WALK_FRAMES) % WALK_FRAMES);
};
/** Which frame of the flail, `seconds` into a throw. */
export const flailFrame = (seconds: number, id: number) => POSE_FLAIL + ((Math.floor(seconds / 0.09) + id) % FLAIL_FRAMES);

/**
 * A soldier's uniform, plainly not a general's: sand fatigues, a dark vest,
 * an open helmet with goggles, a pack, and a rifle in the right hand. The
 * army's colour is a band round the helmet, a patch on each shoulder and a
 * panel on the chest. Few parts and few sides to them: there are many Troopers.
 */
function uniform(rig: OutfitRig, color: string): Outfit {
  const { scene, add, body } = rig;
  const cloth = rig.shared("mojave-fatigues", 0.6, 0.55, 0.44);
  const vest = rig.shared("mojave-vest", 0.24, 0.26, 0.24);
  const dark = rig.shared("mojave-kit", 0.1, 0.11, 0.12);
  const skin = rig.shared("mojave-face", 0.78, 0.6, 0.48);
  const glass = rig.shared("mojave-goggles", 0.25, 0.8, 0.85);
  const tint = rig.own("mojave-trooper-tint", color);
  const limb = (name: string, radius: number, length: number) => CreateCapsule(name, { radius, height: length, tessellation: 6, subdivisions: 1, capSubdivisions: 2 }, scene);

  for (let side = 0; side < 2; side++) {
    const hip = rig.hips[side]!, knee = rig.knees[side]!;
    add(limb("thigh", 0.11, 0.5), cloth, hip, 0, -0.22, 0);
    add(limb("shin", 0.095, 0.46), cloth, knee, 0, -0.2, 0);
    add(CreateBox("knee-pad", { width: 0.17, height: 0.14, depth: 0.08 }, scene), vest, knee, 0, -0.02, 0.07);
    add(CreateBox("boot", { width: 0.2, height: 0.16, depth: 0.32 }, scene), dark, knee, 0, -0.38, 0.05);
  }
  add(CreateBox("torso", { width: 0.42, height: 0.62, depth: 0.26 }, scene), cloth, body, 0, 1.2, 0);
  add(CreateBox("vest", { width: 0.46, height: 0.4, depth: 0.31 }, scene), vest, body, 0, 1.27, 0);
  add(CreateBox("chest-mark", { width: 0.2, height: 0.14, depth: 0.02 }, scene), tint, body, 0.09, 1.36, 0.165);
  add(CreateBox("belt", { width: 0.45, height: 0.09, depth: 0.29 }, scene), dark, body, 0, 0.95, 0);
  for (const side of [-1, 1]) add(CreateBox("pouch", { width: 0.11, height: 0.13, depth: 0.08 }, scene), vest, body, side * 0.14, 1.06, 0.17);
  add(CreateBox("pack", { width: 0.36, height: 0.44, depth: 0.18 }, scene), vest, body, 0, 1.28, -0.24);
  add(CreateBox("bedroll", { width: 0.4, height: 0.12, depth: 0.14 }, scene), cloth, body, 0, 1.56, -0.24);
  for (let side = 0; side < 2; side++) {
    const shoulder = rig.shoulders[side]!, elbow = rig.elbows[side]!;
    const out = side === 0 ? -1 : 1;
    add(limb("upper-arm", 0.085, 0.36), cloth, shoulder, 0, -0.15, 0);
    add(CreateBox("shoulder-mark", { width: 0.05, height: 0.14, depth: 0.18 }, scene), tint, shoulder, out * 0.075, -0.08, 0);
    add(limb("forearm", 0.075, 0.32), cloth, elbow, 0, -0.13, 0);
    add(CreateBox("glove", { width: 0.12, height: 0.12, depth: 0.12 }, scene), dark, elbow, 0, -0.31, 0.01);
  }
  // The rifle, in the right hand, along the forearm: where the arm points, it points.
  const hand = rig.elbows[1]!;
  add(CreateBox("rifle", { width: 0.07, height: 0.86, depth: 0.1 }, scene), dark, hand, -0.02, -0.42, 0.07);
  add(CreateBox("rifle-stock", { width: 0.06, height: 0.22, depth: 0.16 }, scene), dark, hand, -0.02, 0.0, 0.1);
  add(CreateBox("rifle-magazine", { width: 0.05, height: 0.1, depth: 0.2 }, scene), vest, hand, -0.02, -0.3, 0.18);
  add(CreateCylinder("rifle-muzzle", { diameter: 0.045, height: 0.2, tessellation: 5 }, scene), dark, hand, -0.02, -0.94, 0.07);
  // Head: a face under an open helmet, goggles pushed down, the army's band round the helmet.
  add(CreateBox("neck", { width: 0.16, height: 0.1, depth: 0.16 }, scene), skin, body, 0, 1.58, 0);
  add(CreateBox("head", { width: 0.24, height: 0.24, depth: 0.25 }, scene), skin, body, 0, 1.72, 0.01);
  add(CreateBox("goggles", { width: 0.25, height: 0.07, depth: 0.04 }, scene), glass, body, 0, 1.75, 0.13);
  const helmet = add(CreateSphere("helmet", { diameter: 0.4, segments: 6, slice: 0.55 }, scene), vest, body, 0, 1.76, 0);
  helmet.scaling.set(1, 1, 1.1);
  add(CreateCylinder("helmet-band", { diameter: 0.415, height: 0.06, tessellation: 10 }, scene), tint, body, 0, 1.805, 0).scaling.set(1, 1, 1.1);
  return { tint };
}

export class Troopers {
  private readonly marks: Many[] = [];
  private readonly rest: Many[] = [];

  constructor(scene: Scene, shadows: ShadowGenerator) {
    const hold: { rig?: OutfitRig } = {};
    const model = new Avatar(scene, null, (rig, color) => ((hold.rig = rig), uniform(rig, color)), "#ffffff");
    const rig = hold.rig!;
    const material = new StandardMaterial("mojave-trooper", scene);
    material.specularColor = Color3.Black();
    // Every part but the army's marks is painted its own colour, so they merge into one mesh.
    for (const mesh of model.partsForBaking().rest) {
      const c = (mesh.material as StandardMaterial).diffuseColor;
      const colors = new Float32Array(mesh.getTotalVertices() * 4);
      for (let i = 0; i < colors.length; i += 4) colors.set([c.r, c.g, c.b, 1], i);
      mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    }
    const origin = (y = 0) => {
      model.root.position.set(0, y, 0);
      model.root.rotation.set(0, 0, 0);
    };
    const bake = (name: string) => {
      const parts = model.partsForBaking();
      const merge = (meshes: Mesh[], suffix: string, tinted: boolean) => {
        const merged = Mesh.MergeMeshes(meshes, false, true)!;
        merged.name = `mojave-trooper-${name}${suffix}`;
        merged.material = material;
        merged.receiveShadows = !tinted;
        if (!tinted) shadows.addShadowCaster(merged);
        return new Many(merged, tinted, 32);
      };
      this.marks.push(merge(parts.jacket, "-marks", true));
      this.rest.push(merge(parts.rest, "", false));
    };
    const arm = (side: number, shoulderX: number, shoulderZ: number, elbowX: number) => {
      rig.shoulders[side]!.rotation.set(shoulderX, 0, shoulderZ);
      rig.elbows[side]!.rotation.set(elbowX, 0, 0);
    };

    // Standing easy: the rifle held low across the body, the left hand to it.
    model.setPose("stand");
    arm(1, -0.3, -0.18, -1.05);
    arm(0, -0.35, 0.3, -0.9);
    bake("stand");
    // Firing: the rifle up and level, the left hand under it, leaning into it.
    model.setPose("stand");
    arm(1, -1.36, -0.12, -0.2);
    arm(0, -1.2, 0.5, -0.45);
    rig.body.rotation.x = 0.07;
    bake("aim");
    // A bullet finds them: knocked back on their heels, arms thrown up.
    model.setPose("stand");
    rig.body.rotation.x = -0.32;
    arm(1, -0.9, -0.5, -0.7);
    arm(0, -0.7, 0.6, -0.8);
    rig.hips[0]!.rotation.x = -0.45;
    rig.knees[0]!.rotation.x = 0.5;
    bake("flinch");
    rig.body.rotation.x = 0;
    // Down: flat on their back, arms and legs out.
    model.animate(0.016, 0, 0, 0, true, false, 1);
    model.root.position.set(0, 0, 0);
    bake("down");
    // Running, then walking: the stride a builder has at a Trooper's speed, a frame at a time through one whole cycle (a
    // few strides first, each time, so it has settled into it).
    model.animate(0.016, 0, 0, 0, true);
    origin();
    for (const [name, speed, frames] of [["run", RUN_SPEED, RUN_FRAMES], ["walk", WALK_SPEED, WALK_FRAMES]] as const) {
      const dt = cycleAt(speed) / frames;
      for (let i = 0; i < frames * 5; i++) model.animate(dt, 0, 0, speed, true);
      for (let i = 0; i < frames; i++) {
        model.animate(dt, 0, 0, speed, true);
        origin();
        bake(`${name}-${i}`);
      }
    }
    // Thrown: arms and legs flailing, about the middle of the body (the turning over is done as each is drawn).
    for (let i = 0; i < FLAIL_FRAMES; i++) {
      model.animate(0.09, 0, 0, 0, false, true);
      origin(-TROOPER_MIDDLE);
      bake(`flail-${i}`);
    }
    model.dispose();
    if (this.rest.length !== POSES) throw new Error("Troopers: a pose is missing");
  }

  begin(): void {
    for (const m of this.marks) m.begin();
    for (const m of this.rest) m.begin();
  }

  /** One Trooper in a pose: feet (or, flailing, the body's middle) at a spot, turned, and their army's colour. */
  add(pose: number, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, r: number, g: number, b: number, scale = 1): void {
    const rest = this.rest[pose]!, marks = this.marks[pose]!;
    const i = rest.add();
    place(rest.matrices, i, x, y, z, yaw, pitch, roll, scale, scale, scale);
    const j = marks.add();
    marks.matrices.set(rest.matrices.subarray(i * 16, i * 16 + 16), j * 16);
    marks.colors!.set([r, g, b, 1], j * 4);
  }

  end(): void {
    for (const m of this.marks) m.end();
    for (const m of this.rest) m.end();
  }
}
