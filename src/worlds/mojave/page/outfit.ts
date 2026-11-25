import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Outfit, OutfitRig } from "../../pageDoors";

/**
 * A general of about 2080 in an armoured field suit: a sand-grey undersuit
 * under dark graphite plates, a closed helmet with an amber visor, broad
 * shoulder plates, a radio pack with a whip aerial, and a short cape off the
 * left shoulder. The player's colour is the chest plate, a mark on each
 * shoulder, the stripe over the helmet and the cape's hem, so generals tell
 * each other apart across a battlefield. Human proportions, built from simple
 * shapes hung on the shared skeleton.
 *
 * Copied from the Meadow (2026-11-25) and changed from there; the two share no code.
 */
export function outfit(rig: OutfitRig, color: string): Outfit {
  const { scene, add, body } = rig;
  const plate = rig.shared("mojave-plate", 0.2, 0.22, 0.25);
  const black = rig.shared("mojave-black", 0.09, 0.1, 0.12);
  const cloth = rig.shared("mojave-cloth", 0.56, 0.52, 0.45);
  const steel = rig.shared("mojave-steel", 0.72, 0.75, 0.79);
  const amber = rig.shared("mojave-visor", 1, 0.62, 0.16);
  const cape = rig.shared("mojave-cape", 0.3, 0.31, 0.33);
  const tint = rig.own("mojave-tint", color);
  const limb = (name: string, radius: number, length: number) => CreateCapsule(name, { radius, height: length, tessellation: 10, subdivisions: 1 }, scene);

  // Legs: the undersuit, with a plate on the thigh, a knee guard, a greave on the shin and an armoured boot.
  for (let side = 0; side < 2; side++) {
    const hip = rig.hips[side]!, knee = rig.knees[side]!;
    const out = side === 0 ? -1 : 1;
    add(limb("thigh", 0.115, 0.5), cloth, hip, 0, -0.22, 0);
    add(CreateBox("thigh-plate", { width: 0.2, height: 0.3, depth: 0.1 }, scene), plate, hip, out * 0.03, -0.2, 0.075);
    add(CreateBox("holster", { width: 0.07, height: 0.22, depth: 0.16 }, scene), black, hip, out * 0.135, -0.16, 0);
    add(CreateSphere("knee-guard", { diameter: 0.24, segments: 8 }, scene), plate, knee, 0, 0, 0.02);
    add(limb("shin", 0.1, 0.46), cloth, knee, 0, -0.2, 0);
    add(CreateBox("greave", { width: 0.19, height: 0.3, depth: 0.12 }, scene), plate, knee, 0, -0.2, 0.06);
    add(CreateBox("boot", { width: 0.22, height: 0.15, depth: 0.34 }, scene), black, knee, 0, -0.38, 0.05);
    add(CreateBox("toe-cap", { width: 0.225, height: 0.08, depth: 0.1 }, scene), steel, knee, 0, -0.415, 0.18);
  }
  // Body: a dark armoured trunk, the chest plate in the player's colour standing proud of it, a collar ring and a belt of pouches.
  add(CreateCapsule("torso", { radius: 0.245, height: 0.78, tessellation: 14, subdivisions: 1 }, scene), plate, body, 0, 1.2, 0);
  const chest = add(CreateBox("chest-plate", { width: 0.4, height: 0.3, depth: 0.14 }, scene), tint, body, 0, 1.33, 0.185);
  chest.rotation.x = -0.1;
  add(CreateBox("chest-bar", { width: 0.42, height: 0.035, depth: 0.15 }, scene), black, body, 0, 1.165, 0.185);
  add(CreateBox("abdomen-plate", { width: 0.32, height: 0.14, depth: 0.1 }, scene), black, body, 0, 1.07, 0.2);
  add(CreateBox("chest-lamp", { width: 0.06, height: 0.035, depth: 0.02 }, scene), amber, body, 0.12, 1.42, 0.262);
  add(CreateCylinder("belt", { diameter: 0.5, height: 0.09, tessellation: 14 }, scene), black, body, 0, 0.94, 0);
  add(CreateBox("buckle", { width: 0.1, height: 0.07, depth: 0.03 }, scene), steel, body, 0, 0.94, 0.25);
  for (const side of [-1, 1]) add(CreateBox("pouch", { width: 0.1, height: 0.12, depth: 0.08 }, scene), cloth, body, side * 0.19, 0.93, 0.18);
  // On the back: a flat radio pack with a whip aerial.
  add(CreateBox("pack", { width: 0.34, height: 0.4, depth: 0.14 }, scene), black, body, 0, 1.28, -0.27);
  add(CreateBox("pack-rib", { width: 0.36, height: 0.05, depth: 0.16 }, scene), steel, body, 0, 1.4, -0.27);
  add(CreateCylinder("aerial", { diameter: 0.018, height: 0.62, tessellation: 5 }, scene), black, body, 0.14, 1.78, -0.3);
  // The cape: short, off the left shoulder, down the back to the hips, with the player's colour along its hem.
  const drape = add(CreateBox("cape", { width: 0.42, height: 0.72, depth: 0.025 }, scene), cape, body, -0.1, 1.2, -0.365);
  drape.rotation.x = -0.09;
  drape.rotation.z = 0.05;
  const hem = add(CreateBox("cape-hem", { width: 0.425, height: 0.07, depth: 0.03 }, scene), tint, body, -0.082, 0.865, -0.396);
  hem.rotation.x = -0.09;
  hem.rotation.z = 0.05;
  add(CreateBox("cape-clasp", { width: 0.3, height: 0.05, depth: 0.2 }, scene), cape, body, -0.14, 1.555, -0.24);
  // Arms: a broad plate over each shoulder with a mark in the player's colour, an armoured forearm and a dark glove.
  for (let side = 0; side < 2; side++) {
    const shoulder = rig.shoulders[side]!, elbow = rig.elbows[side]!;
    const out = side === 0 ? -1 : 1;
    add(limb("upper-arm", 0.085, 0.36), cloth, shoulder, 0, -0.15, 0);
    const pauldron = add(CreateSphere("shoulder-plate", { diameter: 0.3, segments: 10, slice: 0.55 }, scene), plate, shoulder, out * 0.02, -0.02, 0);
    pauldron.scaling.set(1, 0.85, 1.15);
    pauldron.rotation.z = out * -0.35;
    add(CreateBox("shoulder-mark", { width: 0.035, height: 0.11, depth: 0.2 }, scene), tint, shoulder, out * 0.125, -0.06, 0);
    add(CreateSphere("elbow-guard", { diameter: 0.19, segments: 8 }, scene), plate, elbow, 0, 0, -0.01);
    add(limb("forearm", 0.075, 0.32), cloth, elbow, 0, -0.13, 0);
    add(CreateBox("bracer", { width: 0.17, height: 0.2, depth: 0.17 }, scene), plate, elbow, 0, -0.14, 0);
    add(CreateSphere("glove", { diameter: 0.155, segments: 8 }, scene), black, elbow, 0, -0.31, 0.01);
  }
  // The left bracer carries the general's command screen.
  add(CreateBox("command-screen", { width: 0.02, height: 0.12, depth: 0.1 }, scene), amber, rig.elbows[0]!, -0.092, -0.14, 0);
  // Helmet: closed, dark, with a wide amber visor, a jaw guard and the player's stripe over the crown.
  add(CreateCylinder("collar", { diameter: 0.3, height: 0.1, tessellation: 12 }, scene), black, body, 0, 1.6, 0);
  const helmet = add(CreateSphere("helmet", { diameter: 0.42, segments: 14 }, scene), plate, body, 0, 1.79, 0);
  helmet.scaling.set(0.95, 1, 1.08);
  const visor = add(CreateSphere("visor", { diameter: 0.36, segments: 12 }, scene), amber, body, 0, 1.805, 0.075);
  visor.scaling.set(1.02, 0.36, 0.86);
  // The visor shines and glows a little, unlike everything else a general wears.
  const glass = visor.material as StandardMaterial;
  glass.emissiveColor = new Color3(0.42, 0.22, 0.03);
  glass.specularColor = new Color3(1, 0.85, 0.6);
  glass.specularPower = 48;
  add(CreateBox("jaw-guard", { width: 0.24, height: 0.1, depth: 0.12 }, scene), black, body, 0, 1.68, 0.16);
  for (const side of [-1, 1]) add(CreateCylinder("ear-piece", { diameter: 0.13, height: 0.05, tessellation: 10 }, scene), black, body, side * 0.2, 1.78, 0).rotation.z = Math.PI / 2;
  const stripe = add(CreateSphere("helmet-stripe", { diameter: 0.44, segments: 12 }, scene), tint, body, 0, 1.795, -0.012);
  stripe.scaling.set(0.17, 1, 1.06);
  return { tint };
}
