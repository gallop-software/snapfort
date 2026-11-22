import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox, PhysicsShapeConvexHull, PhysicsShapeMesh, type PhysicsShape } from "@babylonjs/core/Physics/v2/physicsShape";
import "@babylonjs/core/Rendering/edgesRenderer";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildState } from "../game/buildState";
import { CELL, LEVEL, THICK } from "../game/constants";
import { MATERIAL_DEFS, MATERIALS, PIECE_TYPES, pieceTransform, type MaterialId, type Piece, type PieceSpec, type PieceType } from "../game/pieces";
import { editedGeometry, pieceGeometry } from "./geometry";
import { pieceTexture } from "./textures";

const UP = Vector3.Up();
const ONE = Vector3.One();
const tmpPos = new Vector3();
const tmpRot = new Quaternion();
const tmpMatrix = new Matrix();

function composeTransform(spec: PieceSpec, scale: Vector3 = ONE): Matrix {
  const t = pieceTransform(spec);
  Quaternion.RotationAxisToRef(UP, t.yaw, tmpRot);
  tmpPos.set(t.px, t.py, t.pz);
  return Matrix.ComposeToRef(scale, tmpRot, tmpPos, tmpMatrix);
}

/** Slight per-piece shade so a wall of identical pieces still looks hand laid. */
function shade(piece: PieceSpec): number {
  let h = (piece.x * 73856093) ^ (piece.y * 19349663) ^ (piece.z * 83492791) ^ (piece.rot * 2654435761);
  h = (h ^ (h >>> 13)) * 1274126177;
  return 0.95 + ((((h ^ (h >>> 16)) >>> 0) % 1000) / 1000) * 0.09;
}

/** A piece's colour: its material, its own shade, darkened and reddened as it is battered (0..1). */
function pieceColor(piece: Piece, damage = 0): [number, number, number] {
  const [r, g, b] = MATERIAL_DEFS[piece.material].color;
  const k = shade(piece) * (1 - 0.6 * damage);
  return [Math.min(1, r * k + 0.12 * damage), Math.min(1, g * k), Math.min(1, b * k)];
}

const poolKey = (type: PieceType, material: MaterialId) => `${type}|${material}`;

/** All whole pieces of one type and material, drawn in a single call with thin instances. */
class InstancePool {
  private capacity = 256;
  private matrices = new Float32Array(this.capacity * 16);
  private colors = new Float32Array(this.capacity * 4);
  private readonly ids: string[] = [];
  private readonly indexOf = new Map<string, number>();
  private dirty = false;
  private resized = true;

  get size(): number {
    return this.ids.length;
  }

  constructor(private readonly mesh: Mesh) {
    mesh.setEnabled(false);
  }

  add(id: string, matrix: Matrix, [r, g, b]: [number, number, number]): void {
    const i = this.ids.length;
    if (i === this.capacity) this.grow();
    matrix.copyToArray(this.matrices, i * 16);
    this.colors.set([r, g, b, 1], i * 4);
    this.ids.push(id);
    this.indexOf.set(id, i);
    this.dirty = true;
  }

  setColor(id: string, [r, g, b]: [number, number, number]): void {
    const i = this.indexOf.get(id);
    if (i === undefined) return;
    this.colors.set([r, g, b, 1], i * 4);
    this.dirty = true;
  }

  remove(id: string): void {
    const i = this.indexOf.get(id);
    if (i === undefined) return;
    const last = this.ids.length - 1;
    if (i !== last) {
      this.matrices.copyWithin(i * 16, last * 16, last * 16 + 16);
      this.colors.copyWithin(i * 4, last * 4, last * 4 + 4);
      const moved = this.ids[last]!;
      this.ids[i] = moved;
      this.indexOf.set(moved, i);
    }
    this.ids.pop();
    this.indexOf.delete(id);
    this.dirty = true;
  }

  has(id: string): boolean {
    return this.indexOf.has(id);
  }

  /** Problems with this pool's own bookkeeping or what it last sent to the GPU (development checks). */
  check(name: string): string[] {
    const problems: string[] = [];
    if (this.dirty) return problems;
    if (this.mesh.thinInstanceCount !== this.ids.length) problems.push(`${name}: drawing ${this.mesh.thinInstanceCount} of ${this.ids.length}`);
    if (this.mesh.isEnabled() !== this.ids.length > 0) problems.push(`${name}: enabled=${this.mesh.isEnabled()} with ${this.ids.length} pieces`);
    this.ids.forEach((id, i) => this.indexOf.get(id) !== i && problems.push(`${name}: index of ${id} is wrong`));
    if (this.indexOf.size !== this.ids.length) problems.push(`${name}: index has ${this.indexOf.size} entries for ${this.ids.length} pieces`);
    return problems;
  }

