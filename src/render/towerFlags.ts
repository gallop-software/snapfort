import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { WireTower } from "../net/protocol";

const GOLD = "#f2b134";
/** Twice the size it first had, both ways (user, 2026-11-22). */
const SIZE = 2;

/**
 * One flag in the whole world, gold, on top of the tallest tower, with its
 * height on a sign above, so everyone can see what to beat (or knock down)
 * from across the world.
 */
export class TowerFlag {
  private readonly root: TransformNode;
  private readonly banner: Mesh;
  private readonly label: DynamicTexture;
  private time = 0;
  /** What the sign says; empty while there is no tower. */
  text = "";

  constructor(scene: Scene) {
    this.root = new TransformNode("flag", scene);
    this.root.scaling.setAll(SIZE);
    const poleMat = new StandardMaterial("flag-pole", scene);
    poleMat.diffuseColor = new Color3(0.25, 0.25, 0.28);
    poleMat.specularColor = Color3.Black();
    const pole = CreateCylinder("flag-pole", { diameter: 0.18, height: 5, tessellation: 8 }, scene);
    pole.material = poleMat;
    pole.position.y = 2.5;
    pole.parent = this.root;
    const bannerMat = new StandardMaterial("flag-banner", scene);
    bannerMat.diffuseColor = Color3.FromHexString(GOLD);
    bannerMat.emissiveColor = Color3.FromHexString(GOLD).scale(0.35);
    bannerMat.specularColor = Color3.Black();
    bannerMat.backFaceCulling = false;
    this.banner = CreatePlane("flag-banner", { width: 2.2, height: 1.3 }, scene);
    this.banner.material = bannerMat;
    this.banner.setPivotPoint(new Vector3(-1.1, 0, 0));
    this.banner.position.set(1.2, 4.3, 0);
    this.banner.parent = this.root;
    this.label = new DynamicTexture("flag-label", { width: 512, height: 160 }, scene, true);
    this.label.hasAlpha = true;
    // Drawn (blank) now: an undrawn texture is "not ready" and would hold up loading.
    this.label.update();
    const signMat = new StandardMaterial("flag-sign", scene);
    signMat.diffuseTexture = this.label;
    signMat.emissiveColor = Color3.White();
    signMat.disableLighting = true;
    signMat.useAlphaFromDiffuseTexture = true;
    signMat.backFaceCulling = false;
    const sign = CreatePlane("flag-sign", { width: 4.8, height: 1.5 }, scene);
    sign.material = signMat;
    sign.billboardMode = Mesh.BILLBOARDMODE_ALL;
    sign.position.y = 6.6;
    sign.parent = this.root;
    for (const m of [pole, this.banner, sign]) m.isPickable = false;
    this.root.setEnabled(false);
  }

  /** Where the flag stands, or null while there is no tower. */
  get at(): [number, number, number] | null {
    if (!this.root.isEnabled()) return null;
    const p = this.root.position;
    return [p.x, p.y, p.z];
  }

  /** Moves the flag to the tallest tower (the first in the list), or hides it. */
  show(towers: readonly WireTower[]): void {
    const tower = towers[0];
    if (!tower) {
      this.text = "";
      return this.root.setEnabled(false);
    }
    const [height, x, y, z] = tower;
    this.root.setEnabled(true);
    this.root.position.set(x, y, z);
    const text = `Tallest · ${Math.round(height)} m`;
    if (text === this.text) return;
    this.text = text;
    const ctx = this.label.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = "rgba(31, 42, 55, 0.82)";
    ctx.beginPath();
    ctx.roundRect(16, 20, 480, 120, 60);
    ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.font = "900 70px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 84);
    this.label.update();
  }

  /** The banner flutters. */
  update(dt: number): void {
    this.time += dt;
    this.banner.rotation.y = Math.sin(this.time * 2.4) * 0.25;
  }
}
