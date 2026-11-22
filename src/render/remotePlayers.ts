import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { WireMove, WirePlayer } from "../net/protocol";
import { DOWN_TIME, fallPosition, RISE_TIME, type Fall } from "../game/fall";
import { Avatar, downness } from "./avatar";

/** Positions are shown this far in the past, so there are always two to blend between, ms. */
const DELAY = 200;
/** Builders nearer than this get the full animated body... */
const FULL_RANGE = 120;
/** ...up to this many of them, nearest first. The rest are simple figures. */
const FULL_LIMIT = 24;
/** Name tags show within this distance. */
const TAG_RANGE = 45;
/** Feet are this far below the body centre that positions describe. */
const HALF_HEIGHT = 0.9;
const MAX_FIGURES = 128;

interface Sample {
  at: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  ground: boolean;
  tumbling: boolean;
}

interface Remote {
  player: WirePlayer;
  samples: Sample[];
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  ground: boolean;
  tumbling: boolean;
  avatar: Avatar | null;
  tag: Mesh | null;
  /** A flight from the server (thrown or falling), played here whatever their own page does. */
  fall: { fall: Fall; start: number } | null;
  down: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Everyone else in the world. Their positions arrive about ten times a second
 * and are blended smoothly, a fifth of a second behind. Nearby builders get
 * the full animated body and a name tag; distant ones are simple figures in
 * their colour, all drawn as one mesh, so a crowd stays cheap to draw.
 */
export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>();
  private readonly spare: Avatar[] = [];
  private readonly figure: Mesh;
  private readonly figureMatrices = new Float32Array(MAX_FIGURES * 16);
  private readonly figureColors = new Float32Array(MAX_FIGURES * 4);
  private figureBuffers = false;

  constructor(
    private readonly scene: Scene,
    private readonly shadows: ShadowGenerator,
  ) {
    const body = CreateCapsule("figure-body", { radius: 0.3, height: 1.5, tessellation: 8, subdivisions: 1 }, scene);
    body.position.y = 0.75;
    const head = CreateSphere("figure-head", { diameter: 0.4, segments: 6 }, scene);
    head.position.y = 1.65;
    this.figure = Mesh.MergeMeshes([body, head], true, true)!;
    this.figure.name = "far-builders";
    const material = new StandardMaterial("far-builders", scene);
    material.specularColor = Color3.Black();
    this.figure.material = material;
    this.figure.isPickable = false;
    this.figure.alwaysSelectAsActiveMesh = true;
    this.figure.setEnabled(false);
  }

  get count(): number {
    return this.remotes.size;
  }

  /** Adds a builder, or updates their name and colour. */
  join(player: WirePlayer): void {
    const remote = this.remotes.get(player.id);
    if (!remote) {
      this.remotes.set(player.id, { player, samples: [], x: 0, y: -100, z: 0, yaw: 0, vx: 0, vz: 0, ground: true, tumbling: false, avatar: null, tag: null, fall: null, down: 0 });
      return;
    }
    const renamed = remote.player.name !== player.name || remote.player.color !== player.color;
    remote.player = player;
    if (renamed) {
      remote.avatar?.setColor(player.color);
      this.disposeTag(remote);
    }
  }

  leave(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.release(remote);
    this.disposeTag(remote);
    this.remotes.delete(id);
  }

  clear(): void {
    for (const id of [...this.remotes.keys()]) this.leave(id);
  }

  /** Builder `id` is thrown or falls: play the server's flight, then lying down and getting up. */
  throw(id: string, fall: Fall, now: number): void {
    const remote = this.remotes.get(id);
    if (remote) remote.fall = { fall, start: now };
  }

  /** A position from the server. */
  move(m: WireMove, now: number): void {
    const remote = this.remotes.get(m[0]);
    if (!remote) return;
    const sample: Sample = { at: now, x: m[1] / 100, y: m[2] / 100, z: m[3] / 100, yaw: m[4] / 1000, ground: (m[5] & 1) === 1, tumbling: (m[5] & 2) === 2 };
    if (remote.samples.length === 0) {
      // First sighting: appear there at once.
      remote.x = sample.x;
      remote.y = sample.y;
      remote.z = sample.z;
      remote.yaw = sample.yaw;
    }
    remote.samples.push(sample);
    if (remote.samples.length > 8) remote.samples.shift();
  }

  /** Blends positions, chooses who gets a full body, and draws everyone. Call once a frame. */
  update(dt: number, now: number, viewer: Vector3): void {
    const at = now - DELAY;
    const order: { remote: Remote; dist: number }[] = [];
    for (const remote of this.remotes.values()) {
      if (remote.fall) this.followFall(remote, now);
      else this.blend(remote, at);
      if (remote.samples.length === 0) continue;
      order.push({ remote, dist: Math.hypot(remote.x - viewer.x, remote.y - viewer.y, remote.z - viewer.z) });
    }
    order.sort((a, b) => a.dist - b.dist);

    let figures = 0;
    order.forEach(({ remote, dist }, rank) => {
      // Someone thrown always gets the full body, however far: the flailing is the point.
      const full = remote.fall !== null || (rank < FULL_LIMIT && dist < FULL_RANGE);
      if (!full) {
        this.release(remote);
        if (remote.tag) remote.tag.setEnabled(false);
        if (figures < MAX_FIGURES) this.placeFigure(figures++, remote);
        return;
      }
      const avatar = (remote.avatar ??= this.claim(remote.player.color));
      avatar.root.position.set(remote.x, remote.y - HALF_HEIGHT, remote.z);
      avatar.root.rotation.y = remote.yaw;
      avatar.animate(dt, remote.yaw, remote.vx, remote.vz, remote.ground, remote.tumbling, remote.down);
      const showTag = dist < TAG_RANGE;
      if (showTag && !remote.tag) remote.tag = this.makeTag(remote.player);
      if (remote.tag) {
        remote.tag.setEnabled(showTag);
        remote.tag.position.set(remote.x, remote.y + 1.45, remote.z);
      }
    });

    if (figures > 0 && !this.figureBuffers) {
      // Attach the buffers once there is something to draw: Babylon decides whether the
      // material uses per-instance colours when the mesh first has instances.
      this.figureBuffers = true;
      this.figure.thinInstanceSetBuffer("matrix", this.figureMatrices, 16, false);
      this.figure.thinInstanceSetBuffer("color", this.figureColors, 4, false);
    }
    if (!this.figureBuffers) return;
    // Count first: Babylon uploads only the first `thinInstanceCount` entries.
    this.figure.thinInstanceCount = figures;
    if (figures > 0) {
      this.figure.thinInstanceBufferUpdated("matrix");
      this.figure.thinInstanceBufferUpdated("color");
    }
    this.figure.setEnabled(figures > 0);
  }

