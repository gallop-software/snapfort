import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";

/**
 * Drawing one mesh many times (thin instances), for everything in Mojave's
 * war there is a crowd of: units, buildings, Troopers' poses, shots, sparks.
 */

/**
 * How much of what is added next shows, 0 to 1: below 1 it is drawn see-through
 * (a unit coming into view out of the haze, or going out of it). Set it round
 * whatever is drawn faded, and back to 1 after.
 */
let fade = 1;
export function fading(k: number): void {
  fade = Math.max(0, Math.min(1, k));
}

/** The see-through twin of each material, made once. */
const faded = new WeakMap<Material, Material>();
function fadedOf(material: Material): Material {
  let m = faded.get(material);
  if (!m) {
    m = material.clone(`${material.name}-fading`)!;
    // Blended (each one's own alpha comes in its colour), but still hiding its own far side.
    m.alpha = 0.999;
    m.forceDepthWrite = true;
    faded.set(material, m);
  }
  return m;
}

/** A mesh drawn many times: where each one is, and (for trim) its colour. */
export class Many {
  private m: Float32Array;
  private c: Float32Array | null;
  count = 0;
  private ready = false;
  private capacity: number;
  /** The same mesh drawn see-through, for those added while fading (made when first wanted). */
  private ghost: Many | null = null;
  /** How much of each one shows (the ghost's own). */
  private alphas: Float32Array | null = null;
  /** Which of the two the last add went to: `matrices` and `colors` are its lists. */
  private last: Many = this;

  constructor(readonly mesh: Mesh, private readonly tinted: boolean, capacity = 64) {
    this.capacity = capacity;
    this.m = new Float32Array(capacity * 16);
    this.c = tinted ? new Float32Array(capacity * 4) : null;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
  }

  /** The placements of the list the last one added went to (write it at the index add gave). */
  get matrices(): Float32Array {
    return this.last.m;
  }

  /** Their colours, for trim. */
  get colors(): Float32Array | null {
    return this.last.c;
  }

  begin(): void {
    this.count = 0;
    this.last = this;
    this.ghost?.begin();
  }

  /** Room for one more: its place in the lists (`matrices`, `colors`). */
  add(): number {
    if (fade < 1) {
      const ghost = (this.ghost ??= this.makeGhost());
      const i = ghost.push();
      ghost.alphas![i] = fade;
      // Plain parts are white in the colour that carries the alpha; trim writes its own.
      if (!this.tinted) ghost.c!.set([1, 1, 1, fade], i * 4);
      this.last = ghost;
      return i;
    }
    this.last = this;
    return this.push();
  }

  private push(): number {
    if (this.count === this.capacity) {
      this.capacity *= 2;
      const m = new Float32Array(this.capacity * 16);
      m.set(this.m);
      this.m = m;
      if (this.c) {
        const c = new Float32Array(this.capacity * 4);
        c.set(this.c);
        this.c = c;
      }
      if (this.alphas) {
        const a = new Float32Array(this.capacity);
        a.set(this.alphas);
        this.alphas = a;
      }
      this.ready = false;
    }
    return this.count++;
  }

  /**
   * The same shape, placed the same, in the see-through twin of its material, casting no shadow. The shape is a copy,
   * never shared: Babylon keeps a mesh's thin-instance buffers (where each one is, its colour) on its geometry, so a
   * twin sharing it took the other's (2026-11-27: solid Troopers drawn white and parts left all over while others faded in).
   */
  private makeGhost(): Many {
    const src = this.mesh;
    const mesh = new Mesh(`${src.name}-fading`, src.getScene());
    VertexData.ExtractFromMesh(src, false, true).applyToMesh(mesh);
    mesh.parent = src.parent;
    mesh.position.copyFrom(src.position);
    mesh.rotation.copyFrom(src.rotation);
    if (src.rotationQuaternion) mesh.rotationQuaternion = src.rotationQuaternion.clone();
    mesh.scaling.copyFrom(src.scaling);
    mesh.receiveShadows = src.receiveShadows;
    if (src.material) mesh.material = fadedOf(src.material);
    const ghost = new Many(mesh, true, 16);
    ghost.alphas = new Float32Array(16);
    return ghost;
  }

