import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildState } from "../game/buildState";
import type { Piece } from "../game/pieces";
import { planFlight, positionAt, TREBUCHET, trebuchetBase, type Flight, type Vec } from "../game/trebuchet";
import { TREBUCHET_BASE } from "./geometry";

/** Height of the arm's pivot above the turntable. */
const PIVOT = 3.4;
/** Arm angle (about the throwing axis) when wound back, and at the top of a throw. */
const COCKED = -2.3;
const THROWN = 0.95;
/** Seconds for the arm to swing over. */
const SWING = 0.45;
const MAX_ENGINES = 256;

interface Engine {
  piece: Piece;
  yaw: number;
  /** Where it turns toward (radians). */
  aimYaw: number;
  /** When it last threw (performance.now() ms; -Infinity: wound and ready). Clock time, not frames, so a tab that was hidden shows the right moment. */
  thrownAt: number;
}

interface Stone {
  mesh: Mesh;
  flight: Flight;
  start: number;
}

/** Paints a mesh one colour (vertex colours), so differently coloured parts can be merged. */
function paint(mesh: Mesh, r: number, g: number, b: number): Mesh {
  const colors = new Float32Array(mesh.getTotalVertices() * 4);
  for (let i = 0; i < colors.length; i += 4) colors.set([r, g, b, 1], i);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

/**
 * Trebuchets above their turntable bases (which PieceView draws with the other
 * pieces): the frame turns toward what it aims at, and the arm swings over on
 * a throw and winds back while it reloads. All trebuchets share two
 * thin-instance meshes. Also draws stones in flight, and the target marker and
 * arc preview for the trebuchet this player is on.
 */
export class TrebuchetView {
  private readonly engines = new Map<string, Engine>();
  /** Trebuchets just removed (for their rubble). */
  private readonly recent = new Map<string, Engine>();
  private readonly frame: Mesh;
  /** Plain copies of the frame and arm (no thin instances), for a trebuchet that falls as rubble. */
  private readonly frameTemplate: Mesh;
  private readonly armTemplate: Mesh;
  private readonly arm: Mesh;
  private readonly frameMatrices = new Float32Array(MAX_ENGINES * 16);
  private readonly armMatrices = new Float32Array(MAX_ENGINES * 16);
  private buffersReady = false;
  private readonly stones = new Map<number, Stone>();
  private readonly spareStones: Mesh[] = [];
  private readonly stoneMaterial: StandardMaterial;
  private readonly marker: Mesh;
  private readonly markerMaterial: StandardMaterial;
  private arc: LinesMesh | null = null;
  private readonly tmp = new Matrix();
  /** A trebuchet not drawn on this page (the one this player is aiming from). */
  hidden: string | null = null;

  constructor(
    private readonly scene: Scene,
    state: BuildState,
    private readonly shadows: ShadowGenerator,
  ) {
    const wood: [number, number, number] = [0.6, 0.4, 0.24];
    const dark: [number, number, number] = [0.36, 0.24, 0.15];
    const iron: [number, number, number] = [0.42, 0.45, 0.5];
    const part = (mesh: Mesh, color: [number, number, number], x: number, y: number, z: number, rx = 0) => {
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      return paint(mesh, ...color);
    };

    // Frame: an A-frame each side holding the axle, on two rails. Throws toward +z.
    const legLength = Math.hypot(1.6, PIVOT);
    const legTilt = Math.atan2(1.6, PIVOT);
    const frameParts: Mesh[] = [];
    for (const side of [-1, 1]) {
      const x = side * 0.95;
      frameParts.push(part(CreateBox("t-rail", { width: 0.3, height: 0.3, depth: 3.8 }, scene), dark, x, 0.15, 0));
      frameParts.push(part(CreateBox("t-leg", { width: 0.24, height: legLength, depth: 0.24 }, scene), wood, x, PIVOT / 2, 0.8, legTilt));
      frameParts.push(part(CreateBox("t-leg", { width: 0.24, height: legLength, depth: 0.24 }, scene), wood, x, PIVOT / 2, -0.8, -legTilt));
    }
    frameParts.push(part(CreateBox("t-brace", { width: 2.2, height: 0.22, depth: 0.22 }, scene), dark, 0, 0.3, 1.5));
    frameParts.push(part(CreateBox("t-brace", { width: 2.2, height: 0.22, depth: 0.22 }, scene), dark, 0, 0.3, -1.5));
    const axle = CreateCylinder("t-axle", { diameter: 0.22, height: 2.3, tessellation: 8 }, scene);
    axle.rotation.z = Math.PI / 2;
    frameParts.push(part(axle, iron, 0, PIVOT, 0));
    this.frame = this.host(Mesh.MergeMeshes(frameParts, true, true)!, "trebuchet-frame");
    this.frameTemplate = this.template(this.frame, "trebuchet-frame-template");

    // Arm, drawn upright from the pivot: the long beam and sling up, the counterweight below.
    const armParts: Mesh[] = [
      part(CreateBox("t-beam", { width: 0.22, height: 6, depth: 0.22 }, scene), wood, 0, 1.6, 0),
      part(CreateBox("t-weight", { width: 1.1, height: 1, depth: 1 }, scene), iron, 0, -1.5, 0),
      part(CreateBox("t-hanger", { width: 0.12, height: 0.6, depth: 0.12 }, scene), dark, 0, -0.9, 0),
      part(CreateBox("t-sling", { width: 0.05, height: 0.05, depth: 1.2 }, scene), dark, 0, 4.6, -0.55),
    ];
    this.arm = this.host(Mesh.MergeMeshes(armParts, true, true)!, "trebuchet-arm");
    this.armTemplate = this.template(this.arm, "trebuchet-arm-template");

    this.stoneMaterial = new StandardMaterial("stone", scene);
    this.stoneMaterial.diffuseColor = new Color3(0.38, 0.37, 0.36);
    this.stoneMaterial.specularColor = Color3.Black();

    this.markerMaterial = new StandardMaterial("target-marker", scene);
    this.markerMaterial.disableLighting = true;
    this.markerMaterial.emissiveColor = new Color3(0.2, 0.9, 0.4);
    this.markerMaterial.alpha = 0.85;
    const ring = CreateTorus("target-ring", { diameter: 3, thickness: 0.25, tessellation: 32 }, scene);
    const beam = CreateCylinder("target-beam", { diameter: 0.12, height: 12, tessellation: 6 }, scene);
    beam.position.y = 6;
    this.marker = Mesh.MergeMeshes([ring, beam], true, true)!;
    this.marker.material = this.markerMaterial;
    this.marker.isPickable = false;
    this.marker.setEnabled(false);

    for (const piece of state.all()) if (piece.type === "trebuchet") this.add(piece);
    state.subscribe((op, piece) => {
      if (piece.type !== "trebuchet") return;
      if (op.kind === "place") this.add(piece);
      else if (op.kind === "remove") {
        // Remembered a moment, so its rubble can show it as it stood.
        const engine = this.engines.get(piece.id);
        if (engine) this.recent.set(piece.id, engine);
        this.engines.delete(piece.id);
      }
    });
  }

  /**
   * The whole trebuchet as one loose mesh for rubble: `base` (its turntable,
   * from PieceView) with the frame and arm on it, as they stood. The caller owns it.
   */
  debrisMesh(piece: Piece, base: Mesh): Mesh {
    const engine = this.engines.get(piece.id) ?? this.recent.get(piece.id);
    this.recent.delete(piece.id);
    const yaw = engine?.yaw ?? 0;
    const frame = this.frameTemplate.clone(`debris-frame-${piece.id}`, base)!;
    frame.setEnabled(true);
    frame.position.set(0, TREBUCHET_BASE, 0);
    frame.rotationQuaternion = null;
    // The base mesh is already turned by the piece's yaw (0 for trebuchets): turn the frame to where it aimed.
    frame.rotation.set(0, yaw, 0);
    const arm = this.armTemplate.clone(`debris-arm-${piece.id}`, frame)!;
    arm.setEnabled(true);
    arm.position.set(0, PIVOT, 0);
    arm.rotation.set(this.armAngle(engine ? (performance.now() - engine.thrownAt) / 1000 : Infinity), 0, 0);
    return base;
  }

  /** Turns trebuchet `id` toward a point. */
  aimAt(id: string, point: Vec): void {
    const engine = this.engines.get(id);
    if (!engine) return;
    const [x, , z] = trebuchetBase(engine.piece);
    engine.aimYaw = Math.atan2(point[0] - x, point[2] - z);
  }

  /** A stone thrown: swing the arm and fly the stone. */
  throwStone(shot: number, id: string, from: Vec, to: Vec): void {
    this.aimAt(id, to);
    const engine = this.engines.get(id);
    if (engine) {
      engine.thrownAt = performance.now();
      // Snap to face the shot: the stone leaves now.
      engine.yaw = engine.aimYaw;
    }
    const mesh = this.spareStones.pop() ?? this.makeStone();
    mesh.setEnabled(true);
    const flight = planFlight(from, to);
    mesh.position.set(...from);
    this.stones.set(shot, { mesh, flight, start: performance.now() });
  }

  /** Stone `shot` landed: take it away. Returns where it was, if it was in flight. */
  land(shot: number): void {
    const stone = this.stones.get(shot);
    if (!stone) return;
    this.stones.delete(shot);
    stone.mesh.setEnabled(false);
    this.spareStones.push(stone.mesh);
  }

  /**
   * Shows where the trebuchet this player is on will throw: a ring at the
   * target and the stone's arc, green when in range, red when not. null hides it.
   */
  showTarget(from: Vec | null, to: Vec | null, ok: boolean): void {
    this.arc?.dispose();
    this.arc = null;
    if (!from || !to) {
      this.marker.setEnabled(false);
      return;
    }
    this.markerMaterial.emissiveColor = ok ? new Color3(0.2, 0.9, 0.4) : new Color3(0.95, 0.3, 0.25);
    this.marker.setEnabled(true);
    this.marker.position.set(to[0], to[1] + 0.05, to[2]);
    const flight = planFlight(from, to);
    const points: Vector3[] = [];
    const colors: Color4[] = [];
    const color = ok ? new Color4(0.3, 1, 0.5, 1) : new Color4(1, 0.4, 0.3, 1);
    for (let i = 0; i <= 48; i++) {
      points.push(new Vector3(...positionAt(flight, (flight.time * i) / 48)));
      // Dashes: every other stretch faded out.
      colors.push(Math.floor(i / 2) % 2 === 0 ? color : new Color4(color.r, color.g, color.b, 0.15));
    }
    this.arc = CreateLines("target-arc", { points, colors, useVertexAlpha: true }, this.scene);
    this.arc.isPickable = false;
  }

  /** Animates arms and stones. Call once a frame. */
  update(dt: number): void {
    const now = performance.now();
    for (const [shot, stone] of this.stones) {
      const t = (now - stone.start) / 1000;
      if (t > stone.flight.time * 2.6) {
        this.land(shot);
        continue;
      }
      stone.mesh.position.set(...positionAt(stone.flight, t));
    }

    let i = 0;
    for (const engine of this.engines.values()) {
      if (i >= MAX_ENGINES) break;
      if (engine.piece.id === this.hidden) continue;
      let diff = (engine.aimYaw - engine.yaw) % (Math.PI * 2);
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      engine.yaw += diff * Math.min(1, dt * 4);
      const [x, y, z] = trebuchetBase(engine.piece);
      const root = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), engine.yaw), new Vector3(x, y + TREBUCHET_BASE, z));
      root.copyToArray(this.frameMatrices, i * 16);
      Matrix.RotationX(this.armAngle((now - engine.thrownAt) / 1000)).multiplyToRef(Matrix.Translation(0, PIVOT, 0), this.tmp);
      this.tmp.multiplyToRef(root, this.tmp);
      this.tmp.copyToArray(this.armMatrices, i * 16);
      i++;
    }
    if (i > 0 && !this.buffersReady) {
      // Attach once there is something to draw (see RemotePlayers for why).
      this.buffersReady = true;
      this.frame.thinInstanceSetBuffer("matrix", this.frameMatrices, 16, false);
      this.arm.thinInstanceSetBuffer("matrix", this.armMatrices, 16, false);
    }
    if (!this.buffersReady) return;
    // Count first: Babylon uploads only the first `thinInstanceCount` entries.
    for (const mesh of [this.frame, this.arm]) {
      mesh.thinInstanceCount = i;
      if (i > 0) mesh.thinInstanceBufferUpdated("matrix");
      mesh.setEnabled(i > 0);
    }
  }

  /** The arm's angle `t` seconds after a throw: a fast swing over, then winding back for the reload. */
  private armAngle(t: number): number {
    if (t < SWING) {
      const k = t / SWING;
      return COCKED + (THROWN - COCKED) * k * k;
    }
    const back = Math.min(1, (t - SWING) / (TREBUCHET.reload - SWING - 0.3));
    const ease = back * back * (3 - 2 * back);
    return THROWN + (COCKED - THROWN) * ease;
  }

  private add(piece: Piece): void {
    this.engines.set(piece.id, { piece, yaw: 0, aimYaw: 0, thrownAt: -Infinity });
  }

  /** A plain, hidden copy of a host mesh's shape and look (taken before it gets thin instances). */
  private template(host: Mesh, name: string): Mesh {
    const copy = host.clone(name)!;
    copy.setEnabled(false);
    copy.isPickable = false;
    copy.alwaysSelectAsActiveMesh = false;
    return copy;
  }

  private host(mesh: Mesh, name: string): Mesh {
    mesh.name = name;
    const material = new StandardMaterial(name, this.scene);
    material.specularColor = Color3.Black();
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.receiveShadows = true;
    this.shadows.addShadowCaster(mesh);
    mesh.setEnabled(false);
    return mesh;
  }

  private makeStone(): Mesh {
    const mesh = CreateSphere("stone", { diameter: TREBUCHET.stoneRadius * 2.4, segments: 8 }, this.scene);
    mesh.material = this.stoneMaterial;
    mesh.isPickable = false;
    this.shadows.addShadowCaster(mesh);
    return mesh;
  }
}
