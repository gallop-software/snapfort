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
const PIVOT = 3.4;

/**
 * A wooden trebuchet: an A-frame each side holding the axle, on two rails, and
 * an arm with a long beam and sling above the pivot and an iron counterweight
 * below. It throws grey stones.
 */
export function siegeModel(scene: Scene): SiegeModel {
  const wood: [number, number, number] = [0.6, 0.4, 0.24];
  const dark: [number, number, number] = [0.36, 0.24, 0.15];
  const iron: [number, number, number] = [0.42, 0.45, 0.5];
  const part = (mesh: Mesh, color: [number, number, number], x: number, y: number, z: number, rx = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    return paintMesh(mesh, ...color);
  };

  // Frame. Throws toward +z.
  const legLength = Math.hypot(1.6, PIVOT);
  const legTilt = Math.atan2(1.6, PIVOT);
  const frameParts: Mesh[] = [];
  for (const side of [-1, 1]) {
    const x = side * 0.95;
    frameParts.push(part(CreateBox("t-rail", { width: 0.3, height: 0.3, depth: 3.8 }, scene), dark, x, 0.15, 0));
    frameParts.push(part(CreateBox("t-leg", { width: 0.24, height: legLength, depth: 0.24 }, scene), wood, x, PIVOT / 2, 0.8, legTilt));
    frameParts.push(part(CreateBox("t-leg", { width: 0.24, height: legLength, depth: 0.24 }, scene), wood, x, PIVOT / 2, -0.8, -legTilt));
  }
  frameParts.push(part(CreateBox("t-brace", { width: 2.2, height: 0.22, depth: 0.22 }, scene), dark, 0, 0.3, 1.5));
  frameParts.push(part(CreateBox("t-brace", { width: 2.2, height: 0.22, depth: 0.22 }, scene), dark, 0, 0.3, -1.5));
  const axle = CreateCylinder("t-axle", { diameter: 0.22, height: 2.3, tessellation: 8 }, scene);
  axle.rotation.z = Math.PI / 2;
  frameParts.push(part(axle, iron, 0, PIVOT, 0));

  // Arm, drawn upright from the pivot: the long beam and sling up, the counterweight below.
  const armParts: Mesh[] = [
    part(CreateBox("t-beam", { width: 0.22, height: 6, depth: 0.22 }, scene), wood, 0, 1.6, 0),
    part(CreateBox("t-weight", { width: 1.1, height: 1, depth: 1 }, scene), iron, 0, -1.5, 0),
    part(CreateBox("t-hanger", { width: 0.12, height: 0.6, depth: 0.12 }, scene), dark, 0, -0.9, 0),
    part(CreateBox("t-sling", { width: 0.05, height: 0.05, depth: 1.2 }, scene), dark, 0, 4.6, -0.55),
  ];

  const stoneMaterial = new StandardMaterial("stone", scene);
  stoneMaterial.diffuseColor = new Color3(0.38, 0.37, 0.36);
  stoneMaterial.specularColor = Color3.Black();

  return {
    frame: Mesh.MergeMeshes(frameParts, true, true)!,
    arm: Mesh.MergeMeshes(armParts, true, true)!,
    pivot: PIVOT,
    cocked: -2.3,
    thrown: 0.95,
    swing: 0.45,
    stone(radius) {
      const mesh = CreateSphere("stone", { diameter: radius * 2.4, segments: 8 }, scene);
      mesh.material = stoneMaterial;
      return mesh;
    },
  };
}
