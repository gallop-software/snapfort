import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildState } from "../game/buildState";
import type { Piece } from "../game/pieces";
import type { Environment } from "../game/environments";
import type { Box } from "../game/solids";
import { findImpact, planFlight, positionAt, trebuchetBase, type Flight, type Vec } from "../game/trebuchet";
import type { SiegeModel } from "../worlds/pageDoors";
import { TREBUCHET_BASE } from "./geometry";

/** Trebuchets the buffers hold at first; they double whenever a world has more. */
const FIRST_CAPACITY = 64;

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
  /** Seconds in: where it hits (it is drawn no further). */
  stop: number;
}

/**
 * Siege engines above their turntable bases (which PieceView draws with the
 * other pieces): the frame turns toward what it aims at, and the arm swings
 * over on a throw and winds back while it reloads. What they look like is the
 * world's (SiegeModel); the aiming, stones and bookkeeping here are the same
 * everywhere. All engines share two
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
  private capacity = FIRST_CAPACITY;
  private frameMatrices = new Float32Array(FIRST_CAPACITY * 16);
  private armMatrices = new Float32Array(FIRST_CAPACITY * 16);
  /** The buffers on the GPU are these arrays (false at first, and after growing). */
  private buffersReady = false;
  private readonly stones = new Map<number, Stone>();
  private readonly spareStones: Mesh[] = [];
  private readonly marker: Mesh;
  private readonly markerMaterial: StandardMaterial;
  private arc: LinesMesh | null = null;
  private readonly tmp = new Matrix();
  /** A trebuchet not drawn on this page (the one this player is aiming from). */
  hidden: string | null = null;

  /** The world's own solid things (see WorldFeature.solids): a stone hits them as it hits pieces. Set by the game. */
  solids: () => readonly Box[] = () => [];

  constructor(
    private readonly scene: Scene,
    private readonly state: BuildState,
    private readonly shadows: ShadowGenerator,
    /** The world's pull and stone flights. */
    private readonly environment: Environment,
    private readonly model: SiegeModel,
  ) {
    this.frame = this.host(model.frame, "trebuchet-frame");
    this.frameTemplate = this.template(this.frame, "trebuchet-frame-template");
    this.arm = this.host(model.arm, "trebuchet-arm");
    this.armTemplate = this.template(this.arm, "trebuchet-arm-template");

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
    arm.position.set(0, this.model.pivot, 0);
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
    const flight = planFlight(from, to, this.environment);
    mesh.position.set(...from);
    // Where it will hit, worked out here from the same flight and the same solids the world uses: it is drawn no
    // further (never on through what it hit, or into the ground), however late the world's word of the hit comes.
    const stop = findImpact(this.state, flight, id, this.environment, 0, this.solids).time;
    this.stones.set(shot, { mesh, flight, start: performance.now(), stop });
    this.model.mark?.(to, flight.time);
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
    if (!from || !to) {
      this.marker.setEnabled(false);
      this.arc?.setEnabled(false);
      return;
    }
    this.markerMaterial.emissiveColor.set(ok ? 0.2 : 0.95, ok ? 0.9 : 0.3, ok ? 0.4 : 0.25);
    this.marker.setEnabled(true);
    this.marker.position.set(to[0], to[1] + 0.05, to[2]);
    const flight = planFlight(from, to, this.environment);
    const points: Vector3[] = [];
    const colors: Color4[] = [];
    const color = ok ? new Color4(0.3, 1, 0.5, 1) : new Color4(1, 0.4, 0.3, 1);
    for (let i = 0; i <= 48; i++) {
      points.push(new Vector3(...positionAt(flight, (flight.time * i) / 48)));
      // Dashes: every other stretch faded out.
      colors.push(Math.floor(i / 2) % 2 === 0 ? color : new Color4(color.r, color.g, color.b, 0.15));
    }
    // Made once, then updated in place (it follows the crosshair every frame).
    if (this.arc) {
      CreateLines("target-arc", { points, colors, instance: this.arc });
      this.arc.setEnabled(true);
    } else {
      this.arc = CreateLines("target-arc", { points, colors, useVertexAlpha: true, updatable: true }, this.scene);
      this.arc.isPickable = false;
    }
  }

  /** Animates arms and stones. Call once a frame. */
  update(dt: number): void {
    const now = performance.now();
    for (const [shot, stone] of this.stones) {
      const t = (now - stone.start) / 1000;
      if (t > stone.flight.time * 2.6 || t >= stone.stop) {
        this.land(shot);
        continue;
      }
      stone.mesh.position.set(...positionAt(stone.flight, t));
      // Something with a nose flies nose first.
      if (this.model.pointed) stone.mesh.lookAt(new Vector3(...positionAt(stone.flight, t + 0.05)));
    }

    // Room for every trebuchet: a world can hold any number of them.
    if (this.engines.size > this.capacity) {
      while (this.engines.size > this.capacity) this.capacity *= 2;
      this.frameMatrices = new Float32Array(this.capacity * 16);
      this.armMatrices = new Float32Array(this.capacity * 16);
      this.buffersReady = false;
    }
    let i = 0;
    for (const engine of this.engines.values()) {
      if (engine.piece.id === this.hidden) continue;
      let diff = (engine.aimYaw - engine.yaw) % (Math.PI * 2);
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      engine.yaw += diff * Math.min(1, dt * 4);
      const [x, y, z] = trebuchetBase(engine.piece);
      const root = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), engine.yaw), new Vector3(x, y + TREBUCHET_BASE, z));
      root.copyToArray(this.frameMatrices, i * 16);
      Matrix.RotationX(this.armAngle((now - engine.thrownAt) / 1000)).multiplyToRef(Matrix.Translation(0, this.model.pivot, 0), this.tmp);
      this.tmp.multiplyToRef(root, this.tmp);
      this.tmp.copyToArray(this.armMatrices, i * 16);
      i++;
    }
    if (i > 0 && !this.buffersReady) {
      // Attach once there is something to draw (see RemotePlayers for why), and again after growing.
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

  /** Trebuchets that are not drawn as the build has them (development checks). Call after `update`. */
  audit(): string[] {
    const expected = this.engines.size - (this.hidden !== null && this.engines.has(this.hidden) ? 1 : 0);
    const problems: string[] = [];
    for (const mesh of [this.frame, this.arm]) {
      const drawn = mesh.isEnabled() ? mesh.thinInstanceCount : 0;
      if (drawn !== expected) problems.push(`${mesh.name}: drawing ${drawn} of ${expected}`);
    }
    return problems;
  }

  /** The arm's angle `t` seconds after a throw: a fast swing over, then winding back for the reload. */
  private armAngle(t: number): number {
    const { swing, cocked, thrown } = this.model;
    if (t < swing) {
      const k = t / swing;
      return cocked + (thrown - cocked) * k * k;
    }
    const back = Math.min(1, (t - swing) / (this.environment.siege.reload - swing - 0.3));
    const ease = back * back * (3 - 2 * back);
    return thrown + (cocked - thrown) * ease;
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
    const mesh = this.model.stone(this.environment.siege.stoneRadius);
    mesh.isPickable = false;
    this.shadows.addShadowCaster(mesh);
    return mesh;
  }
}