  end(): void {
    const n = this.count;
    if (this.alphas) for (let i = 0; i < n; i++) this.c![i * 4 + 3] = this.alphas[i]!;
    if (n > 0 && !this.ready) {
      this.ready = true;
      this.mesh.thinInstanceSetBuffer("matrix", this.m, 16, false);
      if (this.c) this.mesh.thinInstanceSetBuffer("color", this.c, 4, false);
    }
    this.ghost?.end();
    this.last = this;
    if (!this.ready) return;
    // The count first: only that many are sent to the graphics chip.
    this.mesh.thinInstanceCount = n;
    if (n > 0) {
      this.mesh.thinInstanceBufferUpdated("matrix");
      if (this.c) this.mesh.thinInstanceBufferUpdated("color");
    }
    this.mesh.setEnabled(n > 0);
  }
}

/** Writes a placement: turned `yaw` about the vertical, then tipped (`pitch` nose down, `roll` over sideways), scaled and put at a spot. */
export function place(m: Float32Array, i: number, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1): void {
  const o = i * 16;
  const cy = Math.cos(yaw), sn = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // Rows of (roll · pitch · yaw), for vectors written as rows.
  const ax = cy, ay = 0, az = -sn;
  const bx = sp * sn, by = cp, bz = sp * cy;
  const cx = cp * sn, cyy = -sp, cz = cp * cy;
  m[o] = (cr * ax + sr * bx) * sx; m[o + 1] = (cr * ay + sr * by) * sx; m[o + 2] = (cr * az + sr * bz) * sx; m[o + 3] = 0;
  m[o + 4] = (-sr * ax + cr * bx) * sy; m[o + 5] = (-sr * ay + cr * by) * sy; m[o + 6] = (-sr * az + cr * bz) * sy; m[o + 7] = 0;
  m[o + 8] = cx * sz; m[o + 9] = cyy * sz; m[o + 10] = cz * sz; m[o + 11] = 0;
  m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
}

const hexColor = new Map<string, [number, number, number]>();
export function rgbOf(hex: string): [number, number, number] {
  let c = hexColor.get(hex);
  if (!c) {
    const col = Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#888888");
    hexColor.set(hex, (c = [col.r, col.g, col.b]));
  }
  return c;
}

/** Turns the shorter way round from one heading to another. */
export function turn(from: number, to: number, k: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * k;
}

/**
 * Writes the placement of a part carried on something already placed (a
 * wheel on a hull): at (lx, ly, lz) in that thing's own frame, turned `spin`
 * about its own x (a wheel rolling) and then `steer` about the up of that
 * frame (a front wheel steering, a rotor spinning), and then however the thing
 * itself is placed (`on`, entry `at`).
 */
export function placeOn(m: Float32Array, i: number, on: Float32Array, at: number, lx: number, ly: number, lz: number, spin = 0, steer = 0): void {
  const o = i * 16, h = at * 16;
  const cs = Math.cos(spin), ss = Math.sin(spin), ct = Math.cos(steer), st = Math.sin(steer);
  // The part's own axes in the carrier's frame (rows): spun about x, then steered about y.
  const r = [ct, 0, -st, st * ss, cs, ct * ss, st * cs, -ss, ct * cs];
  for (let row = 0; row < 3; row++) {
    const a = r[row * 3]!, b = r[row * 3 + 1]!, c = r[row * 3 + 2]!;
    for (let col = 0; col < 3; col++) m[o + row * 4 + col] = a * on[h + col]! + b * on[h + 4 + col]! + c * on[h + 8 + col]!;
    m[o + row * 4 + 3] = 0;
  }
  for (let col = 0; col < 3; col++) m[o + 12 + col] = lx * on[h + col]! + ly * on[h + 4 + col]! + lz * on[h + 8 + col]! + on[h + 12 + col]!;
  m[o + 15] = 1;
}
