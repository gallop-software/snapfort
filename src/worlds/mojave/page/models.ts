/**
 * Mojave's army, as low-poly models: every unit and building is two meshes
 * merged from primitives and coloured by vertex. `body` is the fixed colours
 * (stainless steel, graphite, white ceramic, glass); `trim` is the parts in the
 * owner's colour, white here and tinted for each instance by whoever draws it.
 */
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingKind, UnitKind } from "../kit";

export interface Model {
  /** Fixed colours, by vertex. */
  body: Mesh;
  /** The parts in the owner's colour: white by vertex, tinted per instance. */
  trim: Mesh;
}

type RGB = readonly [number, number, number];
type V3 = readonly [number, number, number];

/** The owner's colour: parts painted with this go in `trim` (white, to be tinted). */
const TRIM: RGB = [1, 1, 1];
const STEEL: RGB = [0.74, 0.77, 0.8];
const STEEL_D: RGB = [0.5, 0.53, 0.58];
const GRAPHITE: RGB = [0.2, 0.21, 0.24];
const TYRE: RGB = [0.08, 0.08, 0.09];
const WHITE: RGB = [0.93, 0.93, 0.9];
const GLASS: RGB = [0.1, 0.24, 0.32];
const CYAN: RGB = [0.45, 0.95, 1];
const AMBER: RGB = [1, 0.72, 0.2];
const RED: RGB = [1, 0.3, 0.25];
const VIOLET: RGB = [0.75, 0.45, 1];
const ROCK: RGB = [0.5, 0.4, 0.32];
const ROCK_D: RGB = [0.38, 0.3, 0.25];

