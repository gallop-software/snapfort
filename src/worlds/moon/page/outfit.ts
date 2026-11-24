import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Outfit, OutfitRig } from "../../pageDoors";

/**
 * A space suit: white and padded, with a round helmet and gold visor, grey
 * boots and gloves, and a rocket pack on the back. The player's colour is the
 * chest piece and the bands on the arms, so builders still tell each other
 * apart. The pack's two rockets burn (the "glide" extra) while a builder flies
 * back down from space.
 */
export function outfit(rig: OutfitRig, color: string): Outfit {
  const { scene, add, body } = rig;
  const white = rig.shared("suit-white", 0.93, 0.94, 0.96);
  const grey = rig.shared("suit-grey", 0.5, 0.52, 0.56);
  const dark = rig.shared("suit-dark", 0.16, 0.17, 0.21);
  const gold = rig.shared("suit-visor", 0.95, 0.68, 0.2);
  const red = rig.shared("suit-red", 0.82, 0.22, 0.18);
  const trim = rig.own("suit-trim", color);
  const limb = (name: string, radius: number, length: number) => CreateCapsule(name, { radius, height: length, tessellation: 10, subdivisions: 1 }, scene);

  // Legs: padded, with a grey knee ring and heavy boots.
  for (let side = 0; side < 2; side++) {
    const hip = rig.hips[side]!, knee = rig.knees[side]!;
    add(limb("thigh", 0.135, 0.5), white, hip, 0, -0.22, 0);
    add(CreateCylinder("knee-ring", { diameter: 0.27, height: 0.07, tessellation: 12 }, scene), grey, knee, 0, 0, 0);
    add(limb("shin", 0.12, 0.46), white, knee, 0, -0.2, 0);
    add(CreateBox("boot", { width: 0.25, height: 0.16, depth: 0.36 }, scene), grey, knee, 0, -0.38, 0.04);
  }
  // Body: the chest in the player's colour, a control box on the front, a grey belt.
  add(CreateCapsule("torso", { radius: 0.27, height: 0.8, tessellation: 14, subdivisions: 1 }, scene), white, body, 0, 1.2, 0);
  add(CreateCylinder("chest", { diameter: 0.58, height: 0.3, tessellation: 14 }, scene), trim, body, 0, 1.26, 0);
  add(CreateBox("controls", { width: 0.22, height: 0.16, depth: 0.08 }, scene), grey, body, 0, 1.26, 0.27);
  add(CreateBox("control-light", { width: 0.05, height: 0.05, depth: 0.02 }, scene), red, body, 0.05, 1.29, 0.315);
  add(CreateCylinder("belt", { diameter: 0.54, height: 0.08, tessellation: 14 }, scene), grey, body, 0, 0.94, 0);
  // Rocket pack: a box on the back with a nozzle each side.
  add(CreateBox("pack", { width: 0.46, height: 0.6, depth: 0.22 }, scene), grey, body, 0, 1.3, -0.33);
  add(CreateBox("pack-top", { width: 0.48, height: 0.08, depth: 0.24 }, scene), white, body, 0, 1.62, -0.33);
  const flames: Mesh[] = [];
  const fire = rig.shared("suit-flame", 1, 0.62, 0.15);
  // Flames glow on their own, whatever the light.
  fire.emissiveColor = new Color3(1, 0.62, 0.15);
  fire.disableLighting = true;
  const core = rig.shared("suit-flame-core", 1, 0.95, 0.7);
  core.emissiveColor = new Color3(1, 0.95, 0.7);
  core.disableLighting = true;
  for (const side of [-1, 1]) {
    add(CreateCylinder("nozzle", { diameterTop: 0.1, diameterBottom: 0.16, height: 0.14, tessellation: 10 }, scene), dark, body, side * 0.13, 0.95, -0.33);
    flames.push(add(CreateCylinder("flame", { diameterTop: 0.2, diameterBottom: 0, height: 1.1, tessellation: 8 }, scene), fire, body, side * 0.13, 0.33, -0.33));
    flames.push(add(CreateCylinder("flame-core", { diameterTop: 0.1, diameterBottom: 0, height: 0.55, tessellation: 6 }, scene), core, body, side * 0.13, 0.6, -0.33));
  }
  // Arms: a band of the player's colour above the elbow, grey gloves.
  for (let side = 0; side < 2; side++) {
    const shoulder = rig.shoulders[side]!, elbow = rig.elbows[side]!;
    add(limb("upper-arm", 0.1, 0.36), white, shoulder, 0, -0.15, 0);
    add(CreateCylinder("arm-band", { diameter: 0.215, height: 0.09, tessellation: 12 }, scene), trim, shoulder, 0, -0.14, 0);
    add(limb("forearm", 0.09, 0.32), white, elbow, 0, -0.13, 0);
    add(CreateSphere("glove", { diameter: 0.18, segments: 8 }, scene), grey, elbow, 0, -0.31, 0.01);
  }
  // Helmet: a white ball on a grey collar, the gold visor a bulge on the front.
  add(CreateCylinder("collar", { diameter: 0.34, height: 0.1, tessellation: 14 }, scene), grey, body, 0, 1.62, 0);
  add(CreateSphere("helmet", { diameter: 0.5, segments: 16 }, scene), white, body, 0, 1.83, 0);
  const visor = add(CreateSphere("visor", { diameter: 0.42, segments: 14 }, scene), gold, body, 0, 1.84, 0.125);
  visor.scaling.set(1, 0.7, 0.75);
  // The visor shines, unlike everything else a builder wears.
  (visor.material as StandardMaterial).specularColor = new Color3(0.9, 0.8, 0.5);
  (visor.material as StandardMaterial).specularPower = 40;
  add(CreateBox("helmet-stripe", { width: 0.07, height: 0.03, depth: 0.3 }, scene), trim, body, 0, 2.075, -0.02);
  return { tint: trim, extras: { glide: flames } };
}
