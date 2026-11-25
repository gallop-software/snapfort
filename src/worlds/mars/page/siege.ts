import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { paintMesh } from "../../../render/paint";
import type { SiegeModel } from "../../pageDoors";

/** Height of the launch box's pivot above the turntable. */
const PIVOT = 2.5;
/** How tall the beam on a mark stands, m, and how thick it is. */
const BEAM_TALL = 600, BEAM_WIDE = 0.34;

/**
 * Mars's beacon. It throws nothing at its target: a laser marks the spot, and
 * a guided missile leaves the box beside it, climbs, and dives on the mark
 * from above (as real top-attack missiles do, and they too must see what they
 * mark). On a sand-coloured tracked base: a mast with the designator's dish,
 * and a box of four launch tubes that tips up to fire.
 *
 * The mark is a thin red beam standing on the spot for as long as the missile
 * is on its way: everyone sees it, and that is the warning.
 */
export function siegeModel(scene: Scene): SiegeModel {
  const sand: [number, number, number] = [0.8, 0.7, 0.55];
  const white: [number, number, number] = [0.93, 0.92, 0.88];
  const black: [number, number, number] = [0.1, 0.09, 0.1];
  const dark: [number, number, number] = [0.3, 0.27, 0.27];
  const red: [number, number, number] = [0.85, 0.2, 0.16];
  const part = (mesh: Mesh, color: [number, number, number], x: number, y: number, z: number, rx = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.rotation.z = rz;
    return paintMesh(mesh, ...color);
  };
  const tube = (name: string, diameter: number, height: number, sides = 16) => CreateCylinder(name, { diameter, height, tessellation: sides }, scene);
  const box = (name: string, width: number, height: number, depth: number) => CreateBox(name, { width, height, depth }, scene);

  // Frame: a low eight-sided pad, a tracked body, the cradle for the launch box, and the mast. Shoots toward +z.
  const frameParts: Mesh[] = [];
  frameParts.push(part(tube("b-pad", 3.6, 0.14, 8), dark, 0, 0.07, 0));
  frameParts.push(part(box("b-body", 2.1, 0.7, 2.7), sand, 0, 0.62, 0));
  frameParts.push(part(box("b-deck", 1.7, 0.12, 2.3), dark, 0, 1.03, 0));
  for (const side of [-1, 1]) {
    // Tracks, and the two arms of the cradle.
    frameParts.push(part(box("b-track", 0.42, 0.56, 3), black, side * 1.25, 0.42, 0));
    for (const end of [-1, 1]) frameParts.push(part(tube("b-wheel", 0.56, 0.44, 12), dark, side * 1.25, 0.42, end * 1.5, 0, Math.PI / 2));
    frameParts.push(part(box("b-cradle", 0.16, PIVOT - 0.9, 0.5), sand, side * 0.74, (PIVOT + 1.1) / 2, 0.35));
  }
  // The mast at the back, with the designator: a dish and its red eye, looking where the engine is turned.
  frameParts.push(part(tube("b-mast", 0.2, 4.2, 8), white, 0, 3.1, -1));
  frameParts.push(part(tube("b-mast-foot", 0.5, 0.3, 8), dark, 0, 1.2, -1));
  const dish = CreateSphere("b-dish", { diameter: 1.5, segments: 12, slice: 0.3 }, scene);
  frameParts.push(part(dish, white, 0, 5.2, -0.5, -Math.PI / 2));
  frameParts.push(part(tube("b-feed", 0.07, 0.8, 6), dark, 0, 5.2, -0.5, Math.PI / 2));
  frameParts.push(part(box("b-eye-box", 0.5, 0.4, 0.6), black, 0, 4.25, -0.82));
  frameParts.push(part(tube("b-eye", 0.24, 0.1, 12), red, 0, 4.25, -0.5, Math.PI / 2));

  // The launch box, drawn upright from the pivot: four tubes, mouths up.
  const armParts: Mesh[] = [
    part(tube("b-trunnion", 0.26, 1.5, 10), black, 0, 0, 0, 0, Math.PI / 2),
    part(box("b-box", 1.2, 2.9, 1.2), sand, 0, 0.75, 0),
    part(box("b-box-band", 1.24, 0.16, 1.24), dark, 0, 1.5, 0),
    part(box("b-box-band", 1.24, 0.16, 1.24), dark, 0, -0.1, 0),
  ];
  for (const x of [-0.29, 0.29]) for (const z of [-0.29, 0.29]) armParts.push(part(tube("b-mouth", 0.46, 0.1, 12), black, x, 2.22, z));

  // What it fires: drawn nose toward +z, so it can be turned to face the way it goes.
  const hull = new StandardMaterial("missile", scene);
  hull.diffuseColor = new Color3(1, 1, 1);
  hull.specularColor = new Color3(0.25, 0.25, 0.25);
  const flame = new StandardMaterial("missile-flame", scene);
  flame.disableLighting = true;
  flame.emissiveColor = new Color3(1, 0.72, 0.3);
  flame.diffuseColor = Color3.Black();

  // The beam on a mark. One cylinder a metre tall, stood up and stretched for each mark, and put away when the missile is down.
  const beamMaterial = new StandardMaterial("beacon-beam", scene);
  beamMaterial.disableLighting = true;
  beamMaterial.emissiveColor = new Color3(1, 0.16, 0.12);
  beamMaterial.diffuseColor = Color3.Black();
  beamMaterial.alpha = 0.6;
  beamMaterial.fogEnabled = false;
  const spare: Mesh[] = [];
  const marks: { beam: Mesh; left: number; whole: number }[] = [];
  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    for (let i = marks.length - 1; i >= 0; i--) {
      const mark = marks[i]!;
      mark.left -= dt;
      // It flickers a little, and thickens as the missile nears.
      const near = 1 - Math.max(0, mark.left) / mark.whole;
      const wide = BEAM_WIDE * (0.7 + 0.9 * near) * (0.9 + 0.1 * Math.sin(mark.left * 40));
      mark.beam.scaling.set(wide, BEAM_TALL, wide);
      if (mark.left > 0) continue;
      mark.beam.setEnabled(false);
      spare.push(mark.beam);
      marks.splice(i, 1);
    }
  });

  return {
    frame: Mesh.MergeMeshes(frameParts, true, true)!,
    arm: Mesh.MergeMeshes(armParts, true, true)!,
    pivot: PIVOT,
    // Tipped a little forward of straight up; a short kick as one leaves, then it settles.
    cocked: 0.24,
    thrown: 0.1,
    swing: 0.09,
    pointed: true,
    /** A missile: a white body with a dark nose, four fins, and its motor burning behind. */
    stone(radius) {
      const wide = radius * 0.6, long = radius * 4.6;
      const lie = (mesh: Mesh, z: number) => {
        mesh.rotation.x = Math.PI / 2;
        mesh.position.z = z;
        return mesh;
      };
      const body = paintMesh(lie(tube("missile-body", wide, long, 12), 0), ...white);
      const nose = paintMesh(lie(CreateCylinder("missile-nose", { diameterTop: 0, diameterBottom: wide, height: wide * 1.8, tessellation: 12 }, scene), long / 2 + wide * 0.9), ...dark);
      const band = paintMesh(lie(tube("missile-band", wide * 1.03, long * 0.08, 12), long * 0.28), ...red);
      const fins: Mesh[] = [];
      for (let i = 0; i < 4; i++) {
        const fin = paintMesh(box("missile-fin", wide * 1.5, 0.04, long * 0.2), ...dark);
        fin.rotation.z = (i * Math.PI) / 2;
        fin.position.set(Math.cos((i * Math.PI) / 2) * wide * 0.9, Math.sin((i * Math.PI) / 2) * wide * 0.9, -long * 0.4);
        fins.push(fin);
      }
      const mesh = Mesh.MergeMeshes([body, nose, band, ...fins], true, true)!;
      mesh.name = "missile";
      mesh.material = hull;
      const burn = lie(CreateCylinder("missile-burn", { diameterTop: wide * 0.8, diameterBottom: 0, height: long * 0.9, tessellation: 8 }, scene), -long * 0.95);
      burn.material = flame;
      burn.parent = mesh;
      burn.isPickable = false;
      return mesh;
    },
    mark(to, seconds) {
      const beam = spare.pop() ?? CreateCylinder("beacon-beam", { diameter: 1, height: 1, tessellation: 8 }, scene);
      beam.material = beamMaterial;
      beam.isPickable = false;
      beam.setEnabled(true);
      beam.position.set(to[0], to[1] + BEAM_TALL / 2, to[2]);
      beam.scaling.set(BEAM_WIDE, BEAM_TALL, BEAM_WIDE);
      marks.push({ beam, left: seconds, whole: seconds });
    },
  };
}
