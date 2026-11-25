import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { paintMesh } from "../../../render/paint";
import type { SiegeModel } from "../../pageDoors";

/** Height of the gun's pivot above the turntable. */
const PIVOT = 3.1;

/**
 * The rail battery: a compact twin-rail electromagnetic gun on a turret,
 * stainless and black. Two long steel rails with a slot between them, clamped
 * every metre, run out of a black breech with a capacitor bank each side; the
 * whole gun sits in a yoke on a squat stainless pedestal, with power cells and
 * a cooling stack behind. It does not swing over like a trebuchet: the gun
 * sits aimed almost level, kicks back when it fires, and settles while it
 * reloads. It fires glowing slugs, fast and nearly straight.
 *
 * Copied from the Meadow (2026-11-25) and changed from there; the two share no code.
 */
export function siegeModel(scene: Scene): SiegeModel {
  const steel: [number, number, number] = [0.78, 0.81, 0.85];
  const bright: [number, number, number] = [0.92, 0.94, 0.96];
  const black: [number, number, number] = [0.07, 0.075, 0.09];
  const dark: [number, number, number] = [0.2, 0.22, 0.26];
  const amber: [number, number, number] = [1, 0.62, 0.12];
  const charge: [number, number, number] = [0.35, 0.9, 1];
  const part = (mesh: Mesh, color: [number, number, number], x: number, y: number, z: number, rx = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.rotation.z = rz;
    return paintMesh(mesh, ...color);
  };
  const tube = (name: string, diameter: number, height: number, sides = 14) => CreateCylinder(name, { diameter, height, tessellation: sides }, scene);
  const box = (name: string, width: number, height: number, depth: number) => CreateBox(name, { width, height, depth }, scene);

  // Frame: an eight-sided black deck, a stainless slew ring and pedestal, and a yoke of two
  // cheeks that holds the gun by its trunnions. Power cells and a cooling stack ride behind
  // (-z); the gun shoots toward +z.
  const frameParts: Mesh[] = [];
  frameParts.push(part(tube("r-deck", 3.9, 0.14, 8), black, 0, 0.07, 0));
  frameParts.push(part(tube("r-ring", 2.7, 0.24, 24), steel, 0, 0.26, 0));
  frameParts.push(part(tube("r-ring-top", 2.3, 0.1, 24), dark, 0, 0.43, 0));
  frameParts.push(part(CreateCylinder("r-pedestal", { diameterBottom: 1.9, diameterTop: 1.35, height: 1.35, tessellation: 12 }, scene), steel, 0, 1.15, 0));
  frameParts.push(part(tube("r-collar", 1.5, 0.16, 12), black, 0, 1.9, 0));
  frameParts.push(part(box("r-saddle", 2.0, 0.3, 1.5), dark, 0, 2.1, 0));
  for (const side of [-1, 1]) {
    const x = side * 0.9;
    // A cheek: a tall plate, narrower at the top, with a black bearing cap where the trunnion sits.
    frameParts.push(part(box("r-cheek", 0.2, 1.3, 1.3), steel, x, 2.75, -0.05));
    frameParts.push(part(tube("r-bearing", 0.62, 0.26, 12), black, x, PIVOT, 0, 0, Math.PI / 2));
    frameParts.push(part(box("r-cheek-rib", 0.24, 0.1, 1.34), black, x, 2.3, -0.05));
    // Hazard marks on the deck, either side of the line of fire.
    frameParts.push(part(box("r-mark", 0.5, 0.03, 0.9), amber, side * 1.3, 0.15, 1.0));
    // An elevation ram from the saddle to the gun.
    frameParts.push(part(tube("r-ram", 0.14, 1.25, 8), bright, side * 0.55, 2.55, 0.62, 0.75));
  }
  // Power cells: three black boxes with stainless caps, and the cable up to the breech.
  for (let i = -1; i <= 1; i++) {
    frameParts.push(part(box("r-cell", 0.62, 1.0, 0.6), black, i * 0.72, 0.8, -1.25));
    frameParts.push(part(box("r-cell-cap", 0.66, 0.08, 0.64), steel, i * 0.72, 1.32, -1.25));
    frameParts.push(part(box("r-cell-light", 0.3, 0.06, 0.03), charge, i * 0.72, 1.1, -1.56));
  }
  frameParts.push(part(tube("r-cable", 0.12, 1.7, 6), dark, 0, 2.05, -0.95, -0.42));
  // The cooling stack: a finned post on one quarter.
  frameParts.push(part(tube("r-stack", 0.3, 1.9, 8), dark, -1.25, 1.25, -0.5));
  for (let i = 0; i < 5; i++) frameParts.push(part(tube("r-fin", 0.56, 0.05, 8), steel, -1.25, 1.1 + i * 0.24, -0.5));
  // The sensor mast on the other: a thin post with a flat panel that looks down range.
  frameParts.push(part(tube("r-mast", 0.07, 2.9, 6), dark, 1.3, 1.75, -0.7));
  frameParts.push(part(box("r-panel", 0.5, 0.36, 0.06), black, 1.3, 3.3, -0.66));
  frameParts.push(part(box("r-panel-eye", 0.14, 0.1, 0.03), amber, 1.3, 3.3, -0.62));

  // The gun, drawn upright from the pivot: muzzle up, breech below. Laid over to fire, what is
  // at -z here is on top of the gun and what is at +z is underneath.
  const armParts: Mesh[] = [
    part(tube("r-trunnion", 0.36, 1.7, 12), dark, 0, 0, 0, 0, Math.PI / 2),
    // The breech: a black block the rails run out of, with a stainless back plate.
    part(box("r-breech", 1.05, 1.7, 0.95), black, 0, -0.25, 0),
    part(box("r-back-plate", 0.9, 0.12, 0.8), steel, 0, -1.16, 0),
    part(tube("r-buffer", 0.34, 0.5, 10), dark, 0, -1.45, 0),
    // The two rails, with the slot between them the slug rides in.
    part(box("r-rail", 0.2, 4.7, 0.42), steel, -0.24, 2.9, 0),
    part(box("r-rail", 0.2, 4.7, 0.42), steel, 0.24, 2.9, 0),
    // The slot glows while the gun holds its charge.
    part(box("r-slot", 0.1, 4.3, 0.12), charge, 0, 2.8, 0),
    // A stiff black spine along the top and a lighter one beneath.
    part(box("r-spine", 0.3, 3.6, 0.14), black, 0, 2.4, -0.27),
    part(box("r-keel", 0.16, 3.0, 0.1), dark, 0, 2.1, 0.25),
    // The muzzle: black shrouds on the rail tips, open between.
    part(box("r-muzzle", 0.26, 0.5, 0.52), black, -0.26, 5.05, 0),
    part(box("r-muzzle", 0.26, 0.5, 0.52), black, 0.26, 5.05, 0),
    // The sight on top of the breech.
    part(box("r-sight", 0.3, 0.6, 0.2), dark, 0, 0.35, -0.56),
    part(box("r-sight-eye", 0.18, 0.04, 0.12), amber, 0, 0.67, -0.56),
  ];
  // Clamps hold the rails against the force that would throw them apart.
  for (let i = 0; i < 5; i++) {
    const y = 0.95 + i * 0.9;
    armParts.push(part(box("r-clamp", 0.84, 0.16, 0.56), black, 0, y, 0));
    armParts.push(part(box("r-clamp-bolt", 0.9, 0.07, 0.12), bright, 0, y, 0));
  }
  // Capacitor banks: three stainless drums down each side of the breech.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      armParts.push(part(tube("r-capacitor", 0.36, 0.44, 10), bright, side * 0.7, -0.8 + i * 0.52, 0));
      armParts.push(part(tube("r-capacitor-band", 0.39, 0.08, 10), black, side * 0.7, -0.8 + i * 0.52, 0));
    }
  }

  // The slug: white-hot, it lights nothing but is seen from anywhere, with a blue sheath of charged air round it.
  const slugMaterial = new StandardMaterial("mojave-slug", scene);
  slugMaterial.disableLighting = true;
  slugMaterial.emissiveColor = new Color3(1, 0.97, 0.86);
  slugMaterial.diffuseColor = Color3.Black();
  slugMaterial.specularColor = Color3.Black();
  slugMaterial.fogEnabled = false;
  const sheathMaterial = new StandardMaterial("mojave-slug-sheath", scene);
  sheathMaterial.disableLighting = true;
  sheathMaterial.emissiveColor = new Color3(0.3, 0.75, 1);
  sheathMaterial.diffuseColor = Color3.Black();
  sheathMaterial.specularColor = Color3.Black();
  sheathMaterial.alpha = 0.4;
  sheathMaterial.fogEnabled = false;

  return {
    frame: Mesh.MergeMeshes(frameParts, true, true)!,
    arm: Mesh.MergeMeshes(armParts, true, true)!,
    pivot: PIVOT,
    // Aimed a little above level; a short kick up as it fires, then it settles.
    cocked: 1.44,
    thrown: 1.27,
    swing: 0.06,
    pointed: true,
    /** A slug: a short glowing bar, nose toward +z, in a longer sheath that trails behind it. */
    stone(radius) {
      const mesh = CreateCapsule("mojave-slug", { radius: radius * 0.42, height: radius * 3.2, tessellation: 8, subdivisions: 1, orientation: Vector3.Forward() }, scene);
      mesh.material = slugMaterial;
      mesh.isPickable = false;
      const sheath = CreateCapsule("mojave-slug-sheath", { radius: radius * 0.8, height: radius * 6, tessellation: 8, subdivisions: 1, orientation: Vector3.Forward() }, scene);
      sheath.material = sheathMaterial;
      sheath.isPickable = false;
      sheath.parent = mesh;
      sheath.position.z = -radius * 1.2;
      return mesh;
    },
  };
}
