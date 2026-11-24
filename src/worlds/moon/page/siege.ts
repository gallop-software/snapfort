import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { paintMesh } from "../../../render/paint";
import type { SiegeModel } from "../../pageDoors";

/** Height of the barrel's pivot above the turntable. */
const PIVOT = 3.3;

/**
 * The Moon's launcher, as a rocket company would build it (user, 2026-11-23):
 * a long stainless and white barrel, black banded, with grid fins behind the
 * muzzle and a cluster of engine bells at the breech, slung between two white
 * towers on a black pad with landing legs. It does not swing over like a
 * trebuchet: the barrel sits aimed, kicks back when it fires, and settles
 * while it reloads. It fires big chunks of moon rock.
 */
export function siegeModel(scene: Scene): SiegeModel {
  const steel: [number, number, number] = [0.74, 0.77, 0.81];
  const white: [number, number, number] = [0.95, 0.96, 0.97];
  const black: [number, number, number] = [0.08, 0.085, 0.1];
  const dark: [number, number, number] = [0.24, 0.26, 0.3];
  const part = (mesh: Mesh, color: [number, number, number], x: number, y: number, z: number, rx = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.rotation.z = rz;
    return paintMesh(mesh, ...color);
  };
  const tube = (name: string, diameter: number, height: number, sides = 16) => CreateCylinder(name, { diameter, height, tessellation: sides }, scene);

  // Frame: a black six-sided pad with a steel ring, two white towers holding the barrel between
  // them, landing legs out to the corners, and a pressure tank behind. Shoots toward +z.
  const frameParts: Mesh[] = [];
  frameParts.push(part(tube("s-pad", 3.5, 0.16, 6), black, 0, 0.08, 0));
  frameParts.push(part(tube("s-ring", 2.5, 0.26, 24), steel, 0, 0.26, 0));
  for (const side of [-1, 1]) {
    const x = side * 0.78;
    // The tower: broad at the foot, slim at the top, black where it grips the barrel.
    frameParts.push(part(CreateCylinder("s-tower", { diameterBottom: 0.62, diameterTop: 0.34, height: PIVOT - 0.2, tessellation: 12 }, scene), white, x, (PIVOT - 0.2) / 2 + 0.3, 0));
    frameParts.push(part(tube("s-grip", 0.5, 0.7, 12), black, x, PIVOT + 0.1, 0));
    frameParts.push(part(tube("s-band", 0.52, 0.12, 12), black, x, 1.3, 0));
    // Landing legs, fore and aft.
    for (const end of [-1, 1]) {
      frameParts.push(part(tube("s-leg", 0.1, 2.05, 6), black, x + side * 0.12, 1.05, end * 0.85, end * 0.93));
      frameParts.push(part(tube("s-foot", 0.42, 0.08, 10), dark, x + side * 0.12, 0.22, end * 1.62));
    }
  }
  frameParts.push(part(CreateSphere("s-tank", { diameter: 0.8, segments: 12 }, scene), white, 0, 0.75, -1.05));
  frameParts.push(part(tube("s-pipe", 0.09, 1.3, 6), steel, 0, 1.3, -0.72, 0.5));

  // The barrel, drawn upright from the pivot: muzzle up, breech below.
  const armParts: Mesh[] = [
    part(tube("s-trunnion", 0.34, 1.5, 12), black, 0, 0, 0, 0, Math.PI / 2),
    // Stainless lower half, white upper half, a black band between and another near the muzzle.
    part(tube("s-barrel-low", 0.66, 3.1), steel, 0, 0.35, 0),
    part(tube("s-interstage", 0.69, 0.3), black, 0, 2.05, 0),
    part(tube("s-barrel-high", 0.62, 2.5), white, 0, 3.45, 0),
    part(tube("s-band-high", 0.65, 0.16), black, 0, 4.0, 0),
    part(CreateCylinder("s-muzzle", { diameterBottom: 0.66, diameterTop: 0.84, height: 0.5, tessellation: 16 }, scene), black, 0, 4.95, 0),
    // The breech: an engine section and three bells.
    part(tube("s-breech", 0.74, 0.5), black, 0, -1.45, 0),
    // Rails down both sides of the barrel.
    part(CreateBox("s-rail", { width: 0.07, height: 4.4, depth: 0.16 }, scene), dark, 0.36, 1.6, 0),
    part(CreateBox("s-rail", { width: 0.07, height: 4.4, depth: 0.16 }, scene), dark, -0.36, 1.6, 0),
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    armParts.push(part(CreateCylinder("s-bell", { diameterTop: 0.16, diameterBottom: 0.34, height: 0.4, tessellation: 10 }, scene), dark, Math.sin(a) * 0.2, -1.88, Math.cos(a) * 0.2));
  }
  // Four grid fins behind the muzzle.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = CreateBox("s-fin", { width: 0.5, height: 0.06, depth: 0.42 }, scene);
    fin.rotation.y = a;
    armParts.push(part(fin, dark, Math.sin(a + Math.PI / 2) * 0.52, 4.45, Math.cos(a + Math.PI / 2) * 0.52));
  }

  const rockMaterial = new StandardMaterial("moon-rock", scene);
  rockMaterial.diffuseColor = new Color3(0.56, 0.55, 0.56);
  rockMaterial.specularColor = Color3.Black();

  return {
    frame: Mesh.MergeMeshes(frameParts, true, true)!,
    arm: Mesh.MergeMeshes(armParts, true, true)!,
    pivot: PIVOT,
    // Aimed a little above level; a short kick up as it fires, then it settles.
    cocked: 1.22,
    thrown: 1.02,
    swing: 0.07,
    /** A chunk of moon rock: rough, flat-sided, longer one way than the others. */
    stone(radius) {
      const mesh = CreateIcoSphere("moon-rock", { radius: radius * 1.5, subdivisions: 1, flat: true }, scene);
      mesh.scaling.set(1.25, 0.82, 1.05);
      mesh.rotation.set(0.6, 0.9, 0.3);
      mesh.material = rockMaterial;
      return mesh;
    },
  };
}
