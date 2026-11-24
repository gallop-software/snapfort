import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Small tools the worlds draw their art with. All art is drawn with canvas 2D
 * (each world has its own painters), so the game ships no image files.
 */

export function canvas(width: number, height = width): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return [c, c.getContext("2d")!];
}

/** A canvas as a texture. `sharp` adds the filtering that keeps surfaces seen at a slant crisp. */
export function toTexture(c: HTMLCanvasElement, scene: Scene, name: string, sharp = true): Texture {
  const texture = new Texture(c.toDataURL("image/png"), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = name;
  if (sharp) texture.anisotropicFilteringLevel = 8;
  return texture;
}

/** Small deterministic random source so the art is the same on every load. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

/** Paints a mesh one colour (vertex colours), so differently coloured parts can be merged into one. */
export function paintMesh(mesh: Mesh, r: number, g: number, b: number, updatable = false): Mesh {
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([r, g, b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors, updatable);
  return mesh;
}
