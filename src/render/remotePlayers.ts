import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { WireMove, WirePlayer } from "../net/protocol";
import { fallEnd, fallPhase, fallPosition, type Fall } from "../game/fall";
import type { OutfitBuilder, Ride } from "../worlds/pageDoors";
import { Avatar, downness } from "./avatar";
import { wading } from "./player";
import { StandIns } from "./standIns";

/** Positions are shown this far in the past, so there are always two to blend between, ms. */
/** The fastest a builder runs, m/s (a little over, for slack): anything faster between two samples is a jump. */
const TOP_SPEED = 32;
const DELAY = 200;
/**
 * How a builder is drawn depends on how big they look on screen (their height
 * as a share of half the screen's height), as in big shooters: zooming in on
 * someone far away brings back their full body. Distance alone never decides.
 *
 * Full animated body from this size up (about 120 m away without zoom)...
 */
const FULL_SIZE = 0.031;
/** ...back to the stand-in only below this, so nobody flickers between the two at the edge. */
const STAND_IN_SIZE = 0.026;
/** Name tags from this size up (about 50 m away without zoom). */
const TAG_SIZE = 0.075;
/** A builder's height, for their size on screen. */
const BODY = 1.8;
/** Feet are this far below the body centre that positions describe. */
const HALF_HEIGHT = 0.9;

interface Sample {
  at: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  ground: boolean;
  tumbling: boolean;
  /** Flying under their own control (shown as gliding: upright, the outfit's "glide" extra on). */
  flying: boolean;
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
  /** Shown with the full body (else as a stand-in). */
  full: boolean;
  /** Where the stand-in is in its running stride (radians). */
  stride: number;
  /** A flight from the server (thrown or falling), played here whatever their own page does. */
  fall: { fall: Fall; start: number } | null;
  down: number;
  /** Flying down under control at the end of a flight. */
  gliding: boolean;
  /** Sitting on something of a world's own (see PageGame.ride). */
  ride: Ride | null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Everyone else in the world. Their positions arrive about ten times a second
 * and are blended smoothly, a fifth of a second behind. Builders big enough on
 * screen get the full animated body (and, closer, a name tag); smaller ones
 * are stand-ins (see standIns.ts), so a crowd stays cheap to draw. The same
 * rule applies however many builders there are.
 */
export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>();
  private readonly spare: Avatar[] = [];
  private readonly standIns: StandIns;

  constructor(
    private readonly scene: Scene,
    private readonly shadows: ShadowGenerator,
    private readonly outfit: OutfitBuilder,
  ) {
    this.standIns = new StandIns(scene, shadows, outfit);
  }

  get count(): number {
    return this.remotes.size;
  }

  /** Where builder `id` is drawn (their body's centre), or null when unknown. */
  positionOf(id: string): [number, number, number] | null {
    const r = this.remotes.get(id);
    return r && r.y > -50 ? [r.x, r.y, r.z] : null;
  }

  /** Whether a builder is sitting on something of a world's own (a seat), or flying a throw: not a body to bump into just now. */
  isRiding(id: string): boolean {
    const r = this.remotes.get(id);
    return !!r && (r.ride !== null || r.fall !== null);
  }

  /** Whether a world has asked for a builder not to be drawn (see `conceal`). */
  isConcealed(id: string): boolean {
    return this.concealed.has(id);
  }

  /** Everyone here (but this builder), as they introduced themselves. */
  list(): WirePlayer[] {
    return [...this.remotes.values()].map((r) => r.player);
  }

  /** Adds a builder, or updates their name and colour. */
  join(player: WirePlayer): void {
    const remote = this.remotes.get(player.id);
    if (!remote) {
      this.remotes.set(player.id, { player, samples: [], x: 0, y: -100, z: 0, yaw: 0, vx: 0, vz: 0, ground: true, tumbling: false, gliding: false, ride: null, avatar: null, tag: null, full: false, stride: 0, fall: null, down: 0 });
      return;
    }
    const renamed = remote.player.name !== player.name || remote.player.color !== player.color;
    remote.player = player;
    if (renamed) {
      remote.avatar?.setColor(this.colorOf(player));
      this.disposeTag(remote);
    }
  }

  leave(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.release(remote);
    this.disposeTag(remote);
    this.remotes.delete(id);
    this.concealed.delete(id);
  }

  clear(): void {
    for (const id of [...this.remotes.keys()]) this.leave(id);
  }