/** Paints a whole mesh one colour so differently coloured parts can be merged into one mesh. */
function paint(mesh: Mesh, c: RGB): Mesh {
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([c[0], c[1], c[2], 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

/**
 * A mesh of flat faces. Each face is a convex polygon and comes with a point
 * behind it (inside the solid), which decides which way it faces.
 */
function solid(scene: Scene, faces: readonly { pts: readonly V3[]; inside: V3 }[]): Mesh {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [], uvs: number[] = [];
  for (const face of faces) {
    let pts = face.pts;
    const a = pts[0]!, b = pts[1]!, c = pts[2]!;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    if (nx * (a[0] - face.inside[0]) + ny * (a[1] - face.inside[1]) + nz * (a[2] - face.inside[2]) < 0) {
      pts = [...pts].reverse();
      nx = -nx; ny = -ny; nz = -nz;
    }
    const first = positions.length / 3;
    for (const p of pts) {
      positions.push(p[0], p[1], p[2]);
      normals.push(nx, ny, nz);
      uvs.push(0, 0);
    }
    // Babylon's front faces wind the other way from the usual cross product.
    for (let i = 1; i < pts.length - 1; i++) indices.push(first, first + i + 1, first + i);
  }
  const mesh = new Mesh("part", scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices;
  data.uvs = uvs;
  data.applyToMesh(mesh);
  return mesh;
}

function centroid(pts: readonly V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / pts.length, y / pts.length, z / pts.length];
}

/** Stands a mesh made along +y (from -length/2 to +length/2) so that it runs from `from` to `to`. */
function along(mesh: Mesh, from: V3, to: V3): Mesh {
  const direction = new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
  mesh.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
  mesh.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, direction, new Quaternion());
  return mesh;
}

function distance(a: V3, b: V3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/** The point `t` of the way from a to b. */
function mix(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The parts of one model, gathered as they are made. */
function parts(scene: Scene) {
  const body: Mesh[] = [], trim: Mesh[] = [];
  const add = (mesh: Mesh, c: RGB): Mesh => {
    mesh.computeWorldMatrix(true);
    (c === TRIM ? trim : body).push(paint(mesh, c));
    return mesh;
  };
  /** A box, by its centre. */
  const box = (c: RGB, w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0): Mesh => {
    const mesh = CreateBox("part", { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    return add(mesh, c);
  };
  /** An upright cylinder or cone, standing on (x, y, z). */
  const cyl = (c: RGB, dBottom: number, dTop: number, h: number, x: number, y: number, z: number, tessellation = 8): Mesh => {
    const mesh = CreateCylinder("part", { diameterBottom: dBottom, diameterTop: dTop, height: h, tessellation }, scene);
    mesh.position.set(x, y + h / 2, z);
    return add(mesh, c);
  };
  /** A box girder from one point to another. */
  const beam = (c: RGB, from: V3, to: V3, w: number, d = w): Mesh =>
    add(along(CreateBox("part", { width: w, height: distance(from, to), depth: d }, scene), from, to), c);
  /** A round bar (or a cone) from one point to another. */
  const rod = (c: RGB, from: V3, to: V3, d0: number, d1 = d0, tessellation = 6): Mesh =>
    add(along(CreateCylinder("part", { diameterBottom: d0, diameterTop: d1, height: distance(from, to), tessellation }, scene), from, to), c);
  /** A profile in the (z, y) plane, as wide as `width` along x. */
  const prism = (c: RGB, profile: readonly (readonly [number, number])[], width: number, x = 0): Mesh => {
    const left = profile.map(([z, y]): V3 => [x - width / 2, y, z]);
    const right = profile.map(([z, y]): V3 => [x + width / 2, y, z]);
    const inside = centroid([...left, ...right]);
    const faces = [{ pts: left, inside }, { pts: right, inside }];
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      faces.push({ pts: [left[i]!, left[j]!, right[j]!, right[i]!], inside });
    }
    return add(solid(scene, faces), c);
  };
  /** A box whose top is a different size from its bottom (and may be shifted along z), standing on (x, y, z). */
  const frustum = (c: RGB, w0: number, d0: number, w1: number, d1: number, h: number, x: number, y: number, z: number, shift = 0): Mesh => {
    const v: V3[] = [];
    for (const [w, d, py, pz] of [[w0, d0, y, z], [w1, d1, y + h, z + shift]] as const) {
      v.push([x - w / 2, py, pz - d / 2], [x + w / 2, py, pz - d / 2], [x + w / 2, py, pz + d / 2], [x - w / 2, py, pz + d / 2]);
    }
    const inside = centroid(v);
    const face = (...i: number[]) => ({ pts: i.map((k) => v[k]!), inside });
    return add(solid(scene, [face(0, 1, 2, 3), face(4, 5, 6, 7), face(0, 1, 5, 4), face(1, 2, 6, 5), face(2, 3, 7, 6), face(3, 0, 4, 7)]), c);
  };
  /** A flat ring of square section, lying level around (x, y, z). */
  const ring = (c: RGB, radius: number, across: number, tall: number, segments: number, x: number, y: number, z: number): Mesh => {
    const faces: { pts: V3[]; inside: V3 }[] = [];
    const at = (angle: number, r: number, py: number): V3 => [x + Math.cos(angle) * r, py, z + Math.sin(angle) * r];
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      const r0 = radius - across / 2, r1 = radius + across / 2, y0 = y - tall / 2, y1 = y + tall / 2;
      const inside = at((a0 + a1) / 2, radius * Math.cos(Math.PI / segments), y);
      faces.push(
        { pts: [at(a0, r0, y1), at(a1, r0, y1), at(a1, r1, y1), at(a0, r1, y1)], inside },
        { pts: [at(a0, r0, y0), at(a1, r0, y0), at(a1, r1, y0), at(a0, r1, y0)], inside },
        { pts: [at(a0, r1, y0), at(a1, r1, y0), at(a1, r1, y1), at(a0, r1, y1)], inside },
        { pts: [at(a0, r0, y0), at(a1, r0, y0), at(a1, r0, y1), at(a0, r0, y1)], inside },
      );
    }
    return add(solid(scene, faces), c);
  };
  /** A faceted ball (twenty faces), by its centre. */
  const ball = (c: RGB, d: number, x: number, y: number, z: number, squash = 1): Mesh => {
    const mesh = CreatePolyhedron("part", { type: 3, size: d / 2 / 1.18 }, scene);
    mesh.position.set(x, y, z);
    mesh.scaling.y = squash;
    return add(mesh, c);
  };
  /** Wheels on one axle: a single roller across the vehicle, whose middle the body hides. */
  const axle = (z: number, d: number, width: number): Mesh => rod(TYRE, [-width / 2, d / 2, z], [width / 2, d / 2, z], d, d, 8);
  const done = (name: string): Model => ({ body: merged(body, `${name}-body`), trim: merged(trim, `${name}-trim`) });
  return { add, box, cyl, beam, rod, prism, frustum, ring, ball, axle, done, body };
}

/** Many parts as one mesh, with positions, normals and colours only. */
function merged(list: Mesh[], name: string): Mesh {
  const mesh = Mesh.MergeMeshes(list, true, true)!;
  mesh.name = name;
  mesh.removeVerticesData(VertexBuffer.UVKind);
  return mesh;
}

type Parts = ReturnType<typeof parts>;
const SIDES = [-1, 1] as const;

// ---------------------------------------------------------------- units

function hauler(p: Parts): void {
  for (const z of [-1.05, 0, 1.05]) p.axle(z, 0.8, 2.1);
  p.box(GRAPHITE, 1.3, 0.3, 3.1, 0, 0.6, 0);
  // The cab, its windscreen leaning back.
  p.frustum(STEEL, 1.6, 0.95, 1.45, 0.6, 0.95, 0, 0.75, 1.05, -0.12);
  p.beam(GLASS, [0, 1.15, 1.401], [0, 1.62, 1.255], 1.25, 0.06);
  p.box(TRIM, 1.35, 0.05, 0.55, 0, 1.72, 0.93);
  p.box(AMBER, 1.3, 0.1, 0.05, 0, 0.9, 1.535);
  // The open bed: the sides are the owner's colour.
  p.box(STEEL_D, 1.5, 0.1, 2.0, 0, 0.78, -0.55);
  for (const s of SIDES) p.box(TRIM, 0.12, 0.6, 1.9, s * 0.8, 1.05, -0.55);
  p.box(STEEL, 1.5, 0.6, 0.1, 0, 1.05, -1.5);
  p.box(STEEL, 1.6, 0.7, 0.12, 0, 1.1, 0.45);
}

function trooper(p: Parts): void {
  for (const s of SIDES) {
    p.frustum(GRAPHITE, 0.27, 0.38, 0.22, 0.26, 0.86, s * 0.17, 0, 0.02);
    p.box(TRIM, 0.28, 0.2, 0.38, s * 0.5, 1.5, 0);
  }
  p.box(GRAPHITE, 0.56, 0.2, 0.3, 0, 0.93, 0);
  p.frustum(STEEL, 0.5, 0.3, 0.74, 0.42, 0.55, 0, 1.0, 0);
  p.beam(TRIM, [0, 1.1, 0.172], [0, 1.5, 0.215], 0.52, 0.06);
  p.box(TRIM, 0.46, 0.44, 0.16, 0, 1.3, -0.27);
  // Arms to the rifle, which points ahead.
  p.beam(STEEL_D, [-0.5, 1.42, 0], [-0.1, 1.22, 0.5], 0.15);
  p.beam(STEEL_D, [0.5, 1.42, 0], [0.24, 1.2, 0.22], 0.15);
  p.box(GRAPHITE, 0.1, 0.15, 0.95, 0.16, 1.2, 0.5);
  p.box(WHITE, 0.34, 0.3, 0.36, 0, 1.72, 0.02);
  p.box(CYAN, 0.28, 0.09, 0.04, 0, 1.73, 0.2);
  p.box(TRIM, 0.36, 0.07, 0.38, 0, 1.895, 0.02);
}

function scout(p: Parts): void {
  for (const z of [-1.05, 1.05]) for (const s of SIDES) p.rod(TYRE, [s * 0.58, 0.5, z], [s * 0.98, 0.5, z], 1.0, 1.0, 8);
  p.prism(GRAPHITE, [[-1.45, 0.4], [1.45, 0.4], [1.6, 0.6], [0.6, 0.85], [-1.45, 0.85]], 1.3);
  p.beam(TRIM, [0, 0.825, 0.7], [0, 0.625, 1.5], 1.15, 0.06);
  p.box(TRIM, 1.15, 0.06, 0.7, 0, 0.86, -1.07);
  for (const s of SIDES) {
    p.box(TRIM, 0.05, 0.22, 1.9, s * 0.66, 0.66, -0.3);
    // The roll cage.
    p.beam(STEEL, [s * 0.6, 0.85, 0.5], [s * 0.5, 1.3, 0.2], 0.08);
    p.beam(STEEL, [s * 0.6, 0.85, -0.7], [s * 0.5, 1.3, -0.5], 0.08);
    p.beam(STEEL, [s * 0.5, 1.3, 0.24], [s * 0.5, 1.3, -0.54], 0.08);
  }
  p.box(TRIM, 1.0, 0.05, 0.72, 0, 1.345, -0.15);
  p.box(STEEL_D, 0.9, 0.35, 0.5, 0, 1.0, -0.3);
  p.box(GRAPHITE, 0.22, 0.18, 0.34, 0, 1.46, -0.1);
  p.rod(GRAPHITE, [0, 1.48, 0], [0, 1.48, 0.85], 0.1);
  p.box(AMBER, 0.9, 0.09, 0.05, 0, 0.52, 1.55);
}

/** Two tracks, from z = -length/2 to length/2. */
function tracks(p: Parts, x: number, width: number, length: number): void {
  const h = length / 2;
  for (const s of SIDES) p.prism(TYRE, [[-h, 0.3], [-h + 0.3, 0], [h - 0.35, 0], [h, 0.38], [h - 0.2, 0.8], [-h + 0.1, 0.8]], width, s * x);
  for (const s of SIDES) p.box(TRIM, width + 0.06, 0.06, length - 0.5, s * x, 0.84, -0.05);
}

function tank(p: Parts): void {
  tracks(p, 1.15, 0.65, 4.8);
  p.prism(STEEL, [[-2.3, 0.45], [2.4, 0.45], [2.5, 0.7], [1.1, 1.3], [-2.3, 1.3]], 1.7);
  p.beam(TRIM, [0, 1.2, 1.333], [0, 0.8, 2.267], 1.25, 0.06);
  p.box(GRAPHITE, 1.3, 0.1, 0.9, 0, 1.33, -1.8);
  // The flat turret and its gun.
  p.frustum(STEEL, 1.7, 2.1, 1.2, 1.4, 0.55, 0, 1.3, -0.4, -0.15);
  p.box(TRIM, 1.1, 0.05, 1.3, 0, 1.865, -0.55);
  p.box(STEEL_D, 0.7, 0.4, 0.4, 0, 1.55, 0.6);
  p.rod(GRAPHITE, [0, 1.55, 0.5], [0, 1.55, 2.9], 0.22);
  p.box(GRAPHITE, 0.34, 0.26, 0.4, 0, 1.55, 2.75);
  p.cyl(GRAPHITE, 0.5, 0.5, 0.12, 0.25, 1.89, -0.8, 6);
  p.box(CYAN, 0.3, 0.1, 0.12, -0.3, 1.93, 0);
  p.box(GRAPHITE, 0.04, 0.45, 0.04, -0.4, 2.1, -1.0);
}

function artillery(p: Parts): void {
  tracks(p, 1.1, 0.6, 4.4);
  p.prism(STEEL, [[-2.2, 0.45], [2.2, 0.45], [2.3, 0.8], [1.6, 1.15], [-2.2, 1.15]], 1.7);
  p.box(TRIM, 1.5, 0.05, 1.0, 0, 1.165, 0.3);
  p.box(STEEL_D, 0.8, 0.5, 0.9, -0.4, 1.4, 1.2);
  p.box(GLASS, 0.7, 0.25, 0.05, -0.4, 1.47, 1.66);
  p.frustum(GRAPHITE, 1.3, 1.6, 0.9, 1.0, 0.7, 0, 1.15, -1.0);
  // The twin rails, raised 35 degrees, with light between them.
  const from: V3 = [0, 1.7, -1.6], to: V3 = [0, 4.68, 2.66];
  for (const s of SIDES) p.beam(WHITE, [s * 0.18, from[1], from[2]], [s * 0.18, to[1], to[2]], 0.14, 0.26);
  p.beam(CYAN, mix(from, to, 0.1), to, 0.22, 0.08);
  for (const t of [0.3, 0.58, 0.86]) p.beam(GRAPHITE, mix(from, to, t), mix(from, to, t + 0.05), 0.62, 0.36);
  p.beam(TRIM, mix(from, to, -0.06), mix(from, to, 0.2), 0.78, 0.5);
  // Stabiliser legs, down on their pads.
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      p.beam(STEEL_D, [sx * 0.8, 0.95, sz * 1.9], [sx * 1.45, 0.05, sz * 2.3], 0.14);
      p.box(GRAPHITE, 0.42, 0.08, 0.42, sx * 1.45, 0.04, sz * 2.3);
    }
  }
}

function missile(p: Parts): void {
  for (const z of [-1.5, 0, 1.5]) p.axle(z, 0.9, 2.3);
  p.box(GRAPHITE, 1.7, 0.35, 4.4, 0, 0.7, 0);
  p.frustum(STEEL, 1.9, 1.1, 1.7, 0.75, 0.9, 0, 0.875, 1.6, -0.12);
  p.beam(GLASS, [0, 1.25, 2.027], [0, 1.68, 1.886], 1.5, 0.06);
  p.box(TRIM, 1.55, 0.05, 0.65, 0, 1.795, 1.48);
  p.box(AMBER, 1.5, 0.1, 0.05, 0, 1.0, 2.16);
  p.box(STEEL_D, 2.0, 0.12, 3.0, 0, 0.93, -0.65);
  for (const s of SIDES) p.box(TRIM, 0.06, 0.3, 2.9, s * 1.0, 0.85, -0.65);
  p.box(GRAPHITE, 1.6, 0.5, 1.0, 0, 1.2, -1.3);
  // Two pods, angled up toward the front.
  for (const s of SIDES) {
    const from: V3 = [s * 0.5, 1.3, -1.9], to: V3 = [s * 0.5, 2.125, 0.14];
    p.beam(WHITE, from, to, 0.85, 0.7);
    p.beam(TRIM, mix(from, to, 0.15), mix(from, to, 0.6), 0.9, 0.75);
    p.beam(GRAPHITE, mix(from, to, 0.99), mix(from, to, 1.02), 0.7, 0.55);
  }
}

/** A ducted rotor lying flat: the duct is the owner's colour. */
function rotor(p: Parts, x: number, y: number, z: number, d: number): void {
  p.cyl(TRIM, d, d, 0.2, x, y, z, 8);
  p.cyl(GRAPHITE, d * 0.82, d * 0.82, 0.24, x, y - 0.02, z, 6);
}

function gunship(p: Parts): void {
  p.prism(STEEL, [[-1.1, 0.45], [-0.7, 0.15], [0.9, 0.15], [1.5, 0.4], [0.7, 0.8], [-0.9, 0.7]], 0.8);
  p.beam(GLASS, [0, 0.74, 0.82], [0, 0.5, 1.3], 0.6, 0.06);
  p.beam(TRIM, [0, 0.71, -0.75], [0, 0.79, 0.55], 0.62, 0.06);
  p.box(GRAPHITE, 0.16, 0.12, 3.4, 0, 0.5, 0, Math.PI / 4);
  p.box(GRAPHITE, 0.16, 0.12, 3.4, 0, 0.5, 0, -Math.PI / 4);
  for (const sx of SIDES) for (const sz of SIDES) rotor(p, sx * 1.2, 0.45, sz * 1.2, 1.2);
  p.box(GRAPHITE, 0.2, 0.15, 0.3, 0, 0.12, 0.6);
  p.rod(GRAPHITE, [0, 0.09, 0.5], [0, 0.09, 1.5], 0.12);
  p.box(TRIM, 0.06, 0.45, 0.5, 0, 0.87, -0.8);
}

function transport(p: Parts): void {
  p.prism(STEEL, [[-2.7, 0.8], [-2.1, 0], [2.1, 0], [2.9, 0.6], [2.5, 1.6], [-2.5, 1.7]], 1.9);
  p.beam(GLASS, [0, 0.9, 2.78], [0, 1.45, 2.56], 1.5, 0.06);
  p.beam(TRIM, [0, 1.69, -2.0], [0, 1.618, 1.6], 1.6, 0.06);
  for (const s of SIDES) {
    p.box(TRIM, 0.06, 0.5, 3.6, s * 0.95, 0.9, -0.2);
    p.box(GRAPHITE, 4.4, 0.14, 0.5, 0, 1.5, s * 1.7);
    p.box(STEEL_D, 0.08, 0.75, 0.8, s * 0.6, 2.0, -2.0);
    for (const sz of SIDES) rotor(p, s * 1.75, 1.42, sz * 1.7, 1.5);
  }
  // The loading ramp at the back.
  p.beam(GRAPHITE, [0, 0.7, -2.625], [0, 0.1, -2.175], 1.5, 0.06);
}

function emp(p: Parts): void {
  p.frustum(GRAPHITE, 0.4, 0.4, 1.0, 1.0, 0.4, 0, 0, 0);
  p.frustum(WHITE, 1.0, 1.0, 0.5, 0.5, 0.45, 0, 0.4, 0);
  p.ball(CYAN, 0.55, 0, 0.9, 0);
  // The emitter: an open ring, held by four spokes.
  p.ring(TRIM, 1.25, 0.2, 0.2, 12, 0, 0.5, 0);
  p.box(GRAPHITE, 2.4, 0.08, 0.1, 0, 0.5, 0);
  p.box(GRAPHITE, 0.1, 0.08, 2.4, 0, 0.5, 0);
  for (const sx of SIDES) for (const sz of SIDES) p.box(CYAN, 0.3, 0.28, 0.3, sx * 0.884, 0.5, sz * 0.884, Math.PI / 4);
}

function titan(p: Parts): void {
  for (const s of SIDES) {
    const x = s * 1.2;
    p.frustum(GRAPHITE, 1.3, 2.2, 0.9, 1.3, 0.5, x, 0, 0.2);
    p.beam(STEEL, [x, 0.4, 0.1], [x, 2.3, -0.5], 0.7, 0.8);
    p.beam(TRIM, [x, 0.81, 0.41], [x, 2.24, -0.04], 0.5, 0.1);
    p.rod(GRAPHITE, [x - 0.5, 2.25, -0.5], [x + 0.5, 2.25, -0.5], 0.95);
    p.beam(STEEL_D, [x, 2.2, -0.5], [x, 3.8, 0.3], 0.8, 0.9);
    // Shoulder armour.
    p.box(TRIM, 0.9, 1.0, 1.9, s * 1.8, 5.75, 0);
    p.box(GRAPHITE, 0.5, 0.9, 0.5, s * 0.6, 6.55, -1.25);
  }
  p.box(GRAPHITE, 2.6, 0.8, 1.5, 0, 3.9, 0.2);
  // The hunched hull.
  p.prism(STEEL, [[-1.5, 4.2], [1.3, 4.2], [2.1, 5.0], [1.4, 6.3], [-0.7, 6.7], [-1.8, 5.7]], 2.6);
  p.beam(CYAN, [0, 5.4, 1.885], [0, 5.8, 1.669], 1.6, 0.08);
  p.beam(TRIM, [0, 6.338, 1.2], [0, 6.662, -0.5], 2.0, 0.08);
  p.beam(TRIM, [0, 6.5, -0.92], [0, 5.9, -1.58], 2.0, 0.08);
  // The cannon on one side, the missile pod on the other.
  p.box(GRAPHITE, 0.8, 0.9, 1.6, 1.8, 4.7, 0.2);
  p.rod(STEEL_D, [1.8, 4.7, 0.8], [1.8, 4.7, 3.3], 0.45);
  p.box(GRAPHITE, 0.6, 0.6, 0.5, 1.8, 4.7, 3.1);
  p.box(WHITE, 0.9, 1.0, 1.7, -1.8, 4.65, 0.3);
  p.box(GRAPHITE, 0.75, 0.85, 0.06, -1.8, 4.65, 1.17);
}

// ------------------------------------------------------------ buildings

function core(p: Parts): void {
  p.frustum(STEEL_D, 14.2, 14.2, 11.5, 11.5, 2.6, 0, 0, 0);
  p.box(TRIM, 11.3, 0.12, 11.3, 0, 2.62, 0);
  p.frustum(STEEL, 9, 9, 7.2, 7.2, 2.6, 0, 2.6, 0);
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      p.frustum(GRAPHITE, 2.2, 2.2, 1.6, 1.6, 3.3, sx * 6.0, 0, sz * 6.0);
      p.box(AMBER, 0.5, 0.25, 0.5, sx * 6.0, 3.42, sz * 6.0);
    }
  }
  // The way in, toward +z.
  p.box(GRAPHITE, 4.0, 2.4, 1.4, 0, 1.2, 6.5);
  p.box(GLASS, 2.6, 1.8, 0.06, 0, 0.9, 7.21);
  p.box(TRIM, 4.2, 0.5, 1.5, 0, 2.55, 6.5);
  // The tower, with its deck and roof.
  p.cyl(WHITE, 3.6, 2.8, 6.0, 0, 5.2, 0, 8);
  p.cyl(TRIM, 3.33, 3.17, 1.2, 0, 8.0, 0, 8);
  p.cyl(GRAPHITE, 3.0, 4.4, 0.8, 0, 11.2, 0, 8);
  p.cyl(GLASS, 4.5, 4.5, 0.5, 0, 12.0, 0, 8);
  p.cyl(TRIM, 4.7, 3.6, 0.4, 0, 12.5, 0, 8);
  p.box(GRAPHITE, 0.12, 1.2, 0.12, 0.8, 13.5, 0);
  p.box(GRAPHITE, 0.08, 0.8, 0.08, -0.7, 13.3, 0.5);
  p.box(RED, 0.25, 0.25, 0.25, 0.8, 14.05, 0);
  // The landing lights, and the dish.
  p.ring(CYAN, 3.0, 0.25, 0.12, 12, 0, 5.24, 0);
  p.box(GRAPHITE, 0.3, 1.3, 0.3, 2.6, 5.85, -2.6);
  const dish: V3 = [2.6, 6.5, -2.6], rim: V3 = [2.95, 6.95, -3.0];
  p.rod(WHITE, dish, rim, 0.3, 2.6, 8);
  p.rod(GRAPHITE, rim, mix(dish, rim, 1.7), 0.12);
}

