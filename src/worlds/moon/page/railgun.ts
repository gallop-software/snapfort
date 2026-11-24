import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeSphere } from "@babylonjs/core/Physics/v2/physicsShape";
import { CELL, LEVEL } from "../../../game/constants";
import { standHeight } from "../../../game/fall";
import { BUILDER_GROUP, FRAME_GROUP } from "../../../render/physicsGroups";
import { paintMesh } from "../../../render/paint";
import type { DriveInput, PageGame, WorldFeature, WorldTool } from "../../pageDoors";
import {
  blocked,
  cannotPlace,
  feetOf,
  fits,
  footed,
  crowded,
  kindOf,
  middleOf,
  nameOf,
  operational,
  overlap,
  PARTS,
  railLine,
  RAILGUN,
  seatOf,
  standingFeet,
  type Gun,
  type GunToPage,
  type GunToServer,
  type PartKind,
} from "../railgunRules";
import { EDGE } from "../space";

/**
 * The page's side of the Moon's rail guns (see railgunRules.ts for what they
 * are): draws every part of every gun, shows where the next part goes while
 * the Railgun tool is picked, seats whoever is in a capsule, and after a
 * launch lets the rider fly themselves down on their rockets.
 */

export const RAILGUN_TOOL: WorldTool = {
  id: "railgun",
  label: "Railgun",
  key: "N",
  icon: '<path d="M4 30h32M6 30v-5h7v5M13 26 34 12M30 10l6 3-3 5"/><path d="M17 27v-6M22 27v-9M27 27V15"/>',
};

type RGB = [number, number, number];
const STEEL: RGB = [0.74, 0.77, 0.81];
const WHITE: RGB = [0.95, 0.96, 0.97];
const BLACK: RGB = [0.08, 0.085, 0.1];
const DARK: RGB = [0.24, 0.26, 0.3];
const BLUE: RGB = [0.25, 0.7, 0.95];

/** How steeply a rising segment climbs: a storey over its 10 m. */
const RISE = Math.atan2(LEVEL, 2 * CELL);

/**
 * One merged mesh for each kind of part, coloured by vertex, in the same
 * stainless, white and black as the launcher. Each has its origin on the
 * ground under its middle and points along +z.
 */