  /** Whether the stored transform of a piece matches `matrix`. */
  matches(id: string, matrix: Matrix): boolean {
    const i = this.indexOf.get(id);
    if (i === undefined) return false;
    const m = matrix.asArray();
    for (let k = 0; k < 16; k++) if (Math.abs(this.matrices[i * 16 + k]! - m[k]!) > 1e-4) return false;
    return true;
  }

  /** Pushes pending changes to the GPU. Call once a frame. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const count = this.ids.length;
    if (this.resized) {
      this.resized = false;
      this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
      this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
      this.mesh.thinInstanceCount = count;
    } else {
      // Set the count first: Babylon only uploads the first `thinInstanceCount`
      // entries, so a piece added this frame would otherwise never reach the GPU
      // and stay invisible while still taking up its slot.
      this.mesh.thinInstanceCount = count;
      this.mesh.thinInstanceBufferUpdated("matrix");
      this.mesh.thinInstanceBufferUpdated("color");
    }
    // A thin-instance mesh with no instances would draw itself once at the origin.
    this.mesh.setEnabled(count > 0);
  }

  private grow(): void {
    this.capacity *= 2;
    const matrices = new Float32Array(this.capacity * 16);
    matrices.set(this.matrices);
    this.matrices = matrices;
    const colors = new Float32Array(this.capacity * 4);
    colors.set(this.colors);
    this.colors = colors;
    this.resized = true;
  }
}

function makeMesh(data: VertexData, scene: Scene, name: string): Mesh {
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

function paintMesh(mesh: Mesh, [r, g, b]: [number, number, number]): void {
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([r, g, b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors, true);
}

/**
 * Draws the build and keeps its collision in step. It only listens to the
 * BuildState; it never changes it. Whole pieces are thin instances; edited
 * pieces (with tiles cut out) each get their own mesh and mesh collider.
 */
export class PieceView {
  private readonly pools = new Map<string, InstancePool>();
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly shapes = {} as Record<PieceType, PhysicsShape>;
  private readonly bodies = new Map<string, PhysicsBody>();
  private readonly edited = new Map<string, { mesh: Mesh; shape: PhysicsShape }>();

  constructor(
    private readonly scene: Scene,
    state: BuildState,
    private readonly shadows: ShadowGenerator,
  ) {
    for (const type of PIECE_TYPES) {
      for (const material of MATERIALS) {
        const key = poolKey(type, material);
        const mat = new StandardMaterial(`piece-${key}`, scene);
        mat.diffuseTexture = pieceTexture(type, material, scene);
        mat.specularColor = material === "metal" ? new Color3(0.25, 0.25, 0.25) : Color3.Black();
        mat.specularPower = 24;
        this.materials.set(key, mat);
        const mesh = makeMesh(pieceGeometry(type), scene, `pieces-${key}`);
        mesh.material = mat;
        mesh.receiveShadows = true;
        // Instances are spread over the whole world, so skip per-mesh culling.
        mesh.alwaysSelectAsActiveMesh = true;
        shadows.addShadowCaster(mesh);
        this.pools.set(key, new InstancePool(mesh));
      }
    }

    this.shapes.wall = new PhysicsShapeBox(new Vector3(0, LEVEL / 2, 0), Quaternion.Identity(), new Vector3(CELL, LEVEL, THICK), scene);
    this.shapes.floor = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(CELL, THICK, CELL), scene);
    // A trebuchet is solid up to its arm's pivot, so builders walk around it, not through it.
    this.shapes.trebuchet = new PhysicsShapeBox(new Vector3(0, 1.6, 0), Quaternion.Identity(), new Vector3(CELL * 0.84, 3.2, CELL * 0.84), scene);
    for (const type of ["ramp", "roof"] as const) {
      const hull = makeMesh(pieceGeometry(type), scene, `hull-${type}`);
      this.shapes[type] = new PhysicsShapeConvexHull(hull, scene);
      hull.dispose();
    }

    for (const piece of state.all()) this.add(piece);
    state.subscribe((op, piece) => {
      if (op.kind === "place") this.add(piece);
      else if (op.kind === "remove") this.remove(piece);
      else {
        this.remove(piece);
        this.add(piece);
      }
    });
  }

  /**
   * A loose copy of a piece's mesh, in the same look and place, for rubble
   * (see debris.ts). The caller owns it.
   */
  debrisMesh(piece: Piece): Mesh {
    const data = piece.edit === 0 ? pieceGeometry(piece.type) : editedGeometry(piece.type, piece.edit);
    const mesh = makeMesh(data, this.scene, `debris-${piece.id}`);
    mesh.material = this.materials.get(poolKey(piece.type, piece.material))!;
    paintMesh(mesh, pieceColor(piece, 0.15));
    const t = pieceTransform(piece);
    mesh.position.set(t.px, t.py, t.pz);
    mesh.rotationQuaternion = Quaternion.RotationAxis(UP, t.yaw);
    return mesh;
  }

