import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import { CELL } from "../../../game/constants";
import type { PageGame } from "../../pageDoors";
import { BUILDING_KINDS, BUILDINGS, FLIGHT_HEIGHT, UNIT_KINDS, UNITS, type BuildingKind, type UnitKind } from "../kit";
import { F_DOWN, F_FIRING, F_HIT, F_LOADED, F_MOVING, F_STUNNED, UNIT_FIELDS, type WireBuilding, type WireField } from "../wire";
import { Many, place, rgbOf, turn } from "./many";
import { buildingModel, crystalModel, headModel, MUZZLES, unitModel, ventModel } from "./models";
import { flailFrame, POSE_AIM, POSE_DOWN, POSE_FLINCH, POSE_STAND, runFrame, TROOPER_MIDDLE, Troopers } from "./troopers";

/**
 * Draws Mojave's war: every unit and building the server has told this page
 * of, the crystal fields and vents, and the shots, blasts and sparks between
 * them. Each kind of unit is two meshes drawn as many times as there are units
 * (thin instances): its body, and its trim in its general's colour. Troopers
 * are people, not machines: they are drawn by troopers.ts, in poses.
 *
 * The land always shows; an enemy shows only while this general sees it. So
 * units come into view and go out of it in the open: they grow in and shrink
 * away over a moment, never popping.
 *
 * Nothing is decided here. Units are drawn a fifth of a second behind what
 * the server last said, blended between its updates, and everything timed
 * runs on the clock, so a tab that comes back shows the present at once.
 */

export interface SeenUnit {
  id: number;
  kind: UnitKind;
  owner: number;
  /** Where it was drawn when the last word of it came, where that word puts it, and when it came (ms). */
  fx: number;
  fy: number;
  fz: number;
  fh: number;
  tx: number;
  ty: number;
  tz: number;
  th: number;
  at: number;
  /** Where it is drawn now. */
  x: number;
  y: number;
  z: number;
  h: number;
  hp: number;
  flags: number;
  extra: number;
  /** Thrown: tumbling from one spot to another. */
  tumble: { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; start: number; ms: number; spin: number; axis: number } | null;
  /** When it was last hit (for its flash), and whether a blast did it (a Trooper flinches at a bullet, flies from a blast). */
  hitAt: number;
  /** Whether the last word of it put it somewhere new: it is really on the move (a unit told to go somewhere may be standing to fire on the way). */
  going: boolean;
  /** When it came into view (ms): it grows in from then. */
  seenAt: number;
  /** When it went out of view (ms), or 0: it shrinks away from then, and is forgotten. */
  goneAt: number;
}

export interface SeenBuilding extends WireBuilding {
  kind: BuildingKind;
  /** When this word of it came (ms): what it says in seconds counts down from then. */
  at: number;
  /** Not in sight now: drawn as it was last seen. */
  stale: boolean;
  /** Since when it has been out of sight (ms), or 0 while in sight: how old the report of it is. */
  staleAt: number;
  /** A turret: which way its head is turned now, and which way it is turning to (what it last fired on), radians about the vertical. */
  yaw: number;
  aim: number;
  /** Which of its two muzzles fires next (they take turns). */
  side: number;
  body: PhysicsBody | null;
  node: TransformNode | null;
}

export interface SeenField {
  id: number;
  vent: boolean;
  cx: number;
  cz: number;
  amount: number;
  full: number;
}

/** How long a unit takes to reach where the server last put it, ms (a little more than the time between its words). */
const BLEND_MS = 230;
/** How long a unit takes to come into view or go out of it, ms. */
const APPEAR_MS = 450;

interface Tracer { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; until: number; color: [number, number, number]; wide: number }
interface Shell { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; start: number; ms: number; arc: number }
interface Flash { x: number; y: number; z: number; start: number; ms: number; size: number; color: [number, number, number]; ring: boolean }
interface Spark { x: number; y: number; z: number; vx: number; vy: number; vz: number; start: number; ms: number; color: [number, number, number] }

export class ArmyView {
  readonly units = new Map<number, SeenUnit>();
  readonly buildings = new Map<number, SeenBuilding>();
  readonly fields = new Map<number, SeenField>();
  /** A general's colour, by slot (set by whoever knows the generals). */
  colorOf: (owner: number) => string = () => "#9aa0a8";
  /** Which units are selected (rings are drawn under them), and which buildings. */
  selected: ReadonlySet<number> = new Set();
  selectedBuildings: ReadonlySet<number> = new Set();
  /** Whether a spot is in this general's sight now (buildings out of it are drawn dim: as they were last seen). */
  inSight: (x: number, z: number) => boolean = () => true;
  /** A unit has gone out of view (not destroyed: only no longer seen): for whoever keeps reports of what was last seen. */
  onUnseen: (unit: SeenUnit) => void = () => {};