function partModels(game: PageGame): Record<PartKind, Mesh> {
  const { scene } = game;
  const part = (mesh: Mesh, color: RGB, x: number, y: number, z: number, rx = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.rotation.z = rz;
    return paintMesh(mesh, ...color);
  };
  const tube = (name: string, diameter: number, height: number, sides = 14) => CreateCylinder(name, { diameter, height, tessellation: sides }, scene);
  const merge = (name: string, parts: Mesh[]) => {
    const mesh = Mesh.MergeMeshes(parts, true, true)!;
    mesh.name = name;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    return mesh;
  };

  /** A length of rail: two steel rails on sleepers and short legs, with accelerator rings round the line the capsule runs. */
  const rail = (name: string, length: number) => {
    const parts: Mesh[] = [];
    for (const side of [-1, 1]) {
      parts.push(part(CreateBox("g-rail", { width: 0.16, height: 0.2, depth: length }, scene), STEEL, side * 0.7, 0.7, 0));
      parts.push(part(CreateBox("g-rail-foot", { width: 0.3, height: 0.08, depth: length }, scene), DARK, side * 0.7, 0.58, 0));
    }
    for (const z of [-length * 0.375, -length * 0.125, length * 0.125, length * 0.375]) {
      parts.push(part(CreateBox("g-sleeper", { width: 1.9, height: 0.12, depth: 0.4 }, scene), BLACK, 0, 0.5, z));
      for (const side of [-1, 1]) parts.push(part(tube("g-leg", 0.14, 0.5, 6), DARK, side * 0.8, 0.25, z));
    }
    for (const z of [-length * 0.25, 0.01, length * 0.25]) {
      const ring = CreateTorus("g-ring", { diameter: 2.9, thickness: 0.22, tessellation: 20 }, scene);
      parts.push(part(ring, WHITE, 0, 1.9, z, Math.PI / 2));
      const band = CreateTorus("g-ring-band", { diameter: 2.9, thickness: 0.26, tessellation: 20 }, scene);
      band.scaling.set(1, 0.35, 1);
      parts.push(part(band, BLUE, 0, 1.9, z + 0.14, Math.PI / 2));
    }
    return merge(name, parts);
  };

  const base = merge("gun-base", [
    part(tube("g-pad", 4.2, 0.18, 6), BLACK, 0, 0.09, 0),
    part(tube("g-pad-ring", 3.2, 0.3, 24), STEEL, 0, 0.3, 0),
    part(CreateBox("g-cabinet", { width: 1.5, height: 1.5, depth: 1.1 }, scene), WHITE, 0, 1.2, -0.5),
    part(CreateBox("g-cabinet-band", { width: 1.54, height: 0.16, depth: 1.14 }, scene), BLACK, 0, 1.55, -0.5),
    part(tube("g-mast", 0.12, 3.2, 6), DARK, -1.1, 2.0, -1.1),
    part(CreateBox("g-cable", { width: 0.3, height: 0.16, depth: 2.6 }, scene), DARK, 0, 0.5, 1.2),
  ]);

  // An open cradle: the capsule sits between its two cheeks, in plain view, with the drive and its three bells behind.
  const breech = merge("gun-breech", [
    part(CreateBox("g-block", { width: 3.6, height: 0.9, depth: 4.4 }, scene), BLACK, 0, 0.45, 0),
    ...[-1, 1].flatMap((side) => [
      part(CreateBox("g-cheek", { width: 0.5, height: 2.3, depth: 4.0 }, scene), WHITE, side * 1.5, 2.05, 0),
      part(CreateBox("g-cheek-band", { width: 0.54, height: 0.3, depth: 4.04 }, scene), BLACK, side * 1.5, 2.6, 0),
      part(CreateBox("g-cheek-coil", { width: 0.2, height: 1.2, depth: 3.2 }, scene), BLUE, side * 1.22, 1.9, 0),
    ]),
    part(CreateBox("g-back", { width: 3.5, height: 2.3, depth: 0.5 }, scene), STEEL, 0, 2.05, -2.0),
    ...[0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2;
      return part(CreateCylinder("g-bell", { diameterTop: 0.3, diameterBottom: 0.66, height: 0.6, tessellation: 10 }, scene), DARK, Math.sin(a) * 0.62, 1.9 + Math.cos(a) * 0.62, -2.5, -Math.PI / 2);
    }),
  ]);

  const capacitor = merge("gun-capacitor", [
    part(CreateBox("g-skid", { width: 3.6, height: 0.3, depth: 3.8 }, scene), BLACK, 0, 0.15, 0),
    ...[-1.1, 0, 1.1].flatMap((z) => [
      part(tube("g-cell", 1.0, 2.6), WHITE, 0.5, 1.6, z),
      part(tube("g-cell-band", 1.04, 0.3), BLACK, 0.5, 2.3, z),
      part(CreateSphere("g-cell-top", { diameter: 1.0, segments: 10 }, scene), STEEL, 0.5, 2.9, z),
    ]),
    part(CreateBox("g-bus", { width: 0.9, height: 0.5, depth: 3.2 }, scene), BLUE, -0.9, 0.9, 0),
    part(CreateBox("g-feed", { width: 1.6, height: 0.2, depth: 0.3 }, scene), DARK, -1.6, 0.9, 0),
  ]);

  const riseLength = Math.hypot(2 * CELL, LEVEL);
  const muzzle = merge("gun-muzzle", [
    part(tube("g-pylon", 0.9, 1.4, 10), DARK, 0, 0.7, 0),
    part(tube("g-mouth", 2.4, 3.2, 20), STEEL, 0, 2.0, 0.2, Math.PI / 2 - RISE),
    part(CreateCylinder("g-flare", { diameterTop: 3.4, diameterBottom: 2.4, height: 0.9, tessellation: 20 }, scene), BLACK, 0, 2.0 + Math.sin(RISE) * 2, 0.2 + Math.cos(RISE) * 2, Math.PI / 2 - RISE),
    ...[0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const fin = CreateBox("g-fin", { width: 1.3, height: 0.1, depth: 0.9 }, scene);
      fin.rotation.z = a;
      return part(fin, DARK, Math.cos(a) * 1.7, 2.0 + Math.sin(a) * 1.7, 0);
    }),
  ]);

  const capsule = merge("gun-capsule", [
    // A sled with an open seat: the rider sits in it, in plain view.
    part(CreateBox("g-sled", { width: 1.5, height: 0.3, depth: 2.6 }, scene), WHITE, 0, 1.75, 0),
    part(CreateBox("g-sled-band", { width: 1.54, height: 0.1, depth: 0.5 }, scene), BLACK, 0, 1.78, 0.9),
    part(CreateCylinder("g-nose", { diameterTop: 0.3, diameterBottom: 1.4, height: 1.3, tessellation: 14 }, scene), WHITE, 0, 1.95, 1.85, Math.PI / 2),
    part(CreateBox("g-seat-back", { width: 1.0, height: 1.2, depth: 0.2 }, scene), DARK, 0, 2.45, -0.55, -0.15),
    part(CreateBox("g-seat", { width: 1.0, height: 0.12, depth: 0.8 }, scene), DARK, 0, 1.94, -0.1),
    part(CreateBox("g-shoe", { width: 0.3, height: 0.5, depth: 2.2 }, scene), BLUE, -0.7, 1.4, 0),
    part(CreateBox("g-shoe", { width: 0.3, height: 0.5, depth: 2.2 }, scene), BLUE, 0.7, 1.4, 0),
  ]);

  return { base, breech, capacitor, rail: rail("gun-rail", 2 * CELL), rise: rail("gun-rise", riseLength), muzzle, capsule };
}