function tap(p: Parts): void {
  p.box(GRAPHITE, 4.5, 0.3, 4.5, 0, 0.15, 0);
  // The pressure tank.
  p.cyl(WHITE, 2.0, 2.0, 2.8, -0.9, 0.3, -0.8, 8);
  p.cyl(TRIM, 2.0, 0.9, 0.5, -0.9, 3.1, -0.8, 8);
  p.cyl(TRIM, 2.1, 2.1, 0.8, -0.9, 1.6, -0.8, 8);
  p.cyl(GRAPHITE, 0.35, 0.35, 1.2, -0.9, 3.6, -0.8, 6);
  p.ball(VIOLET, 0.5, -0.9, 4.85, -0.8);
  // The wellhead and its valve wheel.
  p.cyl(STEEL, 0.9, 0.9, 2.0, 1.0, 0.3, 0.9, 8);
  for (const y of [0.9, 2.14]) p.cyl(STEEL_D, 1.25, 1.25, 0.16, 1.0, y, 0.9, 8);
  p.cyl(GRAPHITE, 0.16, 0.16, 0.5, 1.0, 2.3, 0.9, 6);
  p.ring(TRIM, 0.6, 0.14, 0.12, 8, 1.0, 2.8, 0.9);
  p.box(TRIM, 1.2, 0.08, 0.1, 1.0, 2.8, 0.9);
  p.box(TRIM, 0.1, 0.08, 1.2, 1.0, 2.8, 0.9);
  // Fat pipes: to the tank, and to the pump.
  p.rod(STEEL, [1.0, 1.5, 0.9], [-0.9, 1.5, 0.9], 0.55);
  p.rod(STEEL, [-0.9, 1.5, 1.0], [-0.9, 1.5, -0.2], 0.55);
  p.box(STEEL_D, 0.7, 0.7, 0.7, -0.9, 1.5, 0.9);
  p.rod(STEEL, [1.0, 0.75, 0.9], [1.0, 0.75, -1.2], 0.6);
  p.box(GRAPHITE, 1.2, 1.0, 1.0, 1.1, 0.8, -1.5);
  p.box(VIOLET, 0.6, 0.06, 0.4, 1.1, 1.32, -1.5);
}

