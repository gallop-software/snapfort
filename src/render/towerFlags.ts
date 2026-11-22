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

const RANKS = [
  { color: "#f2b134", label: "1st" },
  { color: "#c9d2dc", label: "2nd" },
  { color: "#d48a52", label: "3rd" },
] as const;

interface Flag {
  root: TransformNode;
  banner: Mesh;
  label: DynamicTexture;
  text: string;
}

/**
 * A flag on top of each of the three tallest towers (gold, silver, bronze),
 * with its height on a sign above, so everyone can see what to beat (or knock
 * down) from across the world.
 */
export class TowerFlags {
  private readonly flags: Flag[] = [];
  private time = 0;

  constructor(scene: Scene) {
    RANKS.forEach((rank, i) => {
      const root = new TransformNode(`flag-${i}`, scene);
      const poleMat = new StandardMaterial(`flag-pole-${i}`, scene);
      poleMat.diffuseColor = new Color3(0.25, 0.25, 0.28);
      poleMat.specularColor = Color3.Black();
      const pole = CreateCylinder(`flag-pole-${i}`, { diameter: 0.18, height: 5, tessellation: 8 }, scene);
      pole.material = poleMat;
      pole.position.y = 2.5;
      pole.parent = root;
      const bannerMat = new StandardMaterial(`flag-banner-${i}`, scene);
      bannerMat.diffuseColor = Color3.FromHexString(rank.color);
      bannerMat.emissiveColor = Color3.FromHexString(rank.color).scale(0.35);
      bannerMat.specularColor = Color3.Black();
      bannerMat.backFaceCulling = false;
      const banner = CreatePlane(`flag-banner-${i}`, { width: 2.2, height: 1.3 }, scene);
      banner.material = bannerMat;
      banner.setPivotPoint(new Vector3(-1.1, 0, 0));
      banner.position.set(1.2, 4.3, 0);
      banner.parent = root;
      const label = new DynamicTexture(`flag-label-${i}`, { width: 512, height: 160 }, scene, true);
      label.hasAlpha = true;
      // Drawn (blank) now: an undrawn texture is "not ready" and would hold up loading.
      label.update();
      const signMat = new StandardMaterial(`flag-sign-${i}`, scene);
      signMat.diffuseTexture = label;
      signMat.emissiveColor = Color3.White();
      signMat.disableLighting = true;
      signMat.useAlphaFromDiffuseTexture = true;
      signMat.backFaceCulling = false;
      const sign = CreatePlane(`flag-sign-${i}`, { width: 4.8, height: 1.5 }, scene);
      sign.material = signMat;
      sign.billboardMode = Mesh.BILLBOARDMODE_ALL;
      sign.position.y = 6.6;
      sign.parent = root;
      for (const m of [pole, banner, sign]) m.isPickable = false;
      root.setEnabled(false);
      this.flags.push({ root, banner, label, text: "" });
    });
  }

  /** Moves the flags to the current tallest towers. */
  show(towers: readonly WireTower[]): void {
    this.flags.forEach((flag, i) => {
      const tower = towers[i];
      if (!tower) return flag.root.setEnabled(false);
      const [height, x, y, z] = tower;
      flag.root.setEnabled(true);
      flag.root.position.set(x, y, z);
      const text = `${RANKS[i]!.label} · ${Math.round(height)} m`;
      if (text !== flag.text) {
        flag.text = text;
        const ctx = flag.label.getContext() as unknown as CanvasRenderingContext2D;
        ctx.clearRect(0, 0, 512, 160);
        ctx.fillStyle = "rgba(31, 42, 55, 0.82)";
        ctx.beginPath();
        ctx.roundRect(16, 20, 480, 120, 60);
        ctx.fill();
        ctx.fillStyle = RANKS[i]!.color;
        ctx.font = "900 76px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 256, 84);
        flag.label.update();
      }
    });
  }

  /** Banners flutter. */
  update(dt: number): void {
    this.time += dt;
    this.flags.forEach((flag, i) => {
      flag.banner.rotation.y = Math.sin(this.time * 2.4 + i) * 0.25;
    });
  }
}
