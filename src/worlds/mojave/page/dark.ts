import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { CELL } from "../../../game/constants";
import { SIGHT_CELL, SIGHT_GRID, sightIndex, stamp } from "../sim";
import { HALF_CELLS } from "../world";

/**
 * The dark: Mojave is black until it has been seen, as StarCraft's maps were.
 *
 * - Never seen: black. A bank of darkness stands on the ground there, so what
 *   is in it cannot be made out from outside.
 * - Seen before, nobody of this side there now: dimmed. The land shows, and
 *   buildings as they were last seen; units do not (the server does not send them).
 * - In sight of this side (the general, their units and buildings, and their
 *   allies'): lit, and live.
 *
 * Worked out here from what this page knows of its own side, on the same grid
 * the server uses to decide what to send. What has been seen is remembered for
 * the visit.
 */

const N = SIGHT_GRID;
const HALF = HALF_CELLS * CELL;
/** How tall the banks of darkness are, m: over a base and its units, under a tall tower. */
const BANK = 13;
/** How dark the ground is where it has been seen but is not in sight. */
const DIM = 0.5;

export class Dark {
  /** In sight now, and ever seen: 1 for each sight cell. */
  readonly visible = new Uint8Array(N * N);
  readonly explored = new Uint8Array(N * N);
  /** Nothing is dark (someone watching, who is on no side). */
  off = false;

  private readonly texture: DynamicTexture;
  private readonly image: ImageData;
  private readonly overlay: Mesh;
  private readonly banks: Mesh;
  private matrices = new Float32Array(0);
  private dirty = true;
  private banksDirty = true;

  constructor(scene: Scene) {
    this.texture = new DynamicTexture("mojave-dark", { width: N, height: N }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
    this.texture.hasAlpha = true;
    this.texture.wrapU = this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.image = new ImageData(N, N);
    const material = new StandardMaterial("mojave-dark", scene);
    material.diffuseTexture = this.texture;
    material.useAlphaFromDiffuseTexture = true;
    material.disableLighting = true;
    material.emissiveColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.fogEnabled = false;
    material.zOffset = -3;
    // Just above the ground, over the whole building area.
    this.overlay = CreateGround("mojave-dark", { width: HALF * 2, height: HALF * 2 }, scene);
    this.overlay.position.y = 0.09;
    this.overlay.material = material;
    this.overlay.isPickable = false;

    const black = new StandardMaterial("mojave-dark-bank", scene);
    black.disableLighting = true;
    black.emissiveColor = Color3.Black();
    black.diffuseColor = Color3.Black();
    black.specularColor = Color3.Black();
    black.fogEnabled = false;
    this.banks = CreateBox("mojave-dark-bank", { width: SIGHT_CELL, height: BANK, depth: SIGHT_CELL }, scene);
    this.banks.material = black;
    this.banks.isPickable = false;
    this.banks.alwaysSelectAsActiveMesh = true;
    this.banks.setEnabled(false);
  }

  /** Whether a spot is in this side's sight now. */
  sees(x: number, z: number): boolean {
    return this.off || this.visible[sightIndex(x, z)] === 1;
  }

  /** Whether a spot has ever been seen this visit. */
  knows(x: number, z: number): boolean {
    return this.off || this.explored[sightIndex(x, z)] === 1;
  }

  /** Forgets everything seen (a new side: a watcher become a general, say). */
  forget(): void {
    this.explored.fill(0);
    this.visible.fill(0);
    this.dirty = this.banksDirty = true;
  }

  /** What this side sees now: each source is a spot and how far it sees from there. */
  look(sources: readonly (readonly [number, number, number])[]): void {
    const before = this.visible.slice();
    this.visible.fill(0);
    for (const [x, z, range] of sources) stamp(this.visible, x, z, range);
    for (let i = 0; i < N * N; i++) {
      if (this.visible[i] !== before[i]) this.dirty = true;
      if (this.visible[i] && !this.explored[i]) {
        this.explored[i] = 1;
        this.banksDirty = true;
      }
    }
  }

  /** Draws the dark as it now is (only when it changed). */
  update(): void {
    this.overlay.setEnabled(!this.off);
    // (Painted even while nothing is dark: a picture never drawn is never ready, and the game waits for it.)
    if (this.dirty) {
      this.dirty = false;
      const data = this.image.data;
      for (let gx = 0; gx < N; gx++) {
        for (let gz = 0; gz < N; gz++) {
          const i = gx * N + gz;
          // (The picture's first row lies along the south edge of the ground.)
          const o = (gz * N + gx) * 4;
          data[o + 3] = this.visible[i] ? 0 : this.explored[i] ? Math.round(DIM * 255) : 255;
        }
      }
      (this.texture.getContext() as unknown as CanvasRenderingContext2D).putImageData(this.image, 0, 0);
      this.texture.update(false);
    }
    if (this.off) return void this.banks.setEnabled(false);
    if (this.banksDirty) {
      this.banksDirty = false;
      let n = 0;
      for (let i = 0; i < N * N; i++) if (!this.explored[i]) n++;
      if (this.matrices.length < n * 16) this.matrices = new Float32Array(n * 16);
      const m = this.matrices;
      let k = 0;
      for (let gx = 0; gx < N; gx++) {
        for (let gz = 0; gz < N; gz++) {
          if (this.explored[gx * N + gz]) continue;
          const o = k++ * 16;
          m.fill(0, o, o + 16);
          m[o] = m[o + 5] = m[o + 10] = m[o + 15] = 1;
          m[o + 12] = (gx + 0.5) * SIGHT_CELL - HALF;
          m[o + 13] = BANK / 2;
          m[o + 14] = (gz + 0.5) * SIGHT_CELL - HALF;
        }
      }
      this.banks.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
      this.banks.thinInstanceCount = n;
    }
    this.banks.setEnabled(this.banks.thinInstanceCount > 0);
  }
}