  /** The id of the piece a physics body belongs to, if it is a piece. */
  pieceIdOf(body: PhysicsBody | undefined): string | undefined {
    const id: unknown = body?.transformNode.metadata?.pieceId;
    return typeof id === "string" ? id : undefined;
  }

  /** Darkens a piece as it is battered. `damage` runs from 0 (new) to 1 (about to break). */
  setDamage(piece: Piece, damage: number): void {
    const color = pieceColor(piece, damage);
    const edited = this.edited.get(piece.id);
    if (edited) paintMesh(edited.mesh, color);
    else this.pools.get(poolKey(piece.type, piece.material))?.setColor(piece.id, color);
  }

  flush(): void {
    for (const pool of this.pools.values()) pool.flush();
  }

  /**
   * Development check: every piece in the build is drawn once, in the right
   * place, and has a collider in the right place; nothing else is drawn or
   * solid. Returns a list of problems (empty when all is well). Call after flush().
   */
  audit(state: BuildState): string[] {
    const problems: string[] = [];
    let editedCount = 0;
    for (const piece of state.all()) {
      const t = pieceTransform(piece);
      const body = this.bodies.get(piece.id);
      if (!body) problems.push(`${piece.type} ${piece.id} has no collider`);
      else {
        const p = body.transformNode.position;
        if (Math.abs(p.x - t.px) + Math.abs(p.y - t.py) + Math.abs(p.z - t.pz) > 1e-4) problems.push(`${piece.id} collider is misplaced`);
      }
      const key = poolKey(piece.type, piece.material);
      if (piece.edit === 0) {
        if (!this.pools.get(key)?.has(piece.id)) problems.push(`${piece.type} ${piece.id} is not drawn`);
        else if (!this.pools.get(key)!.matches(piece.id, composeTransform(piece))) problems.push(`${piece.id} is drawn in the wrong place`);
        if (this.edited.has(piece.id)) problems.push(`${piece.id} is drawn twice`);
      } else {
        editedCount++;
        const mesh = this.edited.get(piece.id)?.mesh;
        if (!mesh) problems.push(`edited ${piece.id} is not drawn`);
        else if (mesh.isDisposed() || !mesh.isEnabled()) problems.push(`edited ${piece.id} mesh is gone`);
        for (const [k, pool] of this.pools) if (pool.has(piece.id)) problems.push(`edited ${piece.id} still in pool ${k}`);
      }
    }
    if (this.bodies.size !== state.size) problems.push(`${this.bodies.size} colliders for ${state.size} pieces`);
    if (this.edited.size !== editedCount) problems.push(`${this.edited.size} edited meshes for ${editedCount} edited pieces`);
    let pooled = 0;
    for (const [key, pool] of this.pools) {
      problems.push(...pool.check(key));
      pooled += pool.size;
    }
    if (pooled !== state.size - editedCount) problems.push(`${pooled} pooled instances for ${state.size - editedCount} whole pieces`);
    return problems;
  }

  private add(piece: Piece): void {
    const t = pieceTransform(piece);
    let node: TransformNode;
    let shape: PhysicsShape;
    if (piece.edit === 0) {
      this.pools.get(poolKey(piece.type, piece.material))!.add(piece.id, composeTransform(piece), pieceColor(piece));
      node = new TransformNode(`p-${piece.id}`, this.scene);
      shape = this.shapes[piece.type];
    } else {
      const mesh = makeMesh(editedGeometry(piece.type, piece.edit), this.scene, `p-${piece.id}`);
      mesh.material = this.materials.get(poolKey(piece.type, piece.material))!;
      paintMesh(mesh, pieceColor(piece));
      mesh.receiveShadows = true;
      this.shadows.addShadowCaster(mesh);
      shape = new PhysicsShapeMesh(mesh, this.scene);
      this.edited.set(piece.id, { mesh, shape });
      node = mesh;
    }
    node.position.set(t.px, t.py, t.pz);
    node.rotationQuaternion = Quaternion.RotationAxis(UP, t.yaw);
    node.metadata = { pieceId: piece.id };
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = shape;
    // Pieces never move, so there is nothing to copy back from the physics world each frame.
    body.disableSync = true;
    this.bodies.set(piece.id, body);
  }

  private remove(piece: Piece): void {
    this.pools.get(poolKey(piece.type, piece.material))?.remove(piece.id);
    const body = this.bodies.get(piece.id);
    if (body) {
      const node = body.transformNode;
      body.dispose();
      this.bodies.delete(piece.id);
      const edited = this.edited.get(piece.id);
      if (edited) {
        this.shadows.removeShadowCaster(edited.mesh);
        edited.shape.dispose();
        this.edited.delete(piece.id);
      }
      node.dispose();
    }
  }
}

