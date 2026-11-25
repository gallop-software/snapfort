import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Outfit, OutfitRig } from "../../pageDoors";

/**
 * A Mars suit: sand-white and padded, dusted with rust, with a round helmet
 * and copper visor, dark boots and gloves, and an air pack on the back. The
 * player's colour is the chest piece and the bands on the arms, so builders
 * still tell each other apart.
 *
 * Folded on the pack are the wings: two long sails of pale fabric on dark
 * spars, in the player's colour at the tips. They are spread (the "glide"
 * extra) while a builder flies, which the air must be thick enough for.
 *
 * Copied from the Moon's suit; its rocket pack is an air pack here (nobody is
 * thrown into space on Mars).
 */
export function outfit(rig: OutfitRig, color: string): Outfit {
  const { scene, add, body } = rig;
  const white = rig.shared("suit-white", 0.93, 0.88, 0.8);
  const grey = rig.shared("suit-grey", 0.46, 0.38, 0.34);
  const dark = rig.shared("suit-dark", 0.2, 0.16, 0.16);
  const gold = rig.shared("suit-visor", 0.86, 0.5, 0.26);
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
  // Air pack: a box on the back with a valve each side.
  add(CreateBox("pack", { width: 0.46, height: 0.6, depth: 0.22 }, scene), grey, body, 0, 1.3, -0.33);
  add(CreateBox("pack-top", { width: 0.48, height: 0.08, depth: 0.24 }, scene), white, body, 0, 1.62, -0.33);
  for (const side of [-1, 1]) {
    add(CreateCylinder("nozzle", { diameterTop: 0.1, diameterBottom: 0.16, height: 0.14, tessellation: 10 }, scene), dark, body, side * 0.13, 0.95, -0.33);
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
  (visor.material as StandardMaterial).specularColor = new Color3(0.9, 0.7, 0.5);
  (visor.material as StandardMaterial).specularPower = 40;
  add(CreateBox("helmet-stripe", { width: 0.07, height: 0.03, depth: 0.3 }, scene), trim, body, 0, 2.075, -0.02);
  // Wings, spread from the pack: a spar and a sail each side, swept back a little, the tip in the player's colour.
  const sail = rig.shared("suit-sail", 0.95, 0.9, 0.8);
  // (Lit a little from within, so the undersides seen from below are not dark against the sky.)
  sail.emissiveColor = new Color3(0.42, 0.39, 0.33);
  const wings: Mesh[] = [];
  for (const side of [-1, 1]) {
    const wing = (mesh: Mesh, material: StandardMaterial, out: number, back: number, up: number) => {
      const m = add(mesh, material, body, side * out, 1.45 + up, -0.42 - back);
      m.rotation.y = side * 0.22;
      m.rotation.z = side * -0.1;
      wings.push(m);
    };
    wing(CreateBox("wing-spar", { width: 3.3, height: 0.07, depth: 0.09 }, scene), dark, 1.75, 0.02, 0.18);
    wing(CreateBox("wing-sail", { width: 2.3, height: 0.03, depth: 1.25 }, scene), sail, 1.35, 0.55, 0.12);
    wing(CreateBox("wing-outer", { width: 1.1, height: 0.03, depth: 0.8 }, scene), sail, 2.85, 0.5, 0.25);
    wing(CreateBox("wing-tip", { width: 0.34, height: 0.035, depth: 0.6 }, scene), trim, 3.5, 0.48, 0.31);
  }
  return { tint: trim, extras: { glide: wings } };
}
