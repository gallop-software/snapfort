import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { SIEGE, type Soldier } from "../game/siege";

/** Paints a whole mesh one colour so differently coloured parts can be merged into one mesh. */
function paint(mesh: Mesh, r: number, g: number, b: number): Mesh {
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([r, g, b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

/**
 * The army: one toy-soldier mesh (plum tabard, tall pointed steel cap, round
 * mustard shield, banner pole) drawn hundreds of times with thin instances.
 */
export class SoldierView {
  private readonly mesh: Mesh;
  private readonly matrices = new Float32Array(SIEGE.maxSoldiers * 16);
  private time = 0;

  constructor(scene: Scene, shadows: ShadowGenerator) {
    const part = (mesh: Mesh, x: number, y: number, z: number, color: [number, number, number]) => {
      mesh.position.set(x, y, z);
      mesh.computeWorldMatrix(true);
      return paint(mesh, ...color);
    };
    const plum: [number, number, number] = [0.42, 0.25, 0.5];
    const steel: [number, number, number] = [0.62, 0.68, 0.74];
    const mustard: [number, number, number] = [0.93, 0.72, 0.2];
    const dark: [number, number, number] = [0.16, 0.14, 0.22];
    const skin: [number, number, number] = [0.98, 0.9, 0.8];
    const parts = [
      part(CreateCylinder("s-body", { diameterTop: 0.5, diameterBottom: 0.8, height: 0.95, tessellation: 10 }, scene), 0, 0.6, 0, plum),
      part(CreateCylinder("s-feet", { diameter: 0.6, height: 0.14, tessellation: 10 }, scene), 0, 0.07, 0, dark),
      part(CreateSphere("s-head", { diameter: 0.52, segments: 8 }, scene), 0, 1.26, 0, skin),
      part(CreateBox("s-eyes", { width: 0.34, height: 0.08, depth: 0.08 }, scene), 0, 1.28, 0.23, dark),
      part(CreateCylinder("s-cap", { diameterTop: 0, diameterBottom: 0.6, height: 0.62, tessellation: 10 }, scene), 0, 1.68, 0, steel),
      part(CreateCylinder("s-shield", { diameter: 0.62, height: 0.08, tessellation: 12 }, scene), 0.1, 0.72, 0.42, mustard),
      part(CreateCylinder("s-pole", { diameter: 0.07, height: 2.3, tessellation: 6 }, scene), -0.46, 1.15, 0.05, dark),
      part(CreateBox("s-flag", { width: 0.05, height: 0.34, depth: 0.5 }, scene), -0.46, 2.1, -0.22, mustard),
    ];
    parts[5]!.rotation.x = Math.PI / 2;
    parts[5]!.computeWorldMatrix(true);

    this.mesh = Mesh.MergeMeshes(parts, true, true)!;
    this.mesh.name = "army";
    const material = new StandardMaterial("army", scene);
    material.diffuseColor = Color3.White();
    material.specularColor = Color3.Black();
    this.mesh.material = material;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.receiveShadows = true;
    shadows.addShadowCaster(this.mesh);
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceCount = 0;
    this.mesh.setEnabled(false);
  }

  /** Copies the soldiers' positions to the GPU, with a marching hop and a lunge while battering. */
  update(soldiers: readonly Soldier[], dt: number): void {
    this.time += dt;
    const count = Math.min(soldiers.length, SIEGE.maxSoldiers);
    const m = this.matrices;
    for (let i = 0; i < count; i++) {
      const s = soldiers[i]!;
      const sin = Math.sin(s.heading), cos = Math.cos(s.heading);
      let hop: number, lunge = 0;
      if (s.attacking) {
        const swing = 1 - Math.min(1, s.cooldown / SIEGE.hitInterval);
        lunge = Math.sin(swing * Math.PI) * 0.35;
        hop = 0;
      } else {
        hop = Math.abs(Math.sin(this.time * 9 * s.pace + s.phase)) * 0.16;
      }
      const o = i * 16;
      m[o] = cos; m[o + 1] = 0; m[o + 2] = -sin; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = sin; m[o + 9] = 0; m[o + 10] = cos; m[o + 11] = 0;
      m[o + 12] = s.x + sin * lunge; m[o + 13] = hop; m[o + 14] = s.z + cos * lunge; m[o + 15] = 1;
    }
    // Count first: Babylon uploads only the first `thinInstanceCount` entries.
    this.mesh.thinInstanceCount = count;
    if (count > 0) this.mesh.thinInstanceBufferUpdated("matrix");
    this.mesh.setEnabled(count > 0);
  }
}
