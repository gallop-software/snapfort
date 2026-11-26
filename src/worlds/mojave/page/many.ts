import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";

/**
 * Drawing one mesh many times (thin instances), for everything in Mojave's
 * war there is a crowd of: units, buildings, Troopers' poses, shots, sparks.
 */

/** A mesh drawn many times: where each one is, and (for trim) its colour. */
export class Many {
  matrices: Float32Array;
  colors: Float32Array | null;
  count = 0;
  private ready = false;
  private capacity: number;

  constructor(readonly mesh: Mesh, tinted: boolean, capacity = 64) {
    this.capacity = capacity;
    this.matrices = new Float32Array(capacity * 16);
    this.colors = tinted ? new Float32Array(capacity * 4) : null;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
  }

  begin(): void {
    this.count = 0;
  }

  /** Room for one more: its place in the lists. */
  add(): number {
    if (this.count === this.capacity) {
      this.capacity *= 2;
      const m = new Float32Array(this.capacity * 16);
      m.set(this.matrices);
      this.matrices = m;
      if (this.colors) {
        const c = new Float32Array(this.capacity * 4);
        c.set(this.colors);
        this.colors = c;
      }
      this.ready = false;
    }
    return this.count++;
  }

  end(): void {
    const n = this.count;
    if (n > 0 && !this.ready) {
      this.ready = true;
      this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
      if (this.colors) this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
    }
    if (!this.ready) return;
    // The count first: only that many are sent to the graphics chip.
    this.mesh.thinInstanceCount = n;
    if (n > 0) {
      this.mesh.thinInstanceBufferUpdated("matrix");
      if (this.colors) this.mesh.thinInstanceBufferUpdated("color");
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
