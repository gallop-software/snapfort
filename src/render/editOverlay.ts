import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { CELL, LEVEL, THICK } from "../game/constants";
import { editGrid, pieceTransform, type Piece } from "../game/pieces";

type TileLook = "keep" | "keepHover" | "cut" | "cutHover";

/**
 * The tile grid shown over a piece while editing it: plain tiles stay, bright
 * tiles will be cut out, and the tile under the crosshair is highlighted.
 */
export class EditOverlay {
  private readonly root: TransformNode;
  private readonly tiles: Mesh[] = [];
  private readonly looks: Record<TileLook, StandardMaterial>;

  constructor(scene: Scene) {
    this.root = new TransformNode("edit-overlay", scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    const make = (name: string, color: Color3, alpha: number) => {
      const m = new StandardMaterial(`edit-${name}`, scene);
      m.disableLighting = true;
      m.emissiveColor = color;
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.alpha = alpha;
      m.fogEnabled = false;
      m.zOffset = -2;
      return m;
    };
    this.looks = {
      keep: make("keep", new Color3(0.75, 0.95, 1), 0.16),
      keepHover: make("keep-hover", new Color3(0.8, 1, 1), 0.42),
      cut: make("cut", new Color3(1, 0.5, 0.3), 0.62),
      cutHover: make("cut-hover", new Color3(1, 0.7, 0.45), 0.8),
    };
    for (let i = 0; i < 9; i++) {
      const tile = CreateBox(`edit-tile-${i}`, { size: 1 }, scene);
      tile.parent = this.root;
      tile.isPickable = false;
      tile.enableEdgesRendering(0.95);
      tile.edgesWidth = 3;
      this.tiles.push(tile);
    }
    this.root.setEnabled(false);
  }

  /** `cut` has a bit set for each tile marked to be removed; `hover` is the tile under the crosshair or -1. */
  show(piece: Piece, cut: number, hover: number): void {
    const grid = editGrid(piece.type);
    if (!grid) return this.hide();
    const t = pieceTransform(piece);
    this.root.position.set(t.px, t.py, t.pz);
    Quaternion.RotationAxisToRef(Vector3.Up(), t.yaw, this.root.rotationQuaternion!);
    this.root.setEnabled(true);
    const count = grid.cols * grid.rows;
    const h = CELL / 2;
    const gap = 0.12;
    this.tiles.forEach((tile, i) => {
      if (i >= count) return tile.setEnabled(false);
      tile.setEnabled(true);
      const c = i % grid.cols, r = Math.floor(i / grid.cols);
      const w = CELL / grid.cols;
      if (piece.type === "wall") {
        const hgt = LEVEL / grid.rows;
        tile.position.set(-h + (c + 0.5) * w, (r + 0.5) * hgt, 0);
        tile.scaling.set(w - gap, hgt - gap, THICK + 0.12);
      } else {
        const d = CELL / grid.rows;
        tile.position.set(-h + (c + 0.5) * w, 0, -h + (r + 0.5) * d);
        tile.scaling.set(w - gap, THICK + 0.12, d - gap);
      }
      const isCut = ((cut >> i) & 1) === 1;
      const look: TileLook = isCut ? (i === hover ? "cutHover" : "cut") : i === hover ? "keepHover" : "keep";
      tile.material = this.looks[look];
      tile.edgesColor.set(1, 1, 1, isCut ? 0.9 : 0.6);
    });
  }

  hide(): void {
    this.root.setEnabled(false);
  }
}