function relay(p: Parts): void {
  p.box(GRAPHITE, 3.6, 0.3, 3.6, 0, 0.15, 0);
  p.box(TRIM, 3.0, 0.06, 3.0, 0, 0.32, 0);
  /** Half the mast's width at a height. */
  const half = (y: number) => 1.0 - (0.7 * (y - 0.3)) / 10.1;
  const levels = [0.3, 2.8, 5.3, 7.8, 10.4];
  for (const sx of SIDES) for (const sz of SIDES) p.beam(STEEL_D, [sx * 1.0, 0.3, sz * 1.0], [sx * 0.3, 10.4, sz * 0.3], 0.16);
  for (const y of levels.slice(1, 4)) {
    const r = half(y);
    for (const s of SIDES) {
      p.box(TRIM, 2 * r + 0.2, 0.22, 0.22, 0, y, s * r);
      p.box(TRIM, 0.22, 0.22, 2 * r + 0.2, s * r, y, 0);
    }
  }
  // Braces, zigzagging up each face.
  for (let bay = 0; bay < 4; bay++) {
    const y0 = levels[bay]!, y1 = levels[bay + 1]!, r0 = half(y0), r1 = half(y1), d = bay % 2 ? 1 : -1;
    p.beam(STEEL_D, [d * r0, y0, r0], [-d * r1, y1, r1], 0.1);
    p.beam(STEEL_D, [d * r0, y0, -r0], [-d * r1, y1, -r1], 0.1);
    p.beam(STEEL_D, [r0, y0, d * r0], [r1, y1, -d * r1], 0.1);
    p.beam(STEEL_D, [-r0, y0, d * r0], [-r1, y1, -d * r1], 0.1);
  }
  p.box(TRIM, 0.95, 1.4, 0.95, 0, 9.5, 0);
  p.box(GRAPHITE, 1.2, 0.2, 1.2, 0, 10.5, 0);
  p.cyl(GRAPHITE, 0.14, 0.14, 0.9, 0, 10.6, 0, 6);
  p.ball(RED, 0.5, 0, 11.7, 0);
  // Dishes.
  p.rod(WHITE, [0, 7.0, 0.55], [0, 7.15, 1.05], 0.2, 1.4, 8);
  p.rod(WHITE, [-0.65, 6.0, 0], [-1.15, 6.15, 0], 0.2, 1.3, 8);
  p.rod(WHITE, [0.4, 8.5, -0.4], [0.75, 8.6, -0.75], 0.2, 1.1, 8);
}