  private readonly scene: Scene;
  private readonly unitBody = new Map<UnitKind, Many>();
  private readonly unitTrim = new Map<UnitKind, Many>();
  private readonly buildingBody = new Map<BuildingKind, Many>();
  private readonly buildingTrim = new Map<BuildingKind, Many>();
  /** The turning heads of turrets (see models.ts): body and trim, as the buildings themselves. */
  private readonly headBody = new Map<BuildingKind, Many>();
  private readonly headTrim = new Map<BuildingKind, Many>();
  private lastDraw = 0;
  private readonly crystals: Many;
  private readonly vents: Many;
  /** What a Hauler carries, in its bed: a little heap of the crystals it mined. */
  private readonly loads: Many;
  private readonly rings: Many;
  private readonly tracerMesh: Many;
  private readonly ballMesh: Many;
  private readonly flashMesh: Many;
  private readonly pulseMesh: Many;
  private readonly sparkMesh: Many;
  private readonly tracers: Tracer[] = [];
  private readonly shells: Shell[] = [];
  private readonly flashes: Flash[] = [];
  private readonly sparks: Spark[] = [];
  private readonly solid: PhysicsShapeBox[] = [];
  private readonly troopers: Troopers;
  /** Units that have gone out of view, shrinking away. */
  private readonly leaving: SeenUnit[] = [];
  /** A building shown where it would go, before it is placed: asked for each frame it is wanted. */
  private readonly ghosts = new Map<BuildingKind, Mesh>();
  private ghostWanted: { kind: BuildingKind; x: number; z: number; ok: boolean } | null = null;
  private readonly ghostOk: StandardMaterial;
  private readonly ghostBad: StandardMaterial;

  constructor(game: PageGame) {
    const scene = (this.scene = game.scene);
    const matt = new StandardMaterial("mojave-army", scene);
    matt.specularColor = new Color3(0.12, 0.12, 0.12);
    const glow = new StandardMaterial("mojave-glow", scene);
    glow.disableLighting = true;
    glow.emissiveColor = Color3.White();
    const prepare = (mesh: Mesh, tinted: boolean, material: StandardMaterial, shadow: boolean) => {
      // Trim takes its colour from each instance, so it carries none of its own.
      if (tinted && mesh.isVerticesDataPresent(VertexBuffer.ColorKind)) mesh.removeVerticesData(VertexBuffer.ColorKind);
      mesh.material = material;
      mesh.receiveShadows = !tinted;
      if (shadow) game.shadows.addShadowCaster(mesh);
      return new Many(mesh, tinted);
    };
    this.troopers = new Troopers(scene, game.shadows);
    const seeThrough = (name: string, r: number, g: number, b: number) => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true;
      m.emissiveColor = new Color3(r, g, b);
      m.alpha = 0.4;
      return m;
    };
    this.ghostOk = seeThrough("mojave-ghost-ok", 0.35, 1, 0.5);
    this.ghostBad = seeThrough("mojave-ghost-bad", 1, 0.3, 0.25);
    for (const kind of UNIT_KINDS) {
      // (Troopers are drawn as people, in poses: see troopers.ts.)
      if (kind === "trooper") continue;
      const model = unitModel(kind, scene);
      this.unitBody.set(kind, prepare(model.body, false, matt, true));
      this.unitTrim.set(kind, prepare(model.trim, true, matt, false));
    }
    for (const kind of BUILDING_KINDS) {
      const model = buildingModel(kind, scene);
      this.buildingBody.set(kind, prepare(model.body, false, matt, true));
      this.buildingTrim.set(kind, prepare(model.trim, true, matt, false));
      const head = headModel(kind, scene);
      if (head) {
        this.headBody.set(kind, prepare(head.body, false, matt, true));
        this.headTrim.set(kind, prepare(head.trim, true, matt, false));
      }
    }
    const crystalMat = new StandardMaterial("mojave-crystal", scene);
    crystalMat.emissiveColor = new Color3(0.18, 0.32, 0.34);
    crystalMat.specularColor = new Color3(0.5, 0.5, 0.5);
    this.crystals = prepare(crystalModel(scene), false, crystalMat, false);
    this.vents = prepare(ventModel(scene), false, matt, false);
    const load = crystalModel(scene);
    load.name = "mojave-load";
    this.loads = prepare(load, false, crystalMat, false);

