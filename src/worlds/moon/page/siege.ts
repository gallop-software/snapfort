import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { paintMesh } from "../../../render/paint";
import type { SiegeModel } from "../../pageDoors";

/** Height of the arm's pivot above the turntable. */
const PIVOT = 3.2;

/**
 * The Moon's launcher: a white tubular tower on four splayed legs with gold
 * foil round its base, and a long boom on a pivot: a throwing cup on the long
 * end, a tank of ballast on the short one, a red band to see it swing by. It
 * throws slugs of baked moon dust.
 */
export function siegeModel(scene: Scene): SiegeModel {
  const white: [number, number, number] = [0.9, 0.91, 0.93];
  const grey: [number, number, number] = [0.42, 0.44, 0.5];
  const gold: [number, number, number] = [0.9, 0.68, 0.24];
  const red: [number, number, number] = [0.82, 0.22, 0.18];
  const dark: [number, number, number] = [0.17, 0.18, 0.22];
  const part = (mesh: Mesh, color: [number, number, number], x: number, y: number, z: number, rx = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.rotation.z = rz;
    return paintMesh(mesh, ...color);
  };
  const tube = (name: string, diameter: number, height: number) => CreateCylinder(name, { diameter, height, tessellation: 10 }, scene);

  // Frame: four legs meeting two cheek plates that hold the axle, pads on the feet. Throws toward +z.
  const frameParts: Mesh[] = [];
  const spread = 1.45, cheek = 0.62;
  const legLength = Math.hypot(spread, PIVOT - 0.1);
  const legTilt = Math.atan2(spread, PIVOT - 0.1);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      frameParts.push(part(tube("l-leg", 0.17, legLength), white, side * cheek, PIVOT / 2, end * spread * 0.5, end * legTilt));
      frameParts.push(part(CreateCylinder("l-pad", { diameter: 0.6, height: 0.1, tessellation: 12 }, scene), grey, side * cheek, 0.05, end * spread));
    }
    frameParts.push(part(CreateBox("l-cheek", { width: 0.1, height: 0.7, depth: 0.55 }, scene), grey, side * cheek, PIVOT, 0));
    frameParts.push(part(tube("l-tie", 0.1, spread * 2), white, side * cheek, 0.55, 0, Math.PI / 2));
  }
  frameParts.push(part(tube("l-cross", 0.1, cheek * 2), white, 0, 0.55, spread * 0.82, 0, Math.PI / 2));
  frameParts.push(part(tube("l-cross", 0.1, cheek * 2), white, 0, 0.55, -spread * 0.82, 0, Math.PI / 2));
  // The power pack between the legs, wrapped in gold foil, with a dish on top.
  frameParts.push(part(CreateBox("l-pack", { width: 0.95, height: 0.7, depth: 1.1 }, scene), gold, 0, 0.5, -0.1));
  frameParts.push(part(CreateCylinder("l-dish", { diameterTop: 0.7, diameterBottom: 0.12, height: 0.22, tessellation: 12 }, scene), white, 0, 1.0, -0.35));
  frameParts.push(part(tube("l-axle", 0.2, cheek * 2 + 0.3), dark, 0, PIVOT, 0, 0, Math.PI / 2));

  // Arm, drawn upright from the pivot: the boom and cup up, the ballast tank below.
  const armParts: Mesh[] = [
    part(tube("l-boom", 0.2, 5.9), white, 0, 1.75, 0),
    part(tube("l-band", 0.26, 0.5), red, 0, 3.6, 0),
    part(CreateCylinder("l-cup", { diameterTop: 0.95, diameterBottom: 0.45, height: 0.5, tessellation: 12 }, scene), grey, 0, 4.85, 0),
    part(tube("l-tank", 0.95, 1.1), gold, 0, -1.25, 0),
    part(CreateSphere("l-tank-end", { diameter: 0.95, segments: 10 }, scene), gold, 0, -1.8, 0),
    part(tube("l-stub", 0.2, 0.9), white, 0, -0.45, 0),
  ];

  const slugMaterial = new StandardMaterial("slug", scene);
  slugMaterial.diffuseColor = new Color3(0.62, 0.61, 0.6);
  slugMaterial.specularColor = Color3.Black();

  return {
    frame: Mesh.MergeMeshes(frameParts, true, true)!,
    arm: Mesh.MergeMeshes(armParts, true, true)!,
    pivot: PIVOT,
    cocked: -2.2,
    thrown: 0.9,
    swing: 0.4,
    stone(radius) {
      const mesh = CreateSphere("slug", { diameter: radius * 2.4, segments: 8 }, scene);
      mesh.material = slugMaterial;
      return mesh;
    },
  };
}