function foundry(p: Parts): void {
  p.box(GRAPHITE, 9.6, 0.2, 9.6, 0, 0.1, 0);
  p.box(STEEL, 9, 4.4, 7.2, 0, 2.4, 0.9);
  // A sawtooth roof: the slopes are the owner's colour, the upright faces glass.
  for (let k = 0; k < 3; k++) {
    const z = -2.7 + k * 2.4;
    p.prism(TRIM, [[z, 4.6], [z + 2.4, 4.6], [z, 5.8]], 8.8);
    p.box(GLASS, 8.2, 0.8, 0.06, 0, 5.15, z);
  }
  // The big door.
  p.box(TRIM, 5.4, 4.1, 0.08, 0, 2.25, 4.5);
  p.box(GRAPHITE, 4.6, 3.6, 0.12, 0, 2.0, 4.5);
  for (const y of [1.4, 2.6]) p.box(STEEL_D, 4.6, 0.08, 0.04, 0, y, 4.57);
  p.box(AMBER, 3.0, 0.2, 0.1, 0, 4.05, 4.52);
  for (const s of SIDES) {
    p.box(TRIM, 0.06, 0.7, 7.0, s * 4.5, 3.9, 0.9);
    for (const z of [-1.5, 0.9, 3.3]) p.box(STEEL_D, 0.2, 4.4, 0.3, s * 4.55, 2.4, z);
  }
  // The annex behind: vents and the chimney.
  p.box(GRAPHITE, 9.0, 2.6, 1.9, 0, 1.5, -3.65);
  for (const x of [-3, -1.2, 0.6]) p.cyl(STEEL_D, 0.9, 0.7, 0.7, x, 2.8, -3.65, 6);
  p.cyl(WHITE, 1.5, 1.2, 4.2, 3.3, 2.8, -3.65, 8);
  p.cyl(TRIM, 1.4, 1.34, 0.8, 3.3, 5.6, -3.65, 8);
  p.cyl(GRAPHITE, 1.0, 1.0, 0.1, 3.3, 6.95, -3.65, 6);
}

