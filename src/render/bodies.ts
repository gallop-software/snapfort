import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import { BUILDER_GROUP } from "./physicsGroups";

/**
 * What the builder cannot walk through that moves: a world's vehicles and
 * units, parked or on the go (each world lists its own, as drawn: see
 * `WorldFeature.bodies`). A few physics bodies, moved each frame onto
 * whatever is nearest the builder (the rest are too far off to bump into),
 * in the builders' own collision group: so the builder's body is stopped by
 * them, while the camera and the crosshair pass through them as through a
 * builder (a tank between the builder and the camera does not pull the camera
 * in).
 */

/** A thing to bump into: a box `w` wide, `h` tall and `d` deep, its bottom middle at (x, y, z), turned `yaw` about the vertical. */
export interface BodyBox {
  x: number;
  y: number;
  z: number;
  yaw: number;
  w: number;
  h: number;
  d: number;
}

/** How many bodies: enough for a crowd round the builder. */
const POOL = 32;
/** Nothing further than this is given a body, m. */
const NEAR = 22;

interface Slot {
  node: TransformNode;
  body: PhysicsBody;
  shape: string;
}

export class Bodies {
  private readonly slots: Slot[] = [];
  private readonly shapes = new Map<string, PhysicsShapeBox>();

  constructor(private readonly scene: Scene) {}

  /** A box of a size, standing on its origin. Made once per size (to a tenth of a metre). */
  private shapeOf(w: number, h: number, d: number): [string, PhysicsShapeBox] {
    const key = `${w.toFixed(1)}|${h.toFixed(1)}|${d.toFixed(1)}`;
    let shape = this.shapes.get(key);
    if (!shape) {
      shape = new PhysicsShapeBox(new Vector3(0, h / 2, 0), Quaternion.Identity(), new Vector3(w, h, d), this.scene);
      shape.filterMembershipMask = BUILDER_GROUP;
      this.shapes.set(key, shape);
    }
    return [key, shape];
  }

  private slot(i: number): Slot {
    let slot = this.slots[i];
    if (!slot) {
      const node = new TransformNode(`body-${i}`, this.scene);
      node.position.set(0, -1000, 0);
      node.rotationQuaternion = Quaternion.Identity();
      const body = new PhysicsBody(node, PhysicsMotionType.ANIMATED, false, this.scene);
      // It is moved by hand each frame; the physics world takes its place from the node.
      body.disablePreStep = false;
      const [key, shape] = this.shapeOf(1, 1, 1);
      body.shape = shape;
      this.slots.push((slot = { node, body, shape: key }));
    }
    return slot;
  }

  /** Puts the bodies on the things nearest the builder (`me`: their body's middle); bodies left over are put out of the way. */
  update(me: { x: number; y: number; z: number }, things: Iterable<BodyBox>): void {
    const near: (BodyBox & { dist: number })[] = [];
    for (const t of things) {
      const dist = Math.hypot(t.x - me.x, t.z - me.z) - Math.max(t.w, t.d) / 2;
      if (dist < NEAR && t.y < me.y + 4 && t.y + t.h > me.y - 4) near.push({ ...t, dist });
    }
    near.sort((a, b) => a.dist - b.dist);
    const n = Math.min(POOL, near.length);
    for (let i = 0; i < Math.max(n, this.slots.length); i++) {
      const it = near[i];
      if (i >= n || !it) {
        const slot = this.slots[i]!;
        if (slot.node.position.y > -999) slot.node.position.set(0, -1000, 0);
        continue;
      }
      const slot = this.slot(i);
      const [key, shape] = this.shapeOf(it.w, it.h, it.d);
      if (slot.shape !== key) {
        slot.body.shape = shape;
        slot.shape = key;
      }
      slot.node.position.set(it.x, it.y, it.z);
      Quaternion.RotationYawPitchRollToRef(it.yaw, 0, 0, slot.node.rotationQuaternion!);
    }
  }

  /** How many bodies stand on something now (for checks). */
  get inUse(): number {
    return this.slots.filter((s) => s.node.position.y > -999).length;
  }
}