interface Shown {
  gun: Gun;
  meshes: Map<number, { mesh: Mesh; aim: PhysicsBody; node: TransformNode }>;
  /** The capsule running the rail after a launch: since when (performance.now()). */
  firedAt: number;
}

/** Where a part's mesh goes, and how it is turned. */
function placement(gun: Pick<Gun, "x" | "y" | "z" | "dir">, n: number): { x: number; y: number; z: number; yaw: number; pitch: number } {
  const feet = feetOf(gun, n);
  const x = (feet.reduce((s, f) => s + f.x, 0) / feet.length + 0.5) * CELL, z = (feet.reduce((s, f) => s + f.z, 0) / feet.length + 0.5) * CELL;
  const rising = kindOf(n) === "rise";
  return { x, y: feet[0]!.y * LEVEL + (rising ? LEVEL / 2 : 0), z, yaw: (gun.dir * Math.PI) / 2, pitch: rising ? -RISE : 0 };
}

export function startRailguns(game: PageGame): WorldFeature & { guns: Map<number, Shown>; readonly seated: number | null; readonly preview: { gun: number | null; part: number; ok: boolean } | null; readonly riding: boolean; readonly flying: boolean } {
  const { scene } = game;
  const models = partModels(game);
  const solid = new StandardMaterial("railgun", scene);
  solid.specularColor = new Color3(0.2, 0.2, 0.22);
  solid.specularPower = 28;
  const ghostMaterial = (name: string, r: number, g: number, b: number, alpha: number) => {
    const m = new StandardMaterial(`railgun-${name}`, scene);
    m.disableLighting = true;
    m.emissiveColor = new Color3(r, g, b);
    m.alpha = alpha;
    m.fogEnabled = false;
    return m;
  };
  const ghosts = { plan: ghostMaterial("plan", 0.35, 0.65, 1, 0.16), ok: ghostMaterial("ok", 0.25, 0.95, 0.55, 0.5), bad: ghostMaterial("bad", 1, 0.3, 0.25, 0.5) };
  /**
   * "Build a floor here": a bright slab where a part needs a floor that is not
   * there yet (one or more storeys up, for the rising end), on a thin post from
   * the ground so it is plain how high that is.
   */
  const need = ghostMaterial("need", 1, 0.8, 0.2, 0.6);
  const needSlabs: { slab: Mesh; post: Mesh }[] = [];
  function showNeeds(feet: readonly { x: number; y: number; z: number }[]): void {
    feet.forEach((f, i) => {
      let m = needSlabs[i];
      if (!m) {
        const slab = CreateBox("gun-need", { width: CELL - 0.3, height: 0.3, depth: CELL - 0.3 }, scene);
        const post = CreateBox("gun-need-post", { width: 0.25, height: 1, depth: 0.25 }, scene);
        for (const mesh of [slab, post]) {
          mesh.material = need;
          mesh.isPickable = false;
        }
        needSlabs[i] = m = { slab, post };
      }
      m.slab.setEnabled(true);
      m.post.setEnabled(true);
      m.slab.position.set((f.x + 0.5) * CELL, f.y * LEVEL, (f.z + 0.5) * CELL);
      m.post.scaling.y = Math.max(0.01, f.y * LEVEL);
      m.post.position.set((f.x + 0.5) * CELL, (f.y * LEVEL) / 2, (f.z + 0.5) * CELL);
    });
    for (let i = feet.length; i < needSlabs.length; i++) {
      needSlabs[i]!.slab.setEnabled(false);
      needSlabs[i]!.post.setEnabled(false);
    }
  }

  const guns = new Map<number, Shown>();
  /** The server's clock is this far ahead of this page's (ms), to read `readyAt` by. */
  let ahead = 0;
  /** The gun whose capsule this player sits in. */
  let seated: number | null = null;
  let asked = 0;
  /** What the Railgun tool is showing this frame: which gun and part, and whether it can go there. */
  let preview: { gun: number | null; part: number; ok: boolean; base?: { x: number; y: number; z: number; dir: number } } | null = null;
  let aimed = false;
  const planMeshes: Mesh[] = [];
  const send = (msg: GunToServer) => game.send(msg);
  const serverNow = () => Date.now() + ahead;

  function makePart(gun: Gun, n: number, material: StandardMaterial, name: string): Mesh {
    const mesh = models[kindOf(n)].clone(name);
    mesh.setEnabled(true);
    mesh.material = material;
    const at = placement(gun, n);
    mesh.position.set(at.x, at.y, at.z);
    mesh.rotation.set(at.pitch, at.yaw, 0);
    return mesh;
  }

  /** Makes what is drawn of a gun match what the server says is on it. */
  function show(gun: Gun, knocked: readonly number[] = []): void {
    let s = guns.get(gun.id);
    if (!s) guns.set(gun.id, (s = { gun, meshes: new Map(), firedAt: 0 }));
    s.gun = gun;
    for (const [n, held] of s.meshes) {
      if (gun.parts.includes(n)) continue;
      held.aim.dispose();
      held.node.dispose();
      if (knocked.includes(n)) fallAway(held.mesh);
      else held.mesh.dispose();
      s.meshes.delete(n);
    }
    for (const n of gun.parts) {
      if (s.meshes.has(n)) continue;
      const mesh = makePart(gun, n, solid, `gun-${gun.id}-${n}`);
      mesh.receiveShadows = true;
      game.shadows.addShadowCaster(mesh);
      // Something for a launcher's crosshair to land on (builders walk through).
      const middle = middleOf(gun, n);
      const node = new TransformNode(`gun-aim-${gun.id}-${n}`, scene);
      node.position.set(middle[0], middle[1], middle[2]);
      const ball = new PhysicsShapeSphere(Vector3.Zero(), RAILGUN.hitSize * 0.85, scene);
      ball.filterMembershipMask = FRAME_GROUP;
      ball.filterCollideMask = ~BUILDER_GROUP;
      const aim = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
      aim.shape = ball;
      aim.disableSync = true;
      s.meshes.set(n, { mesh, aim, node });
    }
  }

  function forget(id: number): void {
    const s = guns.get(id);
    if (!s) return;
    for (const held of s.meshes.values()) {
      held.aim.dispose();
      held.node.dispose();
      fallAway(held.mesh);
    }
    guns.delete(id);
    if (seated === id) leaveSeat(false);
  }

  /** A part knocked off: it drops and tips over for a moment, then is gone. */
  const falling: { mesh: Mesh; t: number }[] = [];
  function fallAway(mesh: Mesh): void {
    falling.push({ mesh, t: 0 });
    game.sound.noise(0.25, 0.2, 500);
    game.sound.tone("sine", 140, 50, 0.3, 0.3);
  }

  function leaveSeat(tell: boolean): void {
    if (seated === null) return;
    if (tell) send({ k: "gun-sit", id: seated, on: false });
    seated = null;
    game.ride(game.myId(), null);
  }

  /** Seconds until a whole gun can fire (0: ready). */
  const charging = (gun: Gun) => Math.max(0, Math.ceil((gun.readyAt - serverNow()) / 1000));

  /** The gun nearest a spot, by its nearest part place (in place or not), within `reach` metres. */
  function nearestGun(x: number, z: number, reach: number): Shown | null {
    let best: Shown | null = null;
    let bestDist = reach;
    for (const s of guns.values()) {
      for (let n = 1; n <= PARTS; n++) {
        const m = middleOf(s.gun, n);
        const d = Math.hypot(m[0] - x, m[2] - z);
        if (d < bestDist) {
          best = s;
          bestDist = d;
        }
      }
    }
    return best;
  }

  /** A line about a gun for the panel: how far along it is, or whether it is ready. */
  function statusOf(gun: Gun): string {
    if (gun.parts.length < PARTS) return `<b>Rail gun · ${gun.parts.length} of ${PARTS} parts</b>`;
    const jammed = blocked(game.build, gun);
    if (jammed.length > 0) return `<b class="bad">Rail gun blocked</b><small>Clear what is built on part ${jammed[0]} (${nameOf(jammed[0]!)})</small>`;
    const wait = charging(gun);
    return wait > 0 ? `<b>Rail gun charging · ${wait} s</b>` : `<b class="ok">Rail gun ready</b>`;
  }

  // ── The launch, and flying down ────────────────────────────────────────
  /** This player's own launch: when the gun fired (performance.now()); 0 when they are not on their way up. */
  let rideAt = 0;
  /** Off the top of the launch and flying down on their rockets: where they are, and how fast they are going. */
  let flying: { at: Vector3; v: Vector3 } | null = null;
  const HALF = 0.9;
  const FAR = EDGE + 10;

  /** The top of whatever is under (x, z) at or below height `y` (the ground, at least), from what is built. */
  function surfaceUnder(x: number, y: number, z: number): number {
    let top = 0;
    for (const piece of game.build.near(x, y, z)) {
      const h = standHeight(piece, x, z, game.env.roof);
      if (h !== null && h <= y + 0.3 && h > top) top = h;
    }
    return top;
  }

  /** True when a body centred there would be inside the side of a wall. */
  function inWall(x: number, y: number, z: number): boolean {
    for (const piece of game.build.near(x, y, z)) {
      if (piece.type !== "wall") continue;
      const top = standHeight(piece, x, z);
      if (top !== null && y - HALF < top - 0.25 && y + HALF > piece.y * LEVEL) return true;
    }
    return false;
  }

  /**
   * One frame of flying down: the rockets carry the rider the way they look
   * (down is a dive; they will not climb), sinking a little all the while,
   * less with the jump key held. Walls stop them; the first thing under their
   * feet (a floor, a roof, the ground) is where they land.
   */
  function fly(dt: number, input: DriveInput): void {
    const f = flying!;
    const pitch = game.viewPitch();
    const ahead = new Vector3(Math.sin(input.yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(input.yaw) * Math.cos(pitch));
    const right = new Vector3(Math.cos(input.yaw), 0, -Math.sin(input.yaw));
    const speed = input.run ? RAILGUN.flyFast : RAILGUN.flySpeed;
    // Back is the brakes.
    const want = ahead.scale(Math.max(0, input.forward) * speed).add(right.scale(input.strafe * speed * 0.6));
    want.y = Math.min(want.y, 0) - (input.jump ? RAILGUN.sinkSlow : RAILGUN.sink);
    f.v.addInPlace(want.subtract(f.v).scale(1 - Math.exp(-dt * 2.4)));
    let x = Math.max(-FAR, Math.min(FAR, f.at.x + f.v.x * dt)), z = Math.max(-FAR, Math.min(FAR, f.at.z + f.v.z * dt));
    let y = f.at.y + f.v.y * dt;
    if (inWall(x, y, z)) {
      // Into a wall: no further that way.
      x = f.at.x;
      z = f.at.z;
      f.v.x = f.v.z = 0;
    }
    const ground = surfaceUnder(x, f.at.y - HALF, z);
    if (y - HALF <= ground) {
      // Down: on their feet, rockets off, walking from here.
      flying = null;
      y = ground + HALF + 0.03;
      game.player.seat(x, y, z);
      game.panel(null);
      game.sound.tone("sine", 110, 50, 0.25, 0.35);
      game.sound.noise(0.2, 0.12, 700);
      return;
    }
    f.at.set(x, y, z);
    game.player.fly(x, y, z);
    game.panel(`<b>Rockets · ${Math.round(y - HALF - ground)} m up</b><small>${game.touch ? "Push to fly where you look · Jump slows the fall" : "<kbd>W</kbd> fly where you look · <kbd>Space</kbd> slow the fall · <kbd>Shift</kbd> faster"}</small>`);
  }

  const feature = {
    guns,
    get seated() {
      return seated;
    },
    get preview() {
      return preview;
    },
    get riding() {
      return rideAt > 0;
    },
    get flying() {
      return flying !== null;
    },

    joined() {
      for (const id of [...guns.keys()]) {
        const s = guns.get(id)!;
        for (const held of s.meshes.values()) {
          held.aim.dispose();
          held.node.dispose();
          held.mesh.dispose();
        }
        guns.delete(id);
      }
      seated = null;
    },

    message(data: unknown) {
      const msg = data as GunToPage;
      if (msg.k === "guns") {
        ahead = msg.now - Date.now();
        for (const gun of msg.list) show(gun);
      } else if (msg.k === "gun") {
        ahead = msg.now - Date.now();
        asked = 0;
        const was = guns.get(msg.gun.id)?.gun;
        show(msg.gun, msg.knocked);
        if (was && was.rider !== null && was.rider !== msg.gun.rider) game.ride(was.rider, null);
        const me = game.myId();
        if (msg.gun.rider === me && seated !== msg.gun.id) {
          seated = msg.gun.id;
          game.sound.tone("sine", 300, 620, 0.12, 0.14);
        } else if (msg.gun.rider !== me && seated === msg.gun.id) leaveSeat(false);
        // The last part on: it comes alive.
        if (was && was.parts.length < PARTS && msg.gun.parts.length === PARTS) {
          game.toast("The rail gun is whole: charging", 3500);
          game.sound.tone("sine", 220, 660, 0.8, 0.12);
          game.sound.tone("sine", 330, 990, 0.8, 0.1, 0.2);
        }
      } else if (msg.k === "gun-gone") forget(msg.id);
      else if (msg.k === "gun-fire") {
        const s = guns.get(msg.id);
        if (s) s.firedAt = performance.now();
        game.ride(msg.by, null);
        const p = game.player.position;
        const from = s ? middleOf(s.gun, 2) : [p.x, p.y, p.z];
        if (Math.hypot(p.x - from[0]!, p.z - from[2]!) < 400) {
          // A rising whine down the rail, and the crack as it leaves.
          game.sound.tone("sawtooth", 120, 1800, RAILGUN.rideRail, 0.14);
          game.sound.noise(0.5, 0.35, 2600);
          game.sound.tone("sine", 90, 28, 0.9, 0.5, RAILGUN.rideRail);
        }
        if (msg.by === game.myId()) {
          seated = null;
          rideAt = performance.now();
        }
      } else if (msg.k === "gun-no") {
        asked = 0;
        const why: Record<string, string> = {
          have: "That part is already on",
          join: "That part has nothing to join to yet",
          under: "It needs a floor under it, at its own height: build up to it first",
          crowded: "Something is built in the way",
          room: "No room: the whole gun must fit inside the building area",
          far: "Get closer",
          locked: "Building on the Moon comes with the Full Game",
          full: "The Moon has as many rail guns as it can hold",
          overlap: "Another rail gun is in the way",
          busy: "Someone is in the capsule",
          charging: "Still charging",
          broken: "The rail gun is not whole and clear",
        };
        game.toast(why[msg.why] ?? "Not now");
        game.sound.tone("square", 150, 150, 0.07, 0.07);
      }
    },

    /** Sitting in a capsule holds the player there; flying down, their rockets carry them. */
    drive(dt: number, input: DriveInput): boolean {
      if (flying) {
        fly(dt, input);
        return true;
      }
      const s = seated === null ? undefined : guns.get(seated);
      if (!s) return false;
      const seat = seatOf(s.gun);
      game.ride(game.myId(), { x: seat.x, y: seat.y, z: seat.z, yaw: seat.yaw, pitch: 0, roll: 0 });
      game.player.seat(seat.x, seat.y + 0.6, seat.z);
      return true;
    },

    update(dt: number) {
      const now = performance.now();
      // Thrown out of the capsule (a shot landed by it): the server has already emptied the seat.
      if (seated !== null && game.player.knockedDown) leaveSeat(false);
      for (const s of guns.values()) {
        // Whoever else sits in a capsule is drawn there.
        if (s.gun.rider !== null && s.gun.rider !== game.myId()) {
          const seat = seatOf(s.gun);
          game.ride(s.gun.rider, { x: seat.x, y: seat.y, z: seat.z, yaw: seat.yaw, pitch: 0, roll: 0 });
        }
        // The capsule: at the breech, or running the rail just after a launch (then away a while, and back).
        const capsule = s.meshes.get(22)?.mesh;
        if (!capsule) continue;
        const t = s.firedAt ? (now - s.firedAt) / 1000 : Infinity;
        const home = placement(s.gun, 22);
        if (t >= RAILGUN.rideRail + 2.5) {
          capsule.setEnabled(true);
          capsule.position.set(home.x, home.y, home.z);
          capsule.rotation.set(0, home.yaw, 0);
          s.firedAt = 0;
        } else if (t >= RAILGUN.rideRail) capsule.setEnabled(false);
        else {
          const { from, bend, to } = railLine(s.gun);
          const flat = Math.hypot(bend[0] - from[0], bend[2] - from[2]), slope = Math.hypot(to[0] - bend[0], to[1] - bend[1], to[2] - bend[2]);
          const d = (t / RAILGUN.rideRail) ** 2 * (flat + slope);
          const [a, b, k] = d <= flat ? [from, bend, d / flat] : [bend, to, (d - flat) / slope];
          capsule.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k - 2.0, a[2] + (b[2] - a[2]) * k);
          capsule.rotation.set(d <= flat ? 0 : -RISE, home.yaw, 0);
        }
      }
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i]!;
        f.t += dt;
        f.mesh.position.y -= dt * 3 * f.t;
        f.mesh.rotation.z += dt * 2.2;
        f.mesh.scaling.setAll(Math.max(0.01, 1 - f.t / 0.8));
        if (f.t >= 0.8) {
          f.mesh.dispose();
          falling.splice(i, 1);
        }
      }

      // This player's own launch: at the top of it the server lets go, and they fly themselves from there.
      if (rideAt > 0) {
        const t = (now - rideAt) / 1000;
        if (!game.player.knockedDown && t > 1) {
          rideAt = 0;
          const p = game.player.position;
          // (Unless the flight never came: then they are still by the gun, on the ground.)
          if (p.y > 30) {
            flying = { at: new Vector3(p.x, p.y, p.z), v: new Vector3(0, -RAILGUN.sink, 0) };
            game.toast(game.touch ? "Your rockets: push the stick to fly where you look" : "Your rockets: W flies where you look. Land anywhere", 5000);
          }
        }
      }
      // Hit by a shot on the way down: thrown like anyone, the flying is over.
      if (flying && game.player.knockedDown) flying = null;

      // The plan and the panel show only while the Railgun tool is being aimed, or beside a capsule.
      if (!aimed) {
        for (const m of planMeshes) m.setEnabled(false);
        showNeeds([]);
        preview = null;
        const s = seated !== null ? guns.get(seated) : nearCapsule();
        if (!flying) game.panel(s && rideAt === 0 ? statusOf(s.gun) + (seated !== null && operational(game.build, s.gun) && charging(s.gun) === 0 ? `<small>${game.touch ? "Tap Place" : "Click"} to launch</small>` : "") : null);
      }
      aimed = false;
      if (asked && now - asked > 2500) asked = 0;
    },

    board(): boolean {
      if (flying) return true;
      if (seated !== null) {
        const s = guns.get(seated);
        leaveSeat(true);
        if (s) {
          // Out beside the breech.
          const seat = seatOf(s.gun);
          game.player.seat(seat.x + Math.cos(seat.yaw) * 2.6, s.gun.y * LEVEL + 1.1, seat.z - Math.sin(seat.yaw) * 2.6);
        }
        return true;
      }
      const s = nearCapsule();
      if (!s) return false;
      if (s.gun.rider !== null) game.toast("Someone is in the capsule");
      else if (!asked) {
        asked = performance.now();
        send({ k: "gun-sit", id: s.gun.id, on: true });
      }
      return true;
    },

    prompt() {
      if (flying) return null;
      if (seated !== null) return { text: "<kbd>H</kbd> get out of the capsule", button: "Get out" };
      const s = nearCapsule();
      if (!s || s.gun.rider !== null) return null;
      return { text: "<kbd>H</kbd> get in the rail gun's capsule", button: "Get in" };
    },

    busy() {
      return seated !== null || flying !== null;
    },

    /** In the capsule, a click fires it. */
    act() {
      const s = seated === null ? undefined : guns.get(seated);
      if (!s) return;
      if (!operational(game.build, s.gun)) return game.toast(s.gun.parts.length < PARTS ? `Not finished: ${s.gun.parts.length} of ${PARTS} parts` : "Blocked: something is built on it");
      const wait = charging(s.gun);
      if (wait > 0) return game.toast(`Still charging: ${wait} s`);
      send({ k: "gun-launch" });
    },

    /** The Railgun tool is picked: show the plan of the gun being aimed at and the part that would go on, or where a new one would start. */
    aimTool(id: string) {
      if (id !== RAILGUN_TOOL.id) return;
      aimed = true;
      const p = game.player.position;
      const yaw = game.viewYaw();
      const spot = game.aim(RAILGUN.placeReach) ?? [p.x + Math.sin(yaw) * 8, Math.max(0, p.y - 0.9), p.z + Math.cos(yaw) * 8];
      let used = 0;
      const draw = (gun: Pick<Gun, "x" | "y" | "z" | "dir">, n: number, material: StandardMaterial) => {
        let mesh = planMeshes[used];
        const kind = kindOf(n);
        if (!mesh || mesh.metadata !== kind) {
          mesh?.dispose();
          mesh = models[kind].clone("gun-plan");
          mesh.metadata = kind;
          planMeshes[used] = mesh;
        }
        used++;
        mesh.setEnabled(true);
        mesh.material = material;
        const at = placement(gun, n);
        mesh.position.set(at.x, at.y, at.z);
        mesh.rotation.set(at.pitch, at.yaw, 0);
      };

      const s = nearestGun(spot[0], spot[2], 9);
      if (s && s.gun.parts.length < PARTS) {
        // The missing part nearest the crosshair that could go on; failing that, the nearest missing one, to say why not.
        const missing = Array.from({ length: PARTS }, (_, i) => i + 1).filter((n) => !s.gun.parts.includes(n));
        const far = (n: number) => { const m = middleOf(s.gun, n); return Math.hypot(m[0] - spot[0], m[2] - spot[2]); };
        const can = missing.filter((n) => cannotPlace(game.build, s.gun, n) === null).sort((a, b) => far(a) - far(b));
        const pick = can[0] !== undefined && far(can[0]) < 16 ? can[0] : missing.sort((a, b) => far(a) - far(b))[0]!;
        const why = cannotPlace(game.build, s.gun, pick);
        for (const n of missing) if (n !== pick) draw(s.gun, n, ghosts.plan);
        draw(s.gun, pick, why ? ghosts.bad : ghosts.ok);
        preview = { gun: s.gun.id, part: pick, ok: why === null };
        // Nothing under it: say how high the floor has to be, and mark the spot (the rising end stands a storey or more up).
        const lacking = why === "under" ? standingFeet(s.gun, pick).filter((f) => !footed(game.build, f)) : [];
        showNeeds(lacking);
        const up = (lacking[0]?.y ?? 0) - 0;
        const high = up <= 0 ? "" : up === 1 ? "one storey up" : up === 2 ? "two storeys up" : up === 3 ? "three storeys up" : `${up} storeys up`;
        const reason = { have: "", join: "nothing to join to yet", under: `needs a floor ${high} at the yellow mark: build walls up to it, and a floor on top`, crowded: "something is built in the way", room: "" }[why ?? "have"];
        game.panel(`${statusOf(s.gun)}<small>${why ? `<span class="bad">${pick} · ${nameOf(pick)}: ${reason}</span>` : `<span class="ok">${pick} · ${nameOf(pick)}</span> · ${game.touch ? "tap Place" : "click"} to put it on`}</small>`);
      } else if (s) {
        preview = null;
        showNeeds([]);
        game.panel(statusOf(s.gun) + `<small>Finished. Aim at open ground to start another</small>`);
      } else {
        // A new gun: its base here, pointing the way the player faces; the whole of it shown, to see that it fits.
        const dir = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
        const base = { x: Math.floor(spot[0] / CELL), y: Math.max(0, Math.round((spot[1] - 0.15) / LEVEL)), z: Math.floor(spot[2] / CELL), dir };
        const foot = feetOf(base, 1)[0]!;
        const clash = [...guns.values()].some((g) => overlap(g.gun, base));
        showNeeds([]);
        const problem = !fits(base) ? "no room: all 175 m of it must fit inside the building area" : clash ? "another rail gun is in the way" : crowded(game.build, foot) ? "something is built in the way" : !footed(game.build, foot) ? "needs the ground or a floor under it" : null;
        for (let n = 2; n <= PARTS; n++) draw(base, n, ghosts.plan);
        draw(base, 1, problem ? ghosts.bad : ghosts.ok);
        preview = { gun: null, part: 1, ok: problem === null, base };
        game.panel(`<b>New rail gun</b><small>${problem ? `<span class="bad">${problem}</span>` : `<span class="ok">1 · Base</span> · ${game.touch ? "tap Place" : "click"} to start it here, pointing this way`}</small>`);
      }
      for (let i = used; i < planMeshes.length; i++) planMeshes[i]!.setEnabled(false);
    },

    useTool(id: string) {
      if (id !== RAILGUN_TOOL.id || !preview || asked) return;
      if (!preview.ok) {
        game.sound.tone("square", 150, 150, 0.07, 0.07);
        return;
      }
      asked = performance.now();
      if (preview.gun === null) send({ k: "gun-new", ...preview.base! });
      else send({ k: "gun-part", id: preview.gun, n: preview.part });
      game.sound.tone("sine", 130, 62, 0.14, 0.5);
      game.sound.tone("sine", 1250, 1500, 0.035, 0.1, 0.02);
    },
  };

  /** The gun whose capsule this player stands beside, if any. */
  function nearCapsule(): Shown | null {
    if (game.player.knockedDown) return null;
    const p = game.player.position;
    for (const s of guns.values()) {
      if (!s.gun.parts.includes(22)) continue;
      const seat = seatOf(s.gun);
      if (Math.hypot(seat.x - p.x, seat.z - p.z) <= RAILGUN.boardReach && Math.abs(p.y - 0.9 - s.gun.y * LEVEL) < 4) return s;
    }
    return null;
  }

  return feature;
}