  /** Builders a world has asked not to be drawn (see PageGame.conceal), by id. */
  private readonly concealed = new Set<string>();

  /** Colours a world has dressed builders in, in place of their own (see PageGame.wear), by id. */
  private readonly worn = new Map<string, string>();

  /** The colour a builder is drawn in: the one a world has dressed them in, else their own. */
  private colorOf(player: WirePlayer): string {
    return this.worn.get(player.id) ?? player.color;
  }

  /** Dresses builder `id` in a colour of the world's choosing (their jacket and the dot by their name), or (null) in their own again. */
  wear(id: string, color: string | null): void {
    if ((this.worn.get(id) ?? null) === color) return;
    if (color) this.worn.set(id, color);
    else this.worn.delete(id);
    const remote = this.remotes.get(id);
    if (!remote) return;
    remote.avatar?.setColor(this.colorOf(remote.player));
    this.disposeTag(remote);
  }

  /** Stops drawing builder `id`, or draws them again. */
  conceal(id: string, hidden: boolean): void {
    if (hidden) this.concealed.add(id);
    else this.concealed.delete(id);
  }

  /** Builder `id` sits on something of a world's own (null: no longer). */
  ride(id: string, seat: Ride | null): void {
    const remote = this.remotes.get(id);
    if (remote) remote.ride = seat;
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
    const sample: Sample = { at: now, x: m[1] / 100, y: m[2] / 100, z: m[3] / 100, yaw: m[4] / 1000, ground: (m[5] & 1) === 1, tumbling: (m[5] & 2) === 2, flying: (m[5] & 4) === 4 };
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

  /**
   * Blends positions, chooses full body or stand-in for each builder by their
   * size on screen (`fov`: the camera's vertical field of view), and draws
   * everyone. Call once a frame.
   */
  update(dt: number, now: number, viewer: Vector3, fov: number): void {
    const at = now - DELAY;
    const halfView = Math.tan(fov / 2);
    this.standIns.begin();
    for (const remote of this.remotes.values()) {
      if (remote.fall) this.followFall(remote, now);
      else this.blend(remote, at);
      // Riding: drawn on their seat, in full, wherever the last word of them was.
      const ride = remote.fall ? null : remote.ride;
      if (ride) {
        remote.x = ride.x;
        remote.y = ride.y + 0.4;
        remote.z = ride.z;
      }
      if (remote.samples.length === 0 && !remote.fall && !ride) continue;
      // Not to be drawn (a world's own rule): nothing of them shows.
      if (this.concealed.has(remote.player.id)) {
        this.release(remote);
        if (remote.tag) remote.tag.setEnabled(false);
        continue;
      }
      const dist = Math.max(0.1, Math.hypot(remote.x - viewer.x, remote.y - viewer.y, remote.z - viewer.z));
      const size = BODY / (dist * halfView);
      // Someone thrown always gets the full body: the flailing is the point.
      remote.full = remote.fall !== null || ride !== null || remote.gliding || size >= FULL_SIZE || (remote.full && size >= STAND_IN_SIZE);
      if (!remote.full) {
        this.release(remote);
        if (remote.tag) remote.tag.setEnabled(false);
        this.placeStandIn(remote, dt);
        continue;
      }
      const avatar = (remote.avatar ??= this.claim(this.colorOf(remote.player)));
      if (ride) avatar.sit(ride.x, ride.y, ride.z, ride.yaw, ride.pitch, ride.roll);
      else {
        const feet = remote.y - HALF_HEIGHT;
        avatar.root.position.set(remote.x, feet - wading(feet, this.wade(remote.x, remote.z)), remote.z);
        avatar.root.rotation.y = remote.yaw;
        if (remote.ground && feet < 0.4) this.wake(remote.x, remote.z, remote.vx, remote.vz, dt);
        avatar.animate(dt, remote.yaw, remote.vx, remote.vz, remote.ground, remote.tumbling, remote.down, remote.gliding);
      }
      const showTag = size >= TAG_SIZE;
      if (showTag && !remote.tag) remote.tag = this.makeTag(remote.player);
      if (remote.tag) {
        remote.tag.setEnabled(showTag);
        remote.tag.position.set(remote.x, remote.y + 1.45, remote.z);
      }
    }
    this.standIns.end();
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
    const phase = fallPhase(fall, t);
    remote.tumbling = phase === "tumble";
    remote.gliding = phase === "glide";
    remote.ground = t >= fall.time;
    remote.down = fall.glideFrom === undefined ? downness(t - fall.time) : 0;
    if (t >= fallEnd(fall)) {
      remote.gliding = false;
      remote.fall = null;
      remote.down = 0;
      // Hold the landing spot until their own page says otherwise (it may be asleep).
      remote.samples = [{ at: now, x, y, z, yaw: remote.yaw, ground: true, tumbling: false, flying: false }];
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
      // Nothing newer (or not yet time for the next): hold still where they were, never jumping ahead.
      const latest = a;
      remote.x = latest.x;
      remote.y = latest.y;
      remote.z = latest.z;
      remote.yaw = latest.yaw;
      remote.ground = latest.ground;
      remote.tumbling = latest.tumbling;
      remote.gliding = latest.flying;
      remote.vx = remote.vz = 0;
      return;
    }
    const span = Math.max(1, b.at - a.at);
    const t = Math.min(1, (at - a.at) / span);
    // Further than anyone runs in the time (a respawn, getting on something, a world putting them somewhere): a jump,
    // drawn as one, not a slide through whatever lies between.
    const jumped = Math.hypot(b.x - a.x, b.z - a.z) > (span / 1000) * TOP_SPEED + 1.5 || Math.abs(b.y - a.y) > (span / 1000) * TOP_SPEED + 3;
    const k = jumped ? (t < 0.5 ? 0 : 1) : t;
    const tx = a.x + (b.x - a.x) * k, ty = a.y + (b.y - a.y) * k, tz = a.z + (b.z - a.z) * k;
    // A straight line between two places they really were can still cut a wall's corner: where it would, they are
    // drawn stopped against it until the line is clear again (or the gap grows past a stride: then they are drawn there).
    const stop = !jumped && remote.y > -50 ? this.blocked([remote.x, remote.y, remote.z], [tx, ty, tz]) : null;
    if (stop && Math.hypot(tx - stop[0], tz - stop[2]) < 2) {
      remote.x = stop[0];
      remote.y = stop[1];
      remote.z = stop[2];
    } else {
      remote.x = tx;
      remote.y = ty;
      remote.z = tz;
    }
    remote.yaw = a.yaw + wrap(b.yaw - a.yaw) * t;
    remote.ground = t < 0.5 ? a.ground : b.ground;
    remote.tumbling = a.tumbling || b.tumbling;
    remote.gliding = t < 0.5 ? a.flying : b.flying;
    // A long gap means they stood still in between, not that they crept along.
    const moving = t < 1 && span < 400;
    remote.vx = moving ? ((b.x - a.x) / span) * 1000 : 0;
    remote.vz = moving ? ((b.z - a.z) / span) * 1000 : 0;
  }

  /**
   * A builder too small on screen for the full body: a flipbook pose (standing,
   * one of two running strides, or in the air), facing the way they run, with a
   * small bob on each step.
   */
  /**
   * Where a builder drawn moving from one spot to another would be stopped by
   * something solid on the way (the last clear spot), or null when the way is
   * clear. Set by the game, which knows what is solid; by default nothing is.
   */
  blocked: (from: [number, number, number], to: [number, number, number]) => [number, number, number] | null = () => null;

  /** How deep the water is at a spot, m (a world with pools says: see Scenery.wade). */
  wade: (x: number, z: number) => number = () => 0;
  /** Tells the world someone is moving through its water (see Scenery.wake). */
  wake: (x: number, z: number, vx: number, vz: number, dt: number) => void = () => {};

  private placeStandIn(remote: Remote, dt: number): void {
    const speed = Math.hypot(remote.vx, remote.vz);
    const running = remote.ground && speed > 0.5;
    if (running) remote.stride += dt * (7 + Math.min(1, speed / 26) * 11);
    const pose = !remote.ground ? "air" : !running ? "stand" : Math.sin(remote.stride) > 0 ? "runA" : "runB";
    const bob = running ? Math.abs(Math.sin(remote.stride)) * 0.08 : 0;
    const yaw = running ? Math.atan2(remote.vx, remote.vz) : remote.yaw;
    const feet = remote.y - HALF_HEIGHT;
    this.standIns.add(pose, remote.x, feet - wading(feet, this.wade(remote.x, remote.z)) + bob, remote.z, yaw, Color3.FromHexString(this.colorOf(remote.player)));
  }

  private claim(color: string): Avatar {
    const avatar = this.spare.pop() ?? new Avatar(this.scene, this.shadows, this.outfit, color);
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
    ctx.fillStyle = this.colorOf(player);
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
