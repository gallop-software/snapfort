import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CELL, LEVEL, THICK } from "../game/constants";
import { editGrid, type PieceType } from "../game/pieces";
import { TREBUCHET_BASE } from "../game/trebuchet";

type V3 = readonly [number, number, number];

/**
 * A flat face. Points go bottom-left, bottom-right, top-right, top-left (or
 * left, right, tip for a triangle) as seen from outside. `textured` faces show
 * the whole piece texture; the rest sample one plain spot of it.
 */
interface Face {
  pts: readonly V3[];
  textured?: boolean;
  /** Texture coordinates for each point, when not the default whole-texture mapping. */
  uvs?: readonly (readonly [number, number])[];
}

/** Maps a point on a textured face (by face index, see box()) to texture coordinates. */
type Projection = (p: V3, face: number) => readonly [number, number];

/** A spot every piece texture keeps free of lines (see textures.ts). */
export const PLAIN_UV: readonly [number, number] = [0.45, 0.4];

const QUAD_UV = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
const TRI_UV = [[0, 0], [1, 0], [0.5, 1]] as const;

/** Builds flat-shaded geometry for a convex shape from its faces. */
function buildConvex(faces: readonly Face[]): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const f of faces) for (const p of f.pts) { cx += p[0]; cy += p[1]; cz += p[2]; n++; }
  cx /= n; cy /= n; cz /= n;

  for (const face of faces) {
    const [a, b, c] = face.pts as [V3, V3, V3];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    let fx = 0, fy = 0, fz = 0;
    for (const p of face.pts) { fx += p[0]; fy += p[1]; fz += p[2]; }
    const count = face.pts.length;
    const outward = nx * (fx / count - cx) + ny * (fy / count - cy) + nz * (fz / count - cz) > 0;
    // Babylon's front faces wind so that (b - a) x (c - a) points into the shape.
    const flip = outward;
    if (!outward) { nx = -nx; ny = -ny; nz = -nz; }

    const base = positions.length / 3;
    const faceUv = count === 3 ? TRI_UV : QUAD_UV;
    face.pts.forEach((p, i) => {
      positions.push(p[0], p[1], p[2]);
      normals.push(nx, ny, nz);
      const uv = face.textured ? (face.uvs?.[i] ?? faceUv[i]!) : PLAIN_UV;
      uvs.push(uv[0], uv[1]);
    });
    for (let i = 1; i < count - 1; i++) {
      if (flip) indices.push(base, base + i + 1, base + i);
      else indices.push(base, base + i, base + i + 1);
    }
  }

  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  return data;
}

/**
 * An axis-aligned box. `big` names the pair of faces that carry the texture.
 * Faces in order: +z, -z, +x, -x, top, bottom.
 */
function box(min: V3, max: V3, big: "x" | "y" | "z", proj?: Projection): Face[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const faces: Face[] = [
    { pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], textured: big === "z" },
    { pts: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], textured: big === "z" },
    { pts: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], textured: big === "x" },
    { pts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], textured: big === "x" },
    { pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], textured: big === "y" },
    { pts: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], textured: big === "y" },
  ];
  if (proj) faces.forEach((f, i) => f.textured && (f.uvs = f.pts.map((p) => proj(p, i))));
  return faces;
}

const H = CELL / 2;
const T = THICK / 2;

/**
 * Geometry of each piece, with its origin at the bottom centre of its slot.
 * Floors and ramps are lifted so a ramp's ends meet the top of the floors
 * below and above it.
 */
export function pieceGeometry(type: PieceType): VertexData {
  switch (type) {
    case "wall":
      return buildConvex(box([-H, 0, -T], [H, LEVEL, T], "z"));
    case "floor":
      return buildConvex(box([-H, -T, -H], [H, T, H], "y"));
    case "ramp": {
      const lo = T, hi = LEVEL + T;
      const a: V3 = [-H, lo, -H], b: V3 = [H, lo, -H], c: V3 = [H, hi, H], d: V3 = [-H, hi, H];
      const down = (p: V3): V3 => [p[0], p[1] - THICK, p[2]];
      const [a2, b2, c2, d2] = [down(a), down(b), down(c), down(d)];
      return buildConvex([
        { pts: [a, b, c, d], textured: true },
        { pts: [b2, a2, d2, c2], textured: true },
        { pts: [a2, b2, b, a] },
        { pts: [c2, d2, d, c] },
        { pts: [b2, c2, c, b] },
        { pts: [d2, a2, a, d] },
      ]);
    }
    case "roof": {
      const tip: V3 = [0, LEVEL, 0];
      const p: V3[] = [[-H, 0, -H], [H, 0, -H], [H, 0, H], [-H, 0, H]];
      return buildConvex([
        { pts: [p[0]!, p[1]!, tip], textured: true },
        { pts: [p[1]!, p[2]!, tip], textured: true },
        { pts: [p[2]!, p[3]!, tip], textured: true },
        { pts: [p[3]!, p[0]!, tip], textured: true },
        { pts: [p[3]!, p[2]!, p[1]!, p[0]!] },
      ]);
    }
    case "trebuchet":
      // Only the turntable base: the frame and arm above it turn to aim (see trebuchetView.ts).
      return buildConvex(box([-H * 0.84, 0, -H * 0.84], [H * 0.84, TREBUCHET_BASE, H * 0.84], "y"));
  }
}

export { TREBUCHET_BASE } from "../game/trebuchet";

/**
 * Texture coordinates for one tile of an edited piece, matching what the
 * whole piece shows at that spot, so cutting a hole leaves the rest unchanged.
 */
const wallProj: Projection = (p, face) => [face === 0 ? (p[0] + H) / CELL : (H - p[0]) / CELL, p[1] / LEVEL];
const floorProj: Projection = (p, face) => [(p[0] + H) / CELL, face === 4 ? (p[2] + H) / CELL : (H - p[2]) / CELL];

/** Geometry of a wall or floor with some tiles cut out (see editGrid). */
export function editedGeometry(type: PieceType, edit: number): VertexData {
  const grid = editGrid(type);
  if (!grid || edit === 0) return pieceGeometry(type);
  let merged: VertexData | null = null;
  for (let i = 0; i < grid.cols * grid.rows; i++) {
    if ((edit >> i) & 1) continue;
    const c = i % grid.cols, r = Math.floor(i / grid.cols);
    const w = CELL / grid.cols;
    let tile: VertexData;
    if (type === "wall") {
      const hgt = LEVEL / grid.rows;
      tile = buildConvex(box([-H + c * w, r * hgt, -T], [-H + (c + 1) * w, (r + 1) * hgt, T], "z", wallProj));
    } else {
      const d = CELL / grid.rows;
      tile = buildConvex(box([-H + c * w, -T, -H + r * d], [-H + (c + 1) * w, T, -H + (r + 1) * d], "y", floorProj));
    }
    if (merged) merged.merge(tile);
    else merged = tile;
  }
  return merged ?? pieceGeometry(type);
}