function armory(p: Parts): void {
  p.frustum(STEEL_D, 9.4, 9.4, 6.6, 6.6, 3.0, 0, 0, 0);
  p.box(TRIM, 6.4, 0.1, 6.4, 0, 3.03, 0);
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      p.frustum(GRAPHITE, 1.8, 1.8, 1.2, 1.2, 2.2, sx * 3.9, 0, sz * 3.9);
      p.box(TRIM, 1.0, 0.1, 1.0, sx * 3.9, 2.25, sz * 3.9);
    }
  }
  // The laboratory on the roof, and its dome.
  p.frustum(GRAPHITE, 3.6, 3.6, 2.8, 2.8, 1.3, -1.0, 3.0, -1.0);
  p.box(CYAN, 2.0, 0.3, 0.1, -1.0, 3.7, 0.57);
  p.box(TRIM, 2.6, 0.06, 2.6, -1.0, 4.32, -1.0);
  p.ball(WHITE, 2.0, 1.7, 3.2, 1.5, 0.7);
  // The hatch, toward +z.
  p.box(STEEL, 2.8, 2.2, 1.6, 0, 1.1, 3.9);
  p.rod(TRIM, [0, 1.1, 4.69], [0, 1.1, 4.74], 2.1, 2.1, 8);
  p.rod(GRAPHITE, [0, 1.1, 4.7], [0, 1.1, 4.78], 1.7, 1.7, 8);
  p.box(STEEL, 1.0, 0.14, 0.06, 0, 1.1, 4.8);
  p.box(STEEL, 0.14, 1.0, 0.06, 0, 1.1, 4.8);
  // A rack of antennae.
  p.box(GRAPHITE, 0.4, 0.3, 3.2, 2.6, 3.2, -1.0);
  [2.7, 1.9, 2.5, 1.6, 2.2].forEach((h, i) => p.box(GRAPHITE, 0.08, h, 0.08, 2.6, 3.3 + h / 2, -2.4 + i * 0.7));
}