    const ring = CreateTorus("mojave-ring", { diameter: 2, thickness: 0.12, tessellation: 20 }, scene);
    this.rings = prepare(ring, true, glow, false);
    this.tracerMesh = prepare(CreateBox("mojave-tracer", { width: 1, height: 1, depth: 1 }, scene), true, glow, false);
    this.ballMesh = prepare(CreateSphere("mojave-shell", { diameter: 1, segments: 6 }, scene), true, glow, false);
    this.flashMesh = prepare(CreateSphere("mojave-flash", { diameter: 1, segments: 8 }, scene), true, glow, false);
    this.pulseMesh = prepare(CreateTorus("mojave-pulse", { diameter: 2, thickness: 0.2, tessellation: 28 }, scene), true, glow, false);
    this.sparkMesh = prepare(CreateBox("mojave-spark", { size: 1 }, scene), true, glow, false);
  }

  /**
   * The server is about to send everything afresh (the connection was lost
   * and found again, say). What is drawn stays drawn meanwhile, so nothing
   * blinks; whatever has not been heard of again a moment later is gone.
   */
  refresh(now: number): void {
    this.refreshFrom = now;
  }
  private refreshFrom = 0;

  /** Lets go of what was not heard of again after `refresh`. */
  private settle(now: number): void {
    if (this.refreshFrom === 0 || now - this.refreshFrom < 1800) return;
    for (const u of [...this.units.values()]) if (u.at < this.refreshFrom) this.units.delete(u.id);
    for (const b of [...this.buildings.values()]) {
      if (b.at >= this.refreshFrom) continue;
      this.unsolid(b);
      this.buildings.delete(b.i);
    }
    this.refreshFrom = 0;
  }

  /** Forgets everything at once (another army is served now: none of this is theirs to see). */
  clear(): void {
    this.units.clear();
    this.leaving.length = 0;
    for (const b of this.buildings.values()) this.unsolid(b);
    this.buildings.clear();
    this.tracers.length = this.shells.length = this.flashes.length = this.sparks.length = 0;
  }

  setFields(list: readonly WireField[]): void {
    this.fields.clear();
    for (const [id, kind, cx, cz, amount, full] of list) this.fields.set(id, { id, vent: kind === 1, cx, cz, amount, full });
  }

  /** Units seen or changed (see UNIT_FIELDS). */
  seeUnits(u: readonly number[], now: number): void {
    for (let i = 0; i + UNIT_FIELDS <= u.length; i += UNIT_FIELDS) {
      const id = u[i]!, kind = UNIT_KINDS[u[i + 1]! >> 4], owner = u[i + 1]! & 15;
      if (!kind) continue;
      const x = u[i + 2]! / 10, y = u[i + 3]! / 10, z = u[i + 4]! / 10, h = (u[i + 5]! / 255) * Math.PI * 2;
      let unit = this.units.get(id);
      if (!unit) {
        unit = { id, kind, owner, fx: x, fy: y, fz: z, fh: h, tx: x, ty: y, tz: z, th: h, at: now, x, y, z, h, hp: 100, flags: 0, extra: 0, tumble: null, hitAt: -1e9, going: false, seenAt: now, goneAt: 0 };
        this.units.set(id, unit);
      } else {
        unit.going = Math.hypot(x - unit.tx, z - unit.tz) > 0.12;
        unit.fx = unit.x;
        unit.fy = unit.y;
        unit.fz = unit.z;
        unit.fh = unit.h;
        unit.tx = x;
        unit.ty = y;
        unit.tz = z;
        unit.th = h;
        unit.at = now;
      }
      unit.owner = owner;
      if (u[i + 6]! < unit.hp || u[i + 7]! & F_HIT) unit.hitAt = now;
      unit.hp = u[i + 6]!;
      unit.flags = u[i + 7]!;
      unit.extra = u[i + 8]!;
    }
  }

  /** Units no longer seen: id, why (1: destroyed, in a burst of sparks). */
  loseUnits(x: readonly number[], now: number): void {
    for (let i = 0; i + 1 < x.length; i += 2) {
      const unit = this.units.get(x[i]!);
      if (!unit) continue;
      this.units.delete(unit.id);
      if (x[i + 1] === 0) {
        // Out of view, not destroyed: it shrinks away, and whoever keeps reports is told where it was.
        unit.goneAt = now;
        this.leaving.push(unit);
        this.onUnseen(unit);
      }
      if (x[i + 1] === 1) this.burst(unit.x, unit.y + UNITS[unit.kind].height * 0.5, unit.z, UNITS[unit.kind].radius, rgbOf(this.colorOf(unit.owner)), now);
    }
  }

  seeBuildings(list: readonly WireBuilding[], now: number): void {
    for (const b of list) {
      const kind = BUILDING_KINDS[b.k];
      if (!kind) continue;
      const old = this.buildings.get(b.i);
      // (A turret new to this page faces the middle of the map, where trouble comes from.)
      const out = Math.atan2(-b.x, -b.z);
      const seen: SeenBuilding = { ...b, kind, at: now, stale: false, staleAt: 0, yaw: old?.yaw ?? out, aim: old?.aim ?? out, side: old?.side ?? 1, body: old?.body ?? null, node: old?.node ?? null };
      this.buildings.set(b.i, seen);
      if (!seen.body) this.makeSolid(seen);
    }
  }

  loseBuildings(bx: readonly number[], now: number): void {
    for (let i = 0; i + 1 < bx.length; i += 2) {
      const b = this.buildings.get(bx[i]!);
      if (!b) continue;
      this.unsolid(b);
      this.buildings.delete(b.i);
      if (bx[i + 1] !== 1) continue;
      const size = BUILDINGS[b.kind].size * CELL;
      const c = rgbOf(this.colorOf(b.o));
      for (let n = 0; n < 4; n++) this.burst((b.x + Math.random() * BUILDINGS[b.kind].size) * CELL, 1 + Math.random() * BUILDINGS[b.kind].height * 0.6, (b.z + Math.random() * BUILDINGS[b.kind].size) * CELL, size * 0.3, c, now + n * 90);
      this.flashes.push({ x: b.x * CELL + size / 2, y: 2, z: b.z * CELL + size / 2, start: now, ms: 500, size: size * 1.3, color: [1, 0.75, 0.4], ring: false });
    }
  }

  /** A building is solid: builders bump into it, and the crosshair lands on it. */
  private makeSolid(b: SeenBuilding): void {
    const def = BUILDINGS[b.kind];
    const size = def.size * CELL;
    const node = new TransformNode(`mojave-solid-${b.i}`, this.scene);
    node.position.set(b.x * CELL + size / 2, def.height * 0.4, b.z * CELL + size / 2);
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    const shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(size * 0.86, def.height * 0.8, size * 0.86), this.scene);
    body.shape = shape;
    this.solid.push(shape);
    b.body = body;
    b.node = node;
  }

  private unsolid(b: SeenBuilding): void {
    b.body?.shape?.dispose();
    b.body?.dispose();
    b.node?.dispose();
    b.body = b.node = null;
  }

  // ── Things that happen ─────────────────────────────────────────────────

  /** Shots (see ToPage "tick"): ten numbers each. */
  shots(s: readonly number[], now: number): void {
    for (let i = 0; i + 10 <= s.length; i += 10) {
      let fx = s[i]! / 10, fy = s[i + 1]! / 10, fz = s[i + 2]! / 10;
      const tx = s[i + 3]! / 10, ty = s[i + 4]! / 10, tz = s[i + 5]! / 10;
      const look = s[i + 6]!, time = s[i + 7]! / 10, owner = s[i + 8]!, hit = s[i + 9]!;
      // A turret's shot: its head turns to face what it fired on, and the shot is drawn from a muzzle (they take turns), not from its middle.
      const turret = this.turretAt(fx, fz, owner);
      if (turret) {
        const muzzle = MUZZLES[turret.kind]!;
        const size = BUILDINGS[turret.kind].size * CELL;
        const cx = turret.x * CELL + size / 2, cz = turret.z * CELL + size / 2;
        turret.aim = Math.atan2(tx - cx, tz - cz);
        turret.side = -turret.side;
        const sin = Math.sin(turret.aim), cos = Math.cos(turret.aim);
        const right = muzzle[0] * turret.side;
        fx = cx + right * cos + muzzle[2] * sin;
        fy = muzzle[1];
        fz = cz - right * sin + muzzle[2] * cos;
      }
      const c = rgbOf(this.colorOf(owner));
      // Bright, in the general's colour.
      const bright: [number, number, number] = [0.45 + c[0] * 0.55, 0.45 + c[1] * 0.55, 0.45 + c[2] * 0.55];
      if (time > 0) this.shells.push({ fx, fy, fz, tx, ty, tz, start: now, ms: time * 1000, arc: Math.min(40, Math.hypot(tx - fx, tz - fz) * 0.28) });
      else if (look === 1 || look === 2) this.shells.push({ fx, fy, fz, tx, ty, tz, start: now, ms: Math.min(260, Math.hypot(tx - fx, tz - fz) * 4), arc: 0 });
      else this.tracers.push({ fx, fy, fz, tx, ty, tz, until: now + 90, color: bright, wide: look === 3 ? 0.22 : 0.09 });
      this.flashes.push({ x: fx, y: fy, z: fz, start: now, ms: 80, size: look === 0 ? 0.5 : 1.3, color: [1, 0.9, 0.6], ring: false });
      const target = hit > 0 ? this.units.get(hit) : undefined;
      if (target) target.hitAt = now;
    }
  }

  /** The turret of this owner's standing where a shot came from, if a turret fired it. */
  private turretAt(x: number, z: number, owner: number): SeenBuilding | null {
    for (const b of this.buildings.values()) {
      if (b.o !== owner || !MUZZLES[b.kind]) continue;
      const half = (BUILDINGS[b.kind].size * CELL) / 2;
      if (Math.abs(x - (b.x * CELL + half)) < half + 0.5 && Math.abs(z - (b.z * CELL + half)) < half + 0.5) return b;
    }
    return null;
  }

  /** Units thrown: eight numbers each. */
  tumbles(k: readonly number[], now: number): void {
    for (let i = 0; i + 8 <= k.length; i += 8) {
      const unit = this.units.get(k[i]!);
      if (!unit) continue;
      unit.tumble = {
        fx: unit.x, fy: unit.y, fz: unit.z, tx: k[i + 4]! / 10, ty: k[i + 5]! / 10, tz: k[i + 6]! / 10, start: now, ms: k[i + 7]! * 100,
        // Each one turns over its own way.
        spin: (2 + (unit.id % 3)) * Math.PI * ((unit.id & 1) === 0 ? 1 : -1), axis: (unit.id % 5) / 5,
      };
    }
  }

  blasts(bl: readonly number[], now: number): void {
    for (let i = 0; i + 4 <= bl.length; i += 4) {
      const x = bl[i]! / 10, y = bl[i + 1]! / 10, z = bl[i + 2]! / 10, r = bl[i + 3]! / 10;
      this.flashes.push({ x, y: Math.max(0.6, y), z, start: now, ms: 320, size: r * 2.2, color: [1, 0.62, 0.25], ring: false });
      this.flashes.push({ x, y: 0.15, z, start: now, ms: 420, size: r * 1.5, color: [1, 0.85, 0.6], ring: true });
      for (let n = 0; n < 6; n++) {
        const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 7;
        this.sparks.push({ x, y: y + 0.4, z, vx: Math.sin(a) * v, vy: 5 + Math.random() * 7, vz: Math.cos(a) * v, start: now, ms: 500 + Math.random() * 300, color: [1, 0.7, 0.35] });
      }
    }
  }

  pulses(p: readonly number[], now: number, radius: number): void {
    for (let i = 0; i + 2 <= p.length; i += 2) this.flashes.push({ x: p[i]!, y: 1, z: p[i + 1]!, start: now, ms: 700, size: radius, color: [0.5, 0.9, 1], ring: true });
  }

  zaps(z: readonly number[], now: number): void {
    for (let i = 0; i + 6 <= z.length; i += 6) {
      const tx = z[i + 3]! / 10, ty = z[i + 4]! / 10, tz = z[i + 5]! / 10;
      this.tracers.push({ fx: z[i]! / 10, fy: z[i + 1]! / 10, fz: z[i + 2]! / 10, tx, ty, tz, until: now + 160, color: [0.6, 0.95, 1], wide: 0.3 });
      this.flashes.push({ x: tx, y: ty, z: tz, start: now, ms: 260, size: 5, color: [0.7, 0.95, 1], ring: false });
    }
  }

  /** Something destroyed: a burst of sparks, and it is gone. No wreck, nothing left lying. */
  private burst(x: number, y: number, z: number, size: number, color: [number, number, number], now: number): void {
    this.flashes.push({ x, y, z, start: now, ms: 260, size: size * 2.6, color: [1, 0.9, 0.7], ring: false });
    const n = Math.min(14, 6 + Math.round(size * 3));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 6;
      this.sparks.push({ x, y, z, vx: Math.sin(a) * v, vy: 3 + Math.random() * 8, vz: Math.cos(a) * v, start: now, ms: 450 + Math.random() * 400, color: i % 3 === 0 ? color : [1, 0.85, 0.5] });
    }
    if (this.sparks.length > 900) this.sparks.splice(0, this.sparks.length - 900);
  }

  // ── Every frame ────────────────────────────────────────────────────────

  update(now: number): void {
    this.settle(now);
    const time = now / 1000;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastDraw) / 1000));
    this.lastDraw = now;
    for (const m of [...this.headBody.values(), ...this.headTrim.values(), ...this.unitBody.values(), ...this.unitTrim.values(), ...this.buildingBody.values(), ...this.buildingTrim.values(), this.crystals, this.vents, this.loads, this.rings, this.tracerMesh, this.ballMesh, this.flashMesh, this.pulseMesh, this.sparkMesh]) m.begin();

    this.troopers.begin();
    for (const u of this.units.values()) this.drawUnit(u, now, time, Math.min(1, 0.15 + (0.85 * (now - u.seenAt)) / APPEAR_MS));
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const u = this.leaving[i]!;
      const k = 1 - (now - u.goneAt) / APPEAR_MS;
      if (k <= 0) this.leaving.splice(i, 1);
      else this.drawUnit(u, now, time, k);
    }
    this.troopers.end();

    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.kind];
      const size = def.size * CELL;
      const x = b.x * CELL + size / 2, z = b.z * CELL + size / 2;
      b.stale = !this.inSight(x, z);
      b.staleAt = b.stale ? b.staleAt || now : 0;
      // Printing: it rises out of the ground as it is made.
      const left = b.d > 0 ? Math.max(0, b.d - (now - b.at) / 1000) : 0;
      const grown = b.d > 0 ? 0.12 + 0.88 * (1 - left / def.time) : 1;
      const body = this.buildingBody.get(b.kind)!, trim = this.buildingTrim.get(b.kind)!;
      const i = body.add();
      place(body.matrices, i, x, 0, z, 0, 0, 0, 1, grown, 1);
      const j = trim.add();
      trim.matrices.set(body.matrices.subarray(i * 16, i * 16 + 16), j * 16);
      const c = rgbOf(this.colorOf(b.o));
      const dim = b.stale ? 0.45 : b.st > 0 ? 0.5 : 1;
      trim.colors!.set([c[0] * dim, c[1] * dim, c[2] * dim, 1], j * 4);
      // A turret's head, turning quickly (a tenth of a second or so) to face what it last fired on.
      const head = this.headBody.get(b.kind);
      if (head) {
        b.yaw = turn(b.yaw, b.aim, Math.min(1, dt * 18));
        const h = head.add(), headTrim = this.headTrim.get(b.kind)!;
        place(head.matrices, h, x, 0, z, b.yaw, 0, 0, 1, grown, 1);
        const t = headTrim.add();
        headTrim.matrices.set(head.matrices.subarray(h * 16, h * 16 + 16), t * 16);
        headTrim.colors!.set([c[0] * dim, c[1] * dim, c[2] * dim, 1], t * 4);
      }
      if (this.selectedBuildings.has(b.i)) this.ring(x, 0.15, z, size * 0.72, b.h);
    }

    for (const f of this.fields.values()) {
      const many = f.vent ? this.vents : this.crystals;
      const i = many.add();
      // Crystals shrink as they are dug out.
      const s = f.vent ? 1 : 0.35 + 0.65 * Math.min(1, f.amount / f.full);
      place(many.matrices, i, (f.cx + 0.5) * CELL, f.amount <= 0 && !f.vent ? -2.2 : 0, (f.cz + 0.5) * CELL, f.id * 1.7, 0, 0, 1, s, 1);
    }

    this.effects(now);
    this.drawGhost();
    for (const m of [...this.headBody.values(), ...this.headTrim.values(), ...this.unitBody.values(), ...this.unitTrim.values(), ...this.buildingBody.values(), ...this.buildingTrim.values(), this.crystals, this.vents, this.loads, this.rings, this.tracerMesh, this.ballMesh, this.flashMesh, this.pulseMesh, this.sparkMesh]) m.end();
  }

  /** One unit, where it is now: blended toward what the server last said, or thrown through the air. `grown` is how much of it shows (coming into view, or going out). */
  private drawUnit(u: SeenUnit, now: number, time: number, grown: number): void {
    const def = UNITS[u.kind];
    const person = u.kind === "trooper";
    let pitch = 0, roll = 0, lift = 0;
    /** A Trooper's pose (see troopers.ts). */
    let pose = POSE_STAND;
    let flying = false;
    if (u.tumble && now - u.tumble.start < u.tumble.ms + 500) {
      // Thrown: over and over through the air to where it lands, then a moment down before it rights itself.
      const t = u.tumble, p = Math.min(1, (now - t.start) / t.ms);
      u.x = t.fx + (t.tx - t.fx) * p;
      u.z = t.fz + (t.tz - t.fz) * p;
      const far = Math.hypot(t.tx - t.fx, t.tz - t.fz);
      // (A person is flung higher than a machine rolls.)
      const hop = person ? far * 0.45 + 2 : far * 0.35 + 1.2;
      u.y = t.fy + (t.ty - t.fy) * p + Math.sin(Math.PI * p) * hop;
      if (person) {
        if (p < 1) {
          flying = true;
          pose = flailFrame((now - t.start) / 1000, u.id);
          pitch = t.spin * p * 1.4 * (1 - t.axis * 0.5);
          roll = t.spin * p * t.axis;
        } else pose = POSE_DOWN;
      } else {
        const settle = p < 1 ? 1 : Math.max(0, 1 - (now - t.start - t.ms) / 500);
        const angle = (p < 1 ? t.spin * p : t.spin) * settle;
        pitch = angle * (1 - t.axis);
        roll = angle * t.axis;
        lift = def.radius * 0.5 * Math.min(1, Math.abs(Math.sin(angle)) + (p < 1 ? 0.3 : 0)) * settle;
      }
    } else if (u.goneAt === 0) {
      u.tumble = null;
      const k = Math.min(1, (now - u.at) / BLEND_MS);
      u.x = u.fx + (u.tx - u.fx) * k;
      u.y = u.fy + (u.ty - u.fy) * k;
      u.z = u.fz + (u.tz - u.fz) * k;
      u.h = turn(u.fh, u.th, k);
      if (u.flags & F_DOWN) {
        if (person) pose = POSE_DOWN;
        else roll = 1.2;
      }
    }
    // On the move: told to be, and really covering ground (word of a moving unit comes five times a second).
    const moving = (u.flags & F_MOVING) !== 0 && u.going && now - u.at < 450;
    const c = rgbOf(this.colorOf(u.owner));
    // A flash of white when hit; cold and dim when stopped by an EMP.
    const flash = Math.max(0, 1 - (now - u.hitAt) / 160);
    const stun = u.flags & F_STUNNED ? 0.45 : 1;
    const r = (c[0] + (1 - c[0]) * flash) * stun, g = (c[1] + (1 - c[1]) * flash) * stun, b = (c[2] + (1 - c[2]) * flash) * stun + (stun < 1 ? 0.25 : 0);
    if (person) {
      let x = u.x, z = u.z, y = u.y;
      if (flying) y += TROOPER_MIDDLE;
      else if (pose === POSE_DOWN) y += 0.24;
      else if (now - u.hitAt < 220) {
        // A bullet: knocked back a step, on their heels, and on with it.
        pose = POSE_FLINCH;
        const back = 0.3 * Math.sin((Math.PI * (now - u.hitAt)) / 220);
        x -= Math.sin(u.h) * back;
        z -= Math.cos(u.h) * back;
      } else if (moving) pose = runFrame(time, u.id);
      else if (u.flags & F_FIRING) pose = POSE_AIM;
      this.troopers.add(pose, x, y, z, u.h, pitch, roll, r, g, b, grown);
    } else {
      // Drones hover; a Titan sways as it walks.
      let bob = 0;
      if (def.air) bob = Math.sin(time * 2.2 + u.id) * 0.25;
      else if (moving && u.kind === "titan") roll += Math.sin(time * 3 + u.id) * 0.05;
      const body = this.unitBody.get(u.kind)!, trim = this.unitTrim.get(u.kind)!;
      const i = body.add();
      place(body.matrices, i, u.x, u.y + bob + lift, u.z, u.h, pitch, roll, grown, grown, grown);
      const j = trim.add();
      trim.matrices.set(body.matrices.subarray(i * 16, i * 16 + 16), j * 16);
      trim.colors!.set([r, g, b, 1], j * 4);
      // A Hauler on its way back shows what it mined: crystals heaped in its bed.
      if (u.kind === "hauler" && u.flags & F_LOADED && pitch === 0 && roll === 0) {
        const k = this.loads.add();
        const back = -0.55, size = 0.34 * grown;
        place(this.loads.matrices, k, u.x + Math.sin(u.h) * back, u.y + 0.84, u.z + Math.cos(u.h) * back, u.h + u.id, 0, 0, size, size, size);
      }
    }
    if (u.goneAt === 0 && this.selected.has(u.id)) this.ring(u.x, def.air ? Math.max(0.12, u.y - FLIGHT_HEIGHT + 0.12) : u.y + 0.12, u.z, def.radius + 0.5, u.hp);
  }

  /**
   * Shows a building where it would go, before it is placed: its own shape,
   * see-through, green where it may go and red where it may not. Asked for
   * each frame it is wanted; gone the frame it is not.
   */
  ghost(kind: BuildingKind, x: number, z: number, ok: boolean): void {
    this.ghostWanted = { kind, x, z, ok };
  }

  private drawGhost(): void {
    const want = this.ghostWanted;
    this.ghostWanted = null;
    for (const [kind, mesh] of this.ghosts) if (kind !== want?.kind) mesh.setEnabled(false);
    if (!want) return;
    let mesh = this.ghosts.get(want.kind);
    if (!mesh) {
      const model = buildingModel(want.kind, this.scene), head = headModel(want.kind, this.scene);
      const all = [model.body, model.trim, ...(head ? [head.body, head.trim] : [])];
      for (const part of all) if (part.isVerticesDataPresent(VertexBuffer.ColorKind)) part.removeVerticesData(VertexBuffer.ColorKind);
      mesh = Mesh.MergeMeshes(all, true, true)!;
      mesh.name = `mojave-ghost-${want.kind}`;
      mesh.isPickable = false;
      this.ghosts.set(want.kind, mesh);
    }
    mesh.material = want.ok ? this.ghostOk : this.ghostBad;
    mesh.position.set(want.x, 0.02, want.z);
    mesh.setEnabled(true);
  }

  /** A ring on the ground under something selected: green, through amber, to red as it is worn down. */
  private ring(x: number, y: number, z: number, radius: number, hp: number): void {
    const i = this.rings.add();
    place(this.rings.matrices, i, x, y, z, 0, 0, 0, radius, 1, radius);
    const k = Math.max(0, Math.min(1, hp / 100));
    this.rings.colors!.set([k > 0.5 ? (1 - k) * 2 * 0.9 + 0.1 : 1, k > 0.5 ? 1 : k * 2 * 0.85 + 0.1, 0.25, 1], i * 4);
  }

  /** A mark on the ground (where a building would go, where an order was sent): a ring of this colour for this frame. */
  mark(x: number, y: number, z: number, radius: number, color: readonly [number, number, number]): void {
    const i = this.rings.add();
    place(this.rings.matrices, i, x, y + 0.14, z, 0, 0, 0, radius, 1, radius);
    this.rings.colors!.set([color[0], color[1], color[2], 1], i * 4);
  }

  /** Marks that last a moment (an order given): drawn by `effects`. */
  ping(x: number, y: number, z: number, color: [number, number, number], now: number): void {
    this.flashes.push({ x, y: y + 0.15, z, start: now, ms: 450, size: 2.2, color, ring: true });
  }

  private effects(now: number): void {
    const stretch = (many: Many, fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, wide: number, color: readonly [number, number, number]) => {
      const dx = tx - fx, dy = ty - fy, dz = tz - fz;
      const len = Math.hypot(dx, dy, dz) || 0.01;
      const i = many.add();
      place(many.matrices, i, (fx + tx) / 2, (fy + ty) / 2, (fz + tz) / 2, Math.atan2(dx, dz), -Math.asin(dy / len), 0, wide, wide, len);
      many.colors!.set([color[0], color[1], color[2], 1], i * 4);
    };
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      if (now >= t.until) {
        this.tracers.splice(i, 1);
        continue;
      }
      stretch(this.tracerMesh, t.fx, t.fy, t.fz, t.tx, t.ty, t.tz, t.wide, t.color);
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]!;
      const p = (now - s.start) / s.ms;
      if (p >= 1) {
        this.shells.splice(i, 1);
        continue;
      }
      if (p < 0) continue;
      const j = this.ballMesh.add();
      const size = s.arc > 0 ? 0.9 : 0.45;
      place(this.ballMesh.matrices, j, s.fx + (s.tx - s.fx) * p, s.fy + (s.ty - s.fy) * p + Math.sin(Math.PI * p) * s.arc, s.fz + (s.tz - s.fz) * p, 0, 0, 0, size, size, size);
      this.ballMesh.colors!.set([1, 0.86, 0.45, 1], j * 4);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      const p = (now - f.start) / f.ms;
      if (p >= 1) {
        this.flashes.splice(i, 1);
        continue;
      }
      if (p < 0) continue;
      const many = f.ring ? this.pulseMesh : this.flashMesh;
      const j = many.add();
      // Out fast, then it fades by shrinking away.
      const s = f.ring ? f.size * (0.2 + 0.8 * p) : f.size * (p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7);
      place(many.matrices, j, f.x, f.y, f.z, 0, 0, 0, s, f.ring ? Math.max(0.05, 1 - p) : s, s);
      const fade = f.ring ? 1 - p * 0.6 : 1;
      many.colors!.set([f.color[0] * fade, f.color[1] * fade, f.color[2] * fade, 1], j * 4);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      const t = (now - s.start) / 1000;
      if (t * 1000 >= s.ms) {
        this.sparks.splice(i, 1);
        continue;
      }
      if (t < 0) continue;
      const y = s.y + s.vy * t - 9.8 * t * t;
      if (y < 0) continue;
      const j = this.sparkMesh.add();
      const size = 0.28 * (1 - (t * 1000) / s.ms) + 0.05;
      place(this.sparkMesh.matrices, j, s.x + s.vx * t, y, s.z + s.vz * t, t * 9, t * 7, 0, size, size, size);
      this.sparkMesh.colors!.set([s.color[0], s.color[1], s.color[2], 1], j * 4);
    }
  }
}
