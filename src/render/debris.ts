import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import type { Piece } from "../game/pieces";
import { pieceBounds, type Vec } from "../game/trebuchet";
import { BUILDER_GROUP, DEBRIS_GROUP } from "./physicsGroups";

/** Rubble lies this long, then fades. */
const LIFE = 5;
const FADE = 0.8;

interface Rubble {
  mesh: Mesh;
  body: PhysicsBody;
  shape: PhysicsShapeBox;
  age: number;
}

interface Puff {
  mesh: Mesh;
  age: number;
  life: number;
  grow: number;
}

/**
 * What a trebuchet brings down. Pieces that break fly apart from the impact;
 * pieces that lose their support tumble down as they were. All of it is real
 * physics for a few seconds (it bounces off the ground, what still stands and
 * each other), with puffs of dust, then fades away. It is only for show: the
 * pieces are already gone from the build.
 */
export class Debris {
  private readonly rubble: Rubble[] = [];
  private readonly puffs: Puff[] = [];
  private readonly dust: StandardMaterial;
  /** Most pieces of rubble at once; past that, pieces just vanish in a puff. */
  limit = 140;

  constructor(
    private readonly scene: Scene,
    private readonly meshOf: (piece: Piece) => Mesh,
  ) {
    this.dust = new StandardMaterial("dust", scene);
    this.dust.disableLighting = true;
    this.dust.emissiveColor = new Color3(0.86, 0.8, 0.7);
    this.dust.alpha = 0.6;
  }

  /**
   * Brings pieces down. `broken` ones burst away from `from` (the impact);
   * the rest fall as they stood.
   */
  spawn(pieces: readonly Piece[], broken: ReadonlySet<string>, from: Vec): void {
    for (const piece of pieces) {
      const [x0, y0, z0, x1, y1, z1] = pieceBounds(piece);
      const centre = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      if (broken.has(piece.id)) this.puff(centre, 2.2 + Math.random(), 1.1);
      if (this.rubble.length >= this.limit) {
        this.puff(centre, 1.6, 0.8);
        continue;
      }
      const mesh = this.meshOf(piece);
      mesh.isPickable = false;
      const body = new PhysicsBody(mesh, PhysicsMotionType.DYNAMIC, false, this.scene);
      // Collide around the mesh's own origin (bottom centre of the slot).
      const t = mesh.position;
      const size = new Vector3(Math.max(0.3, x1 - x0), Math.max(0.3, y1 - y0), Math.max(0.3, z1 - z0));
      const offset = centre.subtract(t);
      // The mesh is turned by its yaw; the box is in its own frame, so swap x and z for quarter turns.
      const yaw = mesh.rotationQuaternion?.toEulerAngles().y ?? 0;
      const quarter = Math.abs(Math.sin(yaw)) > 0.7;
      const local = quarter ? new Vector3(size.z, size.y, size.x) : size;
      const localOffset = quarter ? new Vector3(offset.z * Math.sign(Math.sin(yaw)), offset.y, -offset.x * Math.sign(Math.sin(yaw))) : offset;
      const shape = new PhysicsShapeBox(localOffset, Quaternion.Identity(), local, this.scene);
      shape.filterMembershipMask = DEBRIS_GROUP;
      shape.filterCollideMask = ~BUILDER_GROUP;
      shape.material = { friction: 0.7, restitution: 0.25 };
      body.shape = shape;
      body.setMassProperties({ mass: 40 + size.x * size.y * size.z * 10 });
      const r = () => Math.random() * 2 - 1;
      if (broken.has(piece.id)) {
        // Burst: away from the impact and upward, spinning hard.
        const away = centre.subtract(new Vector3(...from));
        away.y = Math.max(0, away.y);
        const dir = away.lengthSquared() > 0.01 ? away.normalize() : new Vector3(r(), 0.5, r()).normalize();
        body.setLinearVelocity(dir.scale(7 + Math.random() * 6).add(new Vector3(0, 4 + Math.random() * 3, 0)));
        body.setAngularVelocity(new Vector3(r() * 4, r() * 4, r() * 4));
      } else {
        // Losing support: a nudge so a falling tower leans and breaks up as it drops.
        body.setLinearVelocity(new Vector3(r() * 1.5, -0.5, r() * 1.5));
        body.setAngularVelocity(new Vector3(r() * 0.8, r() * 0.4, r() * 0.8));
      }
      this.rubble.push({ mesh, body, shape, age: 0 });
    }
  }

  /** A dust cloud at a point (an impact, say). */
  puff(at: Vector3, size: number, life: number): void {
    const mesh = CreateSphere("dust", { diameter: 1, segments: 6 }, this.scene);
    mesh.material = this.dust;
    mesh.isPickable = false;
    mesh.position.copyFrom(at);
    mesh.scaling.setAll(size * 0.4);
    this.puffs.push({ mesh, age: 0, life, grow: size });
  }

  update(dt: number): void {
    for (let i = this.rubble.length - 1; i >= 0; i--) {
      const r = this.rubble[i]!;
      r.age += dt;
      if (r.age > LIFE) r.mesh.visibility = Math.max(0, 1 - (r.age - LIFE) / FADE);
      // Gone after fading, or fallen out of the world.
      if (r.age > LIFE + FADE || r.mesh.position.y < -20) {
        r.body.dispose();
        r.shape.dispose();
        r.mesh.dispose();
        this.rubble.splice(i, 1);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]!;
      p.age += dt;
      const k = p.age / p.life;
      p.mesh.scaling.setAll(p.grow * (0.4 + 0.9 * Math.sqrt(k)));
      p.mesh.position.y += dt * 0.8;
      p.mesh.visibility = Math.max(0, 1 - k);
      if (k >= 1) {
        p.mesh.dispose();
        this.puffs.splice(i, 1);
      }
    }
  }

  get count(): number {
    return this.rubble.length;
  }
}