  /** Moves a thrown builder along their flight; afterwards they stay where they came down. */
  private followFall(remote: Remote, now: number): void {
    const { fall, start } = remote.fall!;
    const t = (now - start) / 1000;
    const [x, y, z] = fallPosition(fall, t);
    remote.x = x;
    remote.y = y;
    remote.z = z;
    remote.vx = remote.vz = 0;
    remote.tumbling = t < fall.time;
    remote.ground = !remote.tumbling;
    remote.down = downness(t - fall.time);
    if (t >= fall.time + DOWN_TIME + RISE_TIME) {
      remote.fall = null;
      remote.down = 0;
      // Hold the landing spot until their own page says otherwise (it may be asleep).
      remote.samples = [{ at: now, x, y, z, yaw: remote.yaw, ground: true, tumbling: false }];
    }
  }

  /** Where `remote` was at time `at`, between the two samples around it. */
  private blend(remote: Remote, at: number): void {
    const s = remote.samples;
    if (s.length === 0) return;
    while (s.length > 2 && s[1]!.at <= at) s.shift();
    const a = s[0]!;
    const b = s[1];
    if (!b || at <= a.at) {
      // Nothing newer: hold still where they were last seen.
      const latest = b ?? a;
      remote.x = latest.x;
      remote.y = latest.y;
      remote.z = latest.z;
      remote.yaw = latest.yaw;
      remote.ground = latest.ground;
      remote.tumbling = latest.tumbling;
      remote.vx = remote.vz = 0;
      return;
    }
    const span = Math.max(1, b.at - a.at);
    const t = Math.min(1, (at - a.at) / span);
    remote.x = a.x + (b.x - a.x) * t;
    remote.y = a.y + (b.y - a.y) * t;
    remote.z = a.z + (b.z - a.z) * t;
    remote.yaw = a.yaw + wrap(b.yaw - a.yaw) * t;
    remote.ground = t < 0.5 ? a.ground : b.ground;
    remote.tumbling = a.tumbling || b.tumbling;
    // A long gap means they stood still in between, not that they crept along.
    const moving = t < 1 && span < 400;
    remote.vx = moving ? ((b.x - a.x) / span) * 1000 : 0;
    remote.vz = moving ? ((b.z - a.z) / span) * 1000 : 0;
  }

  private placeFigure(i: number, remote: Remote): void {
    const sin = Math.sin(remote.yaw), cos = Math.cos(remote.yaw);
    const m = this.figureMatrices, o = i * 16;
    m[o] = cos; m[o + 1] = 0; m[o + 2] = -sin; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = sin; m[o + 9] = 0; m[o + 10] = cos; m[o + 11] = 0;
    m[o + 12] = remote.x; m[o + 13] = remote.y - HALF_HEIGHT; m[o + 14] = remote.z; m[o + 15] = 1;
    const c = Color3.FromHexString(remote.player.color);
    this.figureColors.set([c.r, c.g, c.b, 1], i * 4);
  }

  private claim(color: string): Avatar {
    const avatar = this.spare.pop() ?? new Avatar(this.scene, this.shadows, color);
    avatar.setColor(color);
    avatar.setEnabled(true);
    return avatar;
  }

  private release(remote: Remote): void {
    if (!remote.avatar) return;
    remote.avatar.setEnabled(false);
    this.spare.push(remote.avatar);
    remote.avatar = null;
  }

  private makeTag(player: WirePlayer): Mesh {
    const texture = new DynamicTexture(`tag-${player.id}`, { width: 512, height: 96 }, this.scene, true);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 96);
    ctx.font = "bold 52px system-ui, sans-serif";
    const width = Math.min(500, ctx.measureText(player.name).width + 56);
    const x = (512 - width) / 2;
    ctx.fillStyle = "rgba(31, 42, 55, 0.78)";
    ctx.beginPath();
    ctx.roundRect(x, 12, width, 72, 36);
    ctx.fill();
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(x + 34, 48, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(player.name, x + 54, 50, width - 66);
    texture.update();

    const material = new StandardMaterial(`tag-${player.id}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.useAlphaFromDiffuseTexture = true;
    material.backFaceCulling = false;
    const tag = CreatePlane(`tag-${player.id}`, { width: 2.4, height: 0.45 }, this.scene);
    tag.material = material;
    tag.billboardMode = Mesh.BILLBOARDMODE_ALL;
    tag.isPickable = false;
    return tag;
  }

  private disposeTag(remote: Remote): void {
    if (!remote.tag) return;
    const material = remote.tag.material as StandardMaterial | null;
    material?.diffuseTexture?.dispose();
    material?.dispose();
    remote.tag.dispose();
    remote.tag = null;
  }
}
