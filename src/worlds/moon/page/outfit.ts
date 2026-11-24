import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Outfit, OutfitRig } from "../../pageDoors";

/**
 * An original builder: work jacket in the player's colour, navy trousers, teal
 * tool pack and a sunflower-yellow hard hat. Human proportions, built from
 * simple shapes hung on the shared skeleton.
 */
export function outfit(rig: OutfitRig, color: string): Outfit {
  const { scene, add, body } = rig;
  const navy = rig.shared("navy", 0.17, 0.22, 0.33);
  const skin = rig.shared("skin", 0.87, 0.67, 0.52);
  const sun = rig.shared("sun", 1, 0.79, 0.22);
  const teal = rig.shared("teal", 0.18, 0.56, 0.55);
  const ink = rig.shared("ink", 0.12, 0.13, 0.17);
  const cream = rig.shared("cream", 1, 0.95, 0.85);
  const jacket = rig.own("jacket", color);
  const limb = (name: string, radius: number, length: number) => CreateCapsule(name, { radius, height: length, tessellation: 10, subdivisions: 1 }, scene);

  // Legs: thigh from the hip, shin from the knee, boot on the shin.
  for (let side = 0; side < 2; side++) {
    const hip = rig.hips[side]!, knee = rig.knees[side]!;
    add(limb("thigh", 0.115, 0.5), navy, hip, 0, -0.22, 0);
    add(CreateSphere("kneecap", { diameter: 0.21, segments: 8 }, scene), navy, knee, 0, 0, 0.01);
    add(limb("shin", 0.1, 0.46), navy, knee, 0, -0.2, 0);
    add(CreateBox("boot", { width: 0.2, height: 0.12, depth: 0.32 }, scene), ink, knee, 0, -0.39, 0.05);
  }
  // Body.
  add(CreateCapsule("torso", { radius: 0.24, height: 0.78, tessellation: 14, subdivisions: 1 }, scene), jacket, body, 0, 1.2, 0);
  add(CreateCylinder("stripe", { diameter: 0.5, height: 0.06, tessellation: 14 }, scene), cream, body, 0, 1.12, 0);
  add(CreateCylinder("belt", { diameter: 0.46, height: 0.08, tessellation: 14 }, scene), ink, body, 0, 0.92, 0);
  add(CreateBox("pack", { width: 0.36, height: 0.44, depth: 0.18 }, scene), teal, body, 0, 1.24, -0.27);
  add(CreateBox("pack-flap", { width: 0.38, height: 0.1, depth: 0.2 }, scene), cream, body, 0, 1.42, -0.27);
  // Arms: upper arm from the shoulder, forearm and hand from the elbow.
  for (let side = 0; side < 2; side++) {
    const shoulder = rig.shoulders[side]!, elbow = rig.elbows[side]!;
    add(limb("upper-arm", 0.085, 0.36), jacket, shoulder, 0, -0.15, 0);
    add(limb("forearm", 0.075, 0.32), jacket, elbow, 0, -0.13, 0);
    add(CreateSphere("hand", { diameter: 0.15, segments: 8 }, scene), skin, elbow, 0, -0.31, 0.01);
  }
  // Head and hard hat.
  add(CreateCylinder("neck", { diameter: 0.14, height: 0.1, tessellation: 10 }, scene), skin, body, 0, 1.6, 0);
  add(CreateSphere("head", { diameter: 0.34, segments: 14 }, scene), skin, body, 0, 1.76, 0.01);
  for (const side of [-1, 1]) add(CreateSphere("eye", { diameter: 0.045, segments: 6 }, scene), ink, body, side * 0.065, 1.78, 0.165);
  add(CreateSphere("hat", { diameter: 0.4, segments: 14, slice: 0.5 }, scene), sun, body, 0, 1.82, 0);
  add(CreateCylinder("brim", { diameter: 0.46, height: 0.035, tessellation: 18 }, scene), sun, body, 0, 1.83, 0.03);
  add(CreateBox("crest", { width: 0.06, height: 0.05, depth: 0.32 }, scene), sun, body, 0, 2.02, 0);
  return { tint: jacket };
}