export type GhostLook = "ok" | "bad" | "remove";

const GHOST_COLORS: Record<GhostLook, Color3> = {
  ok: new Color3(0.25, 0.95, 0.55),
  bad: new Color3(1, 0.25, 0.22),
  remove: new Color3(1, 0.45, 0.1),
};

/** The translucent preview of the piece about to be placed, or the piece about to be removed. */
export class Ghost {
  private readonly meshes = {} as Record<PieceType, Mesh>;
  /** Shapes of edited pieces, made on first use, keyed by type and edit. */
  private readonly editedMeshes = new Map<string, Mesh>();
  private shown: Mesh | null = null;
  private readonly materials: Record<GhostLook, StandardMaterial>;
  private readonly scale = new Vector3(1.015, 1.015, 1.015);

  constructor(private readonly scene: Scene) {
    const make = (name: GhostLook, alpha: number) => {
      const m = new StandardMaterial(`ghost-${name}`, scene);
      m.disableLighting = true;
      m.emissiveColor = GHOST_COLORS[name];
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.alpha = alpha;
      m.fogEnabled = false;
      m.zOffset = -2;
      return m;
    };
    this.materials = { ok: make("ok", 0.38), bad: make("bad", 0.38), remove: make("remove", 0.55) };
    for (const type of PIECE_TYPES) {
      const mesh = makeMesh(pieceGeometry(type), scene, `ghost-${type}`);
      mesh.setEnabled(false);
      mesh.rotationQuaternion = Quaternion.Identity();
      // Outline, so the preview reads clearly against pieces of any colour.
      mesh.enableEdgesRendering(0.95);
      mesh.edgesWidth = 4;
      this.meshes[type] = mesh;
    }
  }

  /** Shows a preview at `spec`. Pass `edit` to show an edited piece's shape (tiles cut out). */
  show(spec: PieceSpec, look: GhostLook, edit = 0): void {
    const mesh = edit === 0 ? this.meshes[spec.type] : this.editedMesh(spec.type, edit);
    if (this.shown !== mesh) {
      this.shown?.setEnabled(false);
      this.shown = mesh;
    }
    mesh.setEnabled(true);
    composeTransform(spec).decompose(undefined, mesh.rotationQuaternion!, mesh.position);
    mesh.scaling.copyFrom(this.scale);
    mesh.material = this.materials[look];
    const c = GHOST_COLORS[look];
    mesh.edgesColor = new Color4(Math.min(1, c.r + 0.3), Math.min(1, c.g + 0.3), Math.min(1, c.b + 0.3), 1);
  }

  hide(): void {
    this.shown?.setEnabled(false);
    this.shown = null;
  }

  private editedMesh(type: PieceType, edit: number): Mesh {
    const key = `${type}|${edit}`;
    let mesh = this.editedMeshes.get(key);
    if (!mesh) {
      mesh = makeMesh(editedGeometry(type, edit), this.scene, `ghost-${key}`);
      mesh.rotationQuaternion = Quaternion.Identity();
      mesh.enableEdgesRendering(0.95);
      mesh.edgesWidth = 4;
      mesh.setEnabled(false);
      this.editedMeshes.set(key, mesh);
    }
    return mesh;
  }
}

const FLASH_TIME = 0.2;

/** A quick bright pop where a piece snaps in, so placing feels instant and solid. */
export class PlaceFlash {
  private readonly templates = {} as Record<PieceType, Mesh>;
  private readonly active: { mesh: Mesh; t: number }[] = [];

  constructor(scene: Scene) {
    const mat = new StandardMaterial("flash", scene);
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(1, 1, 0.92);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.fogEnabled = false;
    mat.zOffset = -3;
    for (const type of PIECE_TYPES) {
      const mesh = makeMesh(pieceGeometry(type), scene, `flash-${type}`);
      mesh.material = mat;
      mesh.rotationQuaternion = Quaternion.Identity();
      mesh.setEnabled(false);
      this.templates[type] = mesh;
    }
  }

  play(spec: PieceSpec): void {
    const mesh = this.templates[spec.type].clone(`flash-${spec.type}-live`);
    composeTransform(spec).decompose(undefined, mesh.rotationQuaternion!, mesh.position);
    mesh.setEnabled(true);
    this.active.push({ mesh, t: 0 });
    this.update(0);
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i]!;
      f.t += dt;
      const k = f.t / FLASH_TIME;
      if (k >= 1) {
        f.mesh.dispose();
        this.active.splice(i, 1);
        continue;
      }
      f.mesh.visibility = 0.6 * (1 - k) * (1 - k);
      const s = 1.05 - 0.04 * k;
      f.mesh.scaling.set(s, s, s);
    }
  }
}
