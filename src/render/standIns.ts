import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { OutfitBuilder } from "../worlds/pageDoors";
import { Avatar, type StandInPose } from "./avatar";

const POSES: readonly StandInPose[] = ["stand", "runA", "runB", "air"];
const MAX = 128;

interface Host {
  jacket: Mesh;
  rest: Mesh;
  matrices: Float32Array;
  colors: Float32Array;
  count: number;
  ready: boolean;
}

/**
 * Builders too small on screen for the full animated body: a flipbook of a
 * few frozen poses of the same builder (standing, two running strides, in the
 * air), each pose one mesh drawn for every distant builder at once. The jacket
 * takes each builder's colour. Cheap however many there are.
 */
export class StandIns {
  private readonly hosts = new Map<StandInPose, Host>();

  constructor(scene: Scene, shadows: ShadowGenerator, outfit: OutfitBuilder) {
    const model = new Avatar(scene, null, outfit, "#ffffff");
    const jacketMat = new StandardMaterial("stand-in-jacket", scene);
    jacketMat.specularColor = Color3.Black();
    const restMat = new StandardMaterial("stand-in-rest", scene);
    restMat.specularColor = Color3.Black();
    // Paint every part but the jacket in its own colour, so they merge into one mesh.
    for (const mesh of model.partsForBaking().rest) {
      const c = (mesh.material as StandardMaterial).diffuseColor;
      const colors = new Float32Array(mesh.getTotalVertices() * 4);
      for (let i = 0; i < colors.length; i += 4) colors.set([c.r, c.g, c.b, 1], i);
      mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    }
    for (const pose of POSES) {
      model.setPose(pose);
      const parts = model.partsForBaking();
      const host = (meshes: Mesh[], name: string, material: StandardMaterial) => {
        const merged = Mesh.MergeMeshes(meshes, false, true)!;
        merged.name = name;
        merged.material = material;
        merged.isPickable = false;
        merged.alwaysSelectAsActiveMesh = true;
        merged.receiveShadows = true;
        shadows.addShadowCaster(merged);
        merged.setEnabled(false);
        return merged;
      };
      this.hosts.set(pose, {
        jacket: host(parts.jacket, `stand-in-${pose}-jacket`, jacketMat),
        rest: host(parts.rest, `stand-in-${pose}`, restMat),
        matrices: new Float32Array(MAX * 16),
        colors: new Float32Array(MAX * 4),
        count: 0,
        ready: false,
      });
    }
    model.dispose();
  }

  /** Starts a frame's list of stand-ins. */
  begin(): void {
    for (const host of this.hosts.values()) host.count = 0;
  }

  /** One distant builder: feet at (x, y, z), facing `yaw`, jacket colour RGB 0..1. */
  add(pose: StandInPose, x: number, y: number, z: number, yaw: number, color: Color3): void {
    const host = this.hosts.get(pose)!;
    if (host.count >= MAX) return;
    const i = host.count++;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const m = host.matrices, o = i * 16;
    m[o] = cos; m[o + 1] = 0; m[o + 2] = -sin; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = sin; m[o + 9] = 0; m[o + 10] = cos; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    host.colors.set([color.r, color.g, color.b, 1], i * 4);
  }

  /** Sends the frame's stand-ins to the GPU. */
  end(): void {
    for (const host of this.hosts.values()) {
      const n = host.count;
      if (n > 0 && !host.ready) {
        // Attach once there is something to draw: Babylon decides on per-instance colours then.
        host.ready = true;
        host.rest.thinInstanceSetBuffer("matrix", host.matrices, 16, false);
        host.jacket.thinInstanceSetBuffer("matrix", host.matrices, 16, false);
        host.jacket.thinInstanceSetBuffer("color", host.colors, 4, false);
      }
      if (!host.ready) continue;
      // Count first: Babylon uploads only the first `thinInstanceCount` entries.
      host.rest.thinInstanceCount = n;
      host.jacket.thinInstanceCount = n;
      if (n > 0) {
        host.rest.thinInstanceBufferUpdated("matrix");
        host.jacket.thinInstanceBufferUpdated("matrix");
        host.jacket.thinInstanceBufferUpdated("color");
      }
      host.rest.setEnabled(n > 0);
      host.jacket.setEnabled(n > 0);
    }
  }
}
