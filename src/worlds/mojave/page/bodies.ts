import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import { BUILDER_GROUP } from "../../../render/physicsGroups";
import { UNITS, type UnitKind } from "../kit";

/**
 * What this general cannot walk through: the units and the other generals
 * nearest them. A few physics bodies, moved each frame onto whatever is
 * nearest (the rest are too far off to bump into), in the builders' own
 * collision group: so the general's body is stopped by them, while the camera
 * and the crosshair pass through them as through a builder (a soldier walking
 * between the general and the camera does not pull the camera in, and the
 * crosshair still lands on what is behind for the war's own picking).
 */

/** How many bodies: enough for a crowd round the general. */
const POOL = 32;
/** Nothing further than this is given a body, m. */
const NEAR = 22;
/** A general's body: a little narrower than the builder's capsule is wide, as tall. */
const GENERAL: readonly [number, number] = [0.7, 1.8];

interface Slot {
  node: TransformNode;
  body: PhysicsBody;
  shape: string;
}

export class Bodies {
  private readonly slots: Slot[] = [];
  private readonly shapes = new Map<string, PhysicsShapeBox>();

  constructor(private readonly scene: Scene) {
    for (let i = 0; i < POOL; i++) {
      const node = new TransformNode(`mojave-body-${i}`, scene);
      node.position.set(0, -1000, 0);
      node.rotationQuaternion = Quaternion.Identity();
      const body = new PhysicsBody(node, PhysicsMotionType.ANIMATED, false, scene);
      // It is moved by hand each frame; the physics world takes its place from the node.
      body.disablePreStep = false;
      body.shape = this.shapeOf("general");
      this.slots.push({ node, body, shape: "general" });
    }
  }

  /** A box the size of a kind of unit (or a general), standing on its origin. Made once per kind. */
  private shapeOf(kind: UnitKind | "general"): PhysicsShapeBox {
    let shape = this.shapes.get(kind);
    if (!shape) {
      const [w, h, d] = kind === "general" ? [GENERAL[0], GENERAL[1], GENERAL[0]] : kind === "trooper" ? [0.8, 1.85, 0.8] : [UNITS[kind].radius * 1.7, Math.min(3.2, UNITS[kind].height), UNITS[kind].radius * 2.1];
      shape = new PhysicsShapeBox(new Vector3(0, h / 2, 0), Quaternion.Identity(), new Vector3(w, h, d), this.scene);
      shape.filterMembershipMask = BUILDER_GROUP;
      this.shapes.set(kind, shape);
    }
    return shape;
  }

  /**
   * Puts the bodies on what is nearest the general now: ground units (feet at
   * their spot, turned as they face) and other generals (`others`: their
   * bodies' middles). Bodies left over are put out of the way.
   */
  update(me: { x: number; y: number; z: number }, units: Iterable<{ kind: UnitKind; x: number; y: number; z: number; h: number; tumble: unknown; goneAt: number }>, others: readonly (readonly [number, number, number])[]): void {
    const near: { kind: UnitKind | "general"; x: number; y: number; z: number; h: number; d: number }[] = [];
    for (const u of units) {
      if (UNITS[u.kind].air || u.tumble || u.goneAt) continue;
      const d = Math.hypot(u.x - me.x, u.z - me.z);
      if (d < NEAR && Math.abs(u.y - (me.y - 0.95)) < 4) near.push({ kind: u.kind, x: u.x, y: u.y, z: u.z, h: u.h, d });
    }
    for (const [x, y, z] of others) {
      const d = Math.hypot(x - me.x, z - me.z);
      if (d < NEAR) near.push({ kind: "general", x, y: y - 0.95, z, h: 0, d });
    }
    near.sort((a, b) => a.d - b.d);
    for (let i = 0; i < POOL; i++) {
      const slot = this.slots[i]!;
      const it = near[i];
      if (!it) {
        if (slot.node.position.y > -999) slot.node.position.set(0, -1000, 0);
        continue;
      }
      if (slot.shape !== it.kind) {
        slot.body.shape = this.shapeOf(it.kind);
        slot.shape = it.kind;
      }
      slot.node.position.set(it.x, it.y, it.z);
      Quaternion.RotationYawPitchRollToRef(it.h, 0, 0, slot.node.rotationQuaternion!);
    }
  }

  /** How many bodies stand on something now (for checks). */
  get inUse(): number {
    return this.slots.filter((s) => s.node.position.y > -999).length;
  }
}