function skyport(p: Parts): void {
  p.box(GRAPHITE, 9.6, 0.5, 9.6, 0, 0.25, 0);
  // The pad and its painted markings.
  p.cyl(STEEL_D, 7.6, 7.6, 0.08, 0.5, 0.5, 0.6, 12);
  p.ring(TRIM, 2.9, 0.45, 0.06, 12, 0.5, 0.6, 0.6);
  p.box(TRIM, 0.5, 0.06, 3.2, 0.5, 0.6, 0.6);
  p.box(TRIM, 3.2, 0.06, 0.5, 0.5, 0.6, 0.6);
  p.box(TRIM, 9.2, 0.06, 0.3, 0, 0.52, 4.5);
  p.box(TRIM, 0.3, 0.06, 7.0, 4.5, 0.52, 0.6);
  for (const [x, z] of [[4.5, 4.5], [4.5, -4.5], [-4.5, 4.5]] as const) p.box(AMBER, 0.3, 0.25, 0.3, x, 0.62, z);
  // The control tower, at the back corner.
  p.box(WHITE, 1.8, 6.0, 1.8, -3.4, 3.5, -3.4);
  p.box(TRIM, 1.9, 1.2, 1.9, -3.4, 4.6, -3.4);
  p.frustum(GLASS, 2.0, 2.0, 2.8, 2.8, 1.3, -3.4, 6.5, -3.4);
  p.box(TRIM, 3.0, 0.15, 3.0, -3.4, 7.88, -3.4);
  p.box(GRAPHITE, 0.1, 1.0, 0.1, -3.4, 8.45, -3.4);
  p.box(RED, 0.25, 0.2, 0.25, -3.4, 9.0, -3.4);
  p.rod(WHITE, [-2.8, 7.95, -3.0], [-2.6, 8.3, -2.7], 0.15, 0.9, 6);
  // Machinery and a fuel tank along the back.
  p.box(STEEL, 2.4, 1.6, 1.6, 3.4, 1.3, -3.9);
  p.box(TRIM, 2.2, 0.08, 1.4, 3.4, 2.13, -3.9);
  p.rod(WHITE, [0.0, 1.1, -4.0], [1.7, 1.1, -4.0], 1.2, 1.2, 8);
}

function titanbay(p: Parts): void {
  p.box(GRAPHITE, 14.4, 0.4, 14.4, 0, 0.2, 0);
  p.ring(TRIM, 3.5, 0.5, 0.06, 12, 0, 0.42, 0);
  p.box(TRIM, 10, 0.06, 0.6, 0, 0.42, 6.6);
  for (const sx of SIDES) {
    const x = sx * 6.4;
    for (const sz of SIDES) {
      p.box(STEEL, 1.2, 11, 1.2, x, 5.9, sz * 6.4);
      p.box(TRIM, 1.34, 2.0, 1.34, x, 1.6, sz * 6.4);
      // Cross braces between the columns, below and above the girt.
      p.beam(GRAPHITE, [x, 0.5, sz * 5.8], [x, 5.6, -sz * 5.8], 0.3);
      p.beam(GRAPHITE, [x, 5.8, sz * 5.8], [x, 10.9, -sz * 5.8], 0.3);
    }
    p.box(TRIM, 1.0, 1.0, 14.2, x, 11.5, 0);
    p.box(STEEL_D, 0.5, 0.5, 11.6, x, 5.7, 0);
    // Service platforms along the sides.
    p.box(STEEL_D, 1.6, 0.25, 8, sx * 5.2, 5.9, -1.5);
    p.box(TRIM, 0.1, 0.8, 8, sx * 4.45, 6.4, -1.5);
    p.beam(GRAPHITE, [sx * 5.8, 0.5, -6.4], [-sx * 5.8, 5.6, -6.4], 0.3);
    p.beam(GRAPHITE, [sx * 5.8, 5.8, -6.4], [-sx * 5.8, 10.9, -6.4], 0.3);
  }
  p.box(STEEL, 11.8, 1.0, 1.0, 0, 11.5, -6.4);
  p.box(STEEL_D, 11.6, 0.5, 0.5, 0, 5.7, -6.4);
  p.box(STEEL_D, 11.8, 0.6, 0.6, 0, 11.6, 6.4);
  p.box(AMBER, 8, 0.2, 0.1, 0, 11.5, 6.72);
  // Half a roof at the back; the front is open to the sky.
  p.box(TRIM, 11.8, 0.2, 6.0, 0, 11.93, -3.4);
  // The crane: bridge, trolley, cable and hook.
  p.box(WHITE, 11.8, 0.8, 1.0, 0, 10.5, 2.2);
  p.box(GRAPHITE, 1.4, 0.7, 1.4, 1.5, 9.85, 2.2);
  p.box(GRAPHITE, 0.1, 3.0, 0.1, 1.5, 8.0, 2.2);
  p.box(AMBER, 0.7, 0.6, 0.7, 1.5, 6.3, 2.2);
}

function sentry(p: Parts): void {
  p.frustum(GRAPHITE, 4.2, 4.2, 3.4, 3.4, 0.5, 0, 0, 0);
  p.cyl(STEEL, 2.2, 1.6, 1.5, 0, 0.5, 0, 8);
  p.cyl(TRIM, 2.0, 2.0, 0.25, 0, 2.0, 0, 8);
  p.prism(WHITE, [[-1.2, 2.25], [1.0, 2.25], [1.4, 2.7], [0.9, 3.4], [-1.1, 3.4]], 1.7);
  p.box(TRIM, 1.5, 0.06, 1.7, 0, 3.42, -0.15);
  for (const s of SIDES) {
    p.box(TRIM, 0.08, 0.7, 1.6, s * 0.86, 2.85, -0.1);
    p.rod(GRAPHITE, [s * 0.45, 2.75, 0.9], [s * 0.45, 2.75, 2.4], 0.3);
    p.box(STEEL_D, 0.5, 0.5, 0.6, s * 0.45, 2.75, 1.3);
  }
  p.box(CYAN, 0.4, 0.15, 0.06, 0, 3.15, 1.07);
  p.box(GRAPHITE, 0.06, 0.6, 0.06, -0.6, 3.7, -0.9);
}

function flak(p: Parts): void {
  p.frustum(GRAPHITE, 4.2, 4.2, 3.4, 3.4, 0.5, 0, 0, 0);
  p.cyl(STEEL, 2.6, 2.2, 0.9, 0, 0.5, 0, 8);
  p.cyl(TRIM, 2.2, 2.2, 0.3, 0, 1.4, 0, 8);
  for (const s of SIDES) {
    p.box(WHITE, 0.25, 1.3, 1.3, s * 0.85, 2.3, 0);
    p.box(TRIM, 0.06, 0.9, 0.9, s * 0.99, 2.3, 0);
  }
  p.box(GRAPHITE, 0.8, 0.6, 0.6, 0, 2.0, -0.9);
  // The breech and four barrels, 45 degrees up.
  p.beam(TRIM, [0, 1.95, -0.45], [0, 2.75, 0.35], 1.3, 0.9);
  for (const sx of SIDES) {
    for (const o of [-0.2, 0.2]) {
      const y = 2.5 + o * 0.707, z = 0.1 - o * 0.707;
      p.rod(GRAPHITE, [sx * 0.3, y, z], [sx * 0.3, y + 1.41, z + 1.41], 0.2);
    }
  }
}

function laser(p: Parts): void {
  p.frustum(GRAPHITE, 4.0, 4.0, 3.2, 3.2, 0.4, 0, 0, 0);
  p.frustum(STEEL_D, 2.4, 2.4, 1.4, 1.4, 1.0, 0, 0.4, 0);
  p.box(TRIM, 1.5, 0.08, 1.5, 0, 1.42, 0);
  p.cyl(STEEL, 1.0, 0.8, 2.8, 0, 1.4, 0, 6);
  // Cooling fins up the post; the top one is the owner's colour.
  for (const y of [1.9, 2.5, 3.1]) p.cyl(WHITE, 2.2, 2.2, 0.1, 0, y, 0, 8);
  p.cyl(TRIM, 2.2, 2.2, 0.1, 0, 3.7, 0, 8);
  p.cyl(TRIM, 1.5, 1.9, 0.5, 0, 4.2, 0, 8);
  for (const s of SIDES) p.box(TRIM, 0.2, 1.3, 0.5, s * 0.85, 5.1, 0);
  p.ball(VIOLET, 1.5, 0, 5.3, 0);
}

const UNIT_MODELS: Readonly<Record<UnitKind, (p: Parts) => void>> = { hauler, trooper, scout, tank, artillery, missile, gunship, transport, emp, titan };
const BUILDING_MODELS: Readonly<Record<BuildingKind, (p: Parts) => void>> = { core, tap, relay, foundry, armory, skyport, titanbay, sentry, flak, laser };

/** A unit, standing on the ground at its origin, facing +z. Drones: origin at the bottom of the hull (they are drawn at flying height by the caller). */
export function unitModel(kind: UnitKind, scene: Scene): Model {
  const p = parts(scene);
  UNIT_MODELS[kind](p);
  return p.done(`mojave-${kind}`);
}

/** A building, origin at the centre of its footprint on the ground, front toward +z. */
export function buildingModel(kind: BuildingKind, scene: Scene): Model {
  const p = parts(scene);
  BUILDING_MODELS[kind](p);
  return p.done(`mojave-${kind}`);
}

/** A cluster of lithium crystals filling most of one 5 m cell (one mesh, coloured by vertex: pale blue-green, a little glow). */
export function crystalModel(scene: Scene): Mesh {
  // Each shard: where it stands (x, z), its radius and length, and how far it leans (x, z).
  const shards: readonly (readonly [number, number, number, number, number, number])[] = [
    [0, 0, 0.55, 3.3, 0.05, 0.02],
    [1.0, 0.5, 0.4, 2.3, 0.35, 0.15],
    [-0.9, 0.7, 0.38, 2.1, -0.3, 0.25],
    [0.4, -1.1, 0.42, 2.5, 0.1, -0.35],
    [-0.8, -0.8, 0.35, 1.8, -0.3, -0.3],
    [1.3, -0.6, 0.28, 1.4, 0.5, -0.2],
    [-1.4, -0.1, 0.26, 1.3, -0.5, 0.05],
    [0.2, 1.3, 0.3, 1.5, 0.05, 0.45],
  ];
  const sides = 5;
  const list = shards.map(([x, z, r, length, leanX, leanZ], n) => {
    // A five-sided column with a point, made along y from -length/2.
    const shoulder = length * 0.22, base = -length / 2, tip: V3 = [0, length / 2, 0];
    const corner = (i: number, y: number): V3 => {
      const a = (i / sides) * Math.PI * 2 + n;
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    };
    const faces: { pts: V3[]; inside: V3 }[] = [];
    for (let i = 0; i < sides; i++) {
      faces.push({ pts: [corner(i, base), corner(i + 1, base), corner(i + 1, shoulder), corner(i, shoulder)], inside: [0, 0, 0] });
      faces.push({ pts: [corner(i, shoulder), corner(i + 1, shoulder), tip], inside: [0, 0, 0] });
    }
    const mesh = solid(scene, faces);
    // Deep blue-green at the foot, pale and bright at the point.
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const colors = new Float32Array((positions.length / 3) * 4);
    for (let i = 0; i < positions.length / 3; i++) {
      const t = Math.min(1, Math.max(0, positions[i * 3 + 1]! / length + 0.5));
      colors.set([0.3 + 0.55 * t, 0.72 + 0.28 * t, 0.7 + 0.28 * t, 1], i * 4);
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    const scale = length / Math.hypot(leanX, 1, leanZ);
    along(mesh, [x, -0.15, z], [x + leanX * scale, -0.15 + scale, z + leanZ * scale]);
    mesh.computeWorldMatrix(true);
    return mesh;
  });
  return merged(list, "mojave-crystal");
}

/** A plasma vent in one 5 m cell: a low rocky mound with a dark throat and a violet glow in it (one mesh, coloured by vertex). */
export function ventModel(scene: Scene): Mesh {
  const p = parts(scene);
  const mound = p.cyl(ROCK, 4.5, 2.3, 0.8, 0, 0, 0, 7);
  mound.scaling.z = 0.92;
  mound.computeWorldMatrix(true);
  p.cyl(TYRE, 1.9, 1.9, 0.06, 0, 0.78, 0, 7);
  p.cyl(VIOLET, 1.1, 1.1, 0.05, 0, 0.82, 0, 7);
  p.ball(VIOLET, 0.5, 0, 0.95, 0, 0.6);
  // Rocks around the rim.
  const rocks: readonly (readonly [number, number, number])[] = [[0.4, 0.8, 0.85], [1.7, 0.55, 0.7], [2.9, 0.9, 0.6], [4.1, 0.6, 0.9], [5.3, 0.75, 0.7]];
  for (const [angle, size, squash] of rocks) p.ball(ROCK_D, size, Math.cos(angle) * 1.25, 0.8, Math.sin(angle) * 1.2, squash);
  return merged(p.body, "mojave-vent");
}
