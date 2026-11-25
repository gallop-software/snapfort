import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateLathe } from "@babylonjs/core/Meshes/Builders/latheBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import { CELL } from "../../../game/constants";
import { overlaps, solidOf } from "../../../game/keepOut";
import type { PieceSpec } from "../../../game/pieces";
import { outOfReach } from "../../../game/reach";
import { paintMesh } from "../../../render/paint";
import type { DriveInput, PageGame, WorldFeature, WorldTool } from "../../pageDoors";
import {
  arrivalPose,
  boosterPose,
  boxOf,
  CABIN,
  cannotPlace,
  CATCH,
  clear,
  crowded,
  cutsInto,
  DESCENT,
  fits,
  FLIGHT,
  heldBy,
  inTheWay,
  inWorld,
  isBooster,
  isRocket,
  isShip,
  kindOf,
  landedBox,
  mountFoot,
  nameOf,
  needsOf,
  onHull,
  onShip,
  overlap,
  partAt,
  PARTS,
  reachTo,
  SEATS,
  shipPose,
  SIZE,
  STARSHIP,
  towerFoot,
  whole,
  yawOf,
  type Pad,
  type PartKind,
  type Pose,
  type Ship,
  type StarToPage,
  type StarToServer,
} from "../starshipRules";

/**
 * The page's side of the Moon's Starship, copied from the Meadow's (see starshipRules.ts for what it
 * is): draws every launch site, shows where the next part goes while the
 * Starship tool is picked, makes the parts solid, seats whoever rides, flies
 * the rocket (the booster back into the arms, the ship away to another world),
 * and brings in ships arriving from other worlds.
 */

export const STARSHIP_TOOL: WorldTool = {
  id: "starship",
  label: "Starship",
  key: "L",
  icon: '<path d="M8 36V6h6v30M8 13h6M8 21h6M8 29h6M14 17h9"/><path d="M24 34V15c0-4 2-7 3.5-9 1.5 2 3.5 5 3.5 9v19zM21 34h13M24 26l-3 6M31 26l3 6"/>',
};

type RGB = [number, number, number];
const STEEL: RGB = [0.8, 0.82, 0.85];
const SEAM: RGB = [0.56, 0.58, 0.62];
const BLACK: RGB = [0.07, 0.07, 0.08];
const TOWER: RGB = [0.2, 0.21, 0.24];
const GIRDER: RGB = [0.3, 0.32, 0.36];
const GREY: RGB = [0.5, 0.52, 0.55];
const WHITE: RGB = [0.93, 0.94, 0.95];
const GLASS: RGB = [0.14, 0.3, 0.5];

const HULL = SIZE.hull;
/** Where the two catch arms hinge on the tower, in a site's own space (right, up, ahead), and how far they swing open. */
const HINGE = { right: 5.6, ahead: 6.6, open: 0.6 };
/** Turns the half-round of tiles to face away from the tower. */
const TILES = Math.PI;
const REST: Pose = { ahead: 0, up: 0, tilt: 0, burn: 0 };

/** Where the ship's four parts start above its foot, and the booster's above its own. */
const SHIP_FROM = [0, 12, 26, 38];
const fromOf = (n: number) => (isShip(n) ? SHIP_FROM[n - 18]! : isBooster(n) ? (n - 14) * SIZE.boosterSection : 0);

/**
 * One merged mesh for each kind of part, coloured by vertex. Tower parts have
 * their origin at their own foot on the tower's middle line; the mount on the
 * ground under its middle; the arms at their hinges; rocket parts at their own
 * foot on the rocket's middle line. All point along +z (away from the tower).
 */
function partModels(scene: Scene): Record<PartKind, Mesh> {
  const done = (mesh: Mesh, color: RGB, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    return paintMesh(mesh, ...color);
  };
  const box = (w: number, h: number, d: number, color: RGB, x: number, y: number, z: number, turn = 0) => {
    const mesh = CreateBox("s-box", { width: w, height: h, depth: d }, scene);
    mesh.rotation.y = turn;
    return done(mesh, color, x, y, z);
  };
  const tube = (top: number, bottom: number, h: number, color: RGB, x: number, y: number, z: number, sides = 32) =>
    done(CreateCylinder("s-tube", { diameterTop: top, diameterBottom: bottom, height: h, tessellation: sides }, scene), color, x, y, z);
  /** A girder from one point to another. */
  const beam = (a: RGB, b: RGB, thick: number, color: RGB) => {
    const mesh = CreateBox("s-beam", { width: thick, height: thick, depth: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) }, scene);
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    mesh.lookAt(new Vector3(...b));
    return paintMesh(mesh, ...color);
  };
  const merge = (name: string, parts: Mesh[]) => {
    const mesh = Mesh.MergeMeshes(parts, true, true)!;
    mesh.name = name;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    return mesh;
  };
  /** A length of hull, with its weld seams. */
  const hull = (h: number) => [tube(HULL, HULL, h, STEEL, 0, h / 2, 0, 40), ...[0.25, 0.5, 0.75, 0.995].map((k) => tube(HULL + 0.05, HULL + 0.05, 0.14, SEAM, 0, h * k, 0, 40))];
  /** The black heat-shield tiles down one side of the ship (the side away from the tower). */
  const tiles = (h: number) => {
    const mesh = CreateCylinder("s-tiles", { diameter: HULL + 0.1, height: h, tessellation: 40, arc: 0.5, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE }, scene);
    mesh.rotation.y = TILES;
    return done(mesh, BLACK, 0, h / 2, 0);
  };
  /** Engine bells in a ring under a part. */
  const bells = (count: number, ring: number, top: number, bottom: number, h: number) =>
    Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2;
      return tube(top, bottom, h, BLACK, Math.sin(a) * ring, -h / 2 + 0.1, Math.cos(a) * ring, 10);
    });

  // The tower: four columns, cross-braced on every face, with the lift shaft up its middle.
  const H = SIZE.section, c = SIZE.towerWide / 2 - 0.6;
  const tower = merge("star-tower", [
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(1.2, H, 1.2, TOWER, sx * c, H / 2, sz * c))),
    box(2.6, H, 2.6, GIRDER, 0, H / 2, 0),
    ...[-1, 1].flatMap((side) => [
      beam([-c, 0.6, side * c], [c, H - 0.9, side * c], 0.5, GIRDER),
      beam([c, 0.6, side * c], [-c, H - 0.9, side * c], 0.5, GIRDER),
      box(2 * c, 0.7, 0.7, TOWER, 0, H - 0.35, side * c),
      beam([side * c, 0.6, -c], [side * c, H - 0.9, c], 0.5, GIRDER),
      beam([side * c, 0.6, c], [side * c, H - 0.9, -c], 0.5, GIRDER),
      box(0.7, 0.7, 2 * c, TOWER, side * c, H - 0.35, 0),
    ]),
  ]);

  const top = merge("star-top", [
    box(13.5, 0.7, 13.5, TOWER, 0, 0.35, 0),
    box(5, 3.2, 9, GIRDER, 0, 2.3, 1.5),
    box(1.3, 1.3, 13, TOWER, 0, 4.4, 7),
    box(2.2, 1.2, 2.2, GREY, 0, 3.4, 13),
    tube(0.25, 0.5, 11, GREY, -5, 6.2, -5, 8),
  ]);

  // The mount: a ring table on six legs, open down the middle for the flame, over a steel plate.
  const legs = SIZE.deck - 2.6;
  const ring = CreateLathe("s-ring", { shape: [new Vector3(4.9, legs, 0), new Vector3(7.6, legs, 0), new Vector3(7.6, SIZE.deck, 0), new Vector3(4.9, SIZE.deck, 0), new Vector3(4.9, legs, 0)], tessellation: 36, sideOrientation: Mesh.DOUBLESIDE }, scene);
  const mount = merge("star-mount", [
    paintMesh(ring, ...GIRDER),
    ...Array.from({ length: 6 }, (_, i) => {
      const a = ((i + 0.5) / 6) * Math.PI * 2;
      return tube(2.4, 2.8, legs, TOWER, Math.sin(a) * 6.1, legs / 2, Math.cos(a) * 6.1, 14);
    }),
    tube(14, 14.6, 0.5, GREY, 0, 0.25, 0, 30),
    ...Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * Math.PI * 2;
      return box(0.5, 0.9, 0.9, WHITE, Math.sin(a) * 4.75, SIZE.deck - 0.35, Math.cos(a) * 4.75, a);
    }),
  ]);

  /** A catch arm from its hinge, 23 m long; `inner` is the side the rocket is on (1: +x). */
  const arm = (name: string, inner: number) =>
    merge(name, [
      box(2.6, 4.4, 2.6, GIRDER, 0, 0, 0),
      box(1.5, 2.6, 23, TOWER, 0, 0, 11.5),
      box(1.0, 0.25, 22, GREY, 0, 1.42, 11.6),
      box(0.3, 0.9, 11, WHITE, inner * 0.9, 0.6, 14),
      ...[4, 9, 14, 19].map((z) => box(1.7, 2.8, 0.4, GIRDER, 0, 0, z)),
    ]);

  const reach = SIZE.ahead - HULL / 2 - 6;
  const qd = merge("star-qd", [box(2.4, 3, 2, GIRDER, 0, 0, 0.4), box(1.6, 1.8, reach - 0.4, TOWER, 0, 0, reach / 2), box(2.6, 2.6, 0.5, WHITE, 0, 0, reach - 0.3)]);

  // The booster.
  const B = SIZE.boosterSection;
  const quarter = (i: number) => ((i + 0.5) / 4) * Math.PI * 2;
  const engines = merge("star-engines", [
    ...hull(B),
    tube(HULL + 0.12, HULL + 0.12, 1.4, BLACK, 0, 0.7, 0, 40),
    ...bells(3, 0.9, 0.5, 1.3, 1.7),
    ...bells(10, 2.35, 0.5, 1.3, 1.7),
    ...bells(20, 3.85, 0.5, 1.3, 1.7),
    ...[0, 1, 2, 3].map((i) => box(0.5, 11, 1.0, SEAM, Math.sin(quarter(i)) * (HULL / 2 + 0.2), 6.5, Math.cos(quarter(i)) * (HULL / 2 + 0.2), quarter(i))),
  ]);
  const tank = merge("star-tank", hull(B));
  const fins = merge("star-fins", [
    ...hull(B),
    // The ring the ship's engines fire through as it leaves, and the four grid fins.
    tube(HULL + 0.14, HULL + 0.14, 1.7, BLACK, 0, B - 0.85, 0, 40),
    ...[0, 1, 2, 3].map((i) => box(3.0, 0.4, 3.8, TOWER, Math.sin(quarter(i)) * (HULL / 2 + 1.9), B - 4.2, Math.cos(quarter(i)) * (HULL / 2 + 1.9), quarter(i))),
  ]);

  // The ship.
  const [E, T, C, N] = SIZE.ship as [number, number, number, number];
  const flap = (w: number, h: number, y: number) => [-1, 1].map((side) => box(w, h, 0.45, BLACK, side * (HULL / 2 + w / 2 - 0.3), y, 0.6));
  const shipEngines = merge("star-ship-engines", [...hull(E), tiles(E), tube(HULL + 0.14, HULL + 0.14, 1.0, BLACK, 0, 0.5, 0, 40), ...bells(3, 1.0, 0.5, 1.3, 1.6), ...bells(3, 2.9, 0.9, 2.5, 2.3), ...flap(4.2, 9.5, 6)]);
  const shipTank = merge("star-ship-tank", [...hull(T), tiles(T)]);
  const cabin = merge("star-cabin", [
    ...hull(C),
    tiles(C),
    ...[-2, -1, 0, 1, 2].map((i) => {
      const a = Math.PI + i * 0.3;
      return box(1.0, 0.7, 0.14, GLASS, Math.sin(a) * (HULL / 2 + 0.02), 7, Math.cos(a) * (HULL / 2 + 0.02), a);
    }),
  ]);
  const curve = (grow: number) => Array.from({ length: 13 }, (_, i) => new Vector3(Math.max(0.02, (HULL / 2 + grow) * Math.cos((i / 12) * (Math.PI / 2)) ** 0.62), (i / 12) * N, 0));
  const nose = merge("star-nose", [
    paintMesh(CreateLathe("s-nose", { shape: curve(0), tessellation: 40, sideOrientation: Mesh.DOUBLESIDE }, scene), ...STEEL),
    (() => {
      const mesh = CreateLathe("s-nose-tiles", { shape: curve(0.05), tessellation: 40, arc: 0.5, sideOrientation: Mesh.DOUBLESIDE }, scene);
      mesh.rotation.y = TILES;
      return paintMesh(mesh, ...BLACK);
    })(),
    ...flap(3.2, 6.5, 4),
  ]);

  return { tower, top, mount, armA: arm("star-arm-a", 1), armB: arm("star-arm-b", -1), qd, engines, tank, fins, shipEngines, shipTank, cabin, nose };
}

/** Where a part's model goes on a site at rest: its origin in the site's own space (right, up, ahead). */
function originOf(n: number): [number, number, number] {
  const kind = kindOf(n);
  if (kind === "tower") return [0, (n - 1) * SIZE.section, 0];
  if (kind === "top") return [0, 8 * SIZE.section, 0];
  if (kind === "mount") return [0, 0, SIZE.ahead];
  if (kind === "armA") return [-HINGE.right, SIZE.armY, HINGE.ahead];
  if (kind === "armB") return [HINGE.right, SIZE.armY, HINGE.ahead];
  if (kind === "qd") return [0, SIZE.qdY, 6];
  return [0, SIZE.deck + (isShip(n) ? SIZE.booster : 0) + fromOf(n), SIZE.ahead];
}

interface Held {
  mesh: Mesh;
  solid: { node: TransformNode; body: PhysicsBody } | null;
}

interface Shown {
  pad: Pad;
  parts: Map<number, Held>;
  /** The booster and the ship each hang from a node, so they can fly. */
  booster: TransformNode;
  ship: TransformNode;
  flames: { booster: Mesh; ship: Mesh };
  smoke: Mesh[];
  /** How far open the arms are, and how far the fuelling arm has swung away (0 to 1). */
  open: number;
  swung: number;
  /** Whether something is built in the rocket's way, and when that was last looked at. */
  blocked: boolean;
  looked: number;
}

interface Incoming {
  ship: Ship;
  node: TransformNode;
  meshes: Mesh[];
  flame: Mesh;
  /** Landed, it is solid. */
  solid: { node: TransformNode; body: PhysicsBody } | null;
}

interface Blast {
  at: number;
  balls: Mesh[];
  bits: { mesh: Mesh; v: Vector3; from: Vector3; spin: Vector3 }[];
  size: number;
}

export function startStarships(game: PageGame): WorldFeature & { pads: Map<number, Shown>; ships: Map<string, Incoming>; readonly seated: number | null; readonly aboard: string | null; readonly preview: { pad: number | null; part: number; ok: boolean } | null } {
  const { scene } = game;
  const models = partModels(scene);
  const steel = new StandardMaterial("starship", scene);
  steel.specularColor = new Color3(0.28, 0.28, 0.3);
  steel.specularPower = 40;
  // (Seen from far off, and high up: the haze would turn it the colour of the sky.)
  steel.fogEnabled = false;
  const glow = (name: string, r: number, g: number, b: number, alpha: number) => {
    const m = new StandardMaterial(`starship-${name}`, scene);
    m.disableLighting = true;
    m.emissiveColor = new Color3(r, g, b);
    m.alpha = alpha;
    m.fogEnabled = false;
    return m;
  };
  const ghosts = { plan: glow("plan", 0.35, 0.65, 1, 0.13), ok: glow("ok", 0.25, 0.95, 0.55, 0.5), bad: glow("bad", 1, 0.3, 0.25, 0.5) };
  const fire = { outer: glow("fire", 1, 0.55, 0.15, 0.75), inner: glow("fire-core", 1, 0.95, 0.75, 0.9), smoke: glow("smoke", 0.9, 0.88, 0.85, 0.5), dark: glow("soot", 0.2, 0.18, 0.17, 0.6) };
  fire.outer.backFaceCulling = false;

  const pads = new Map<number, Shown>();
  const ships = new Map<string, Incoming>();
  const blasts: Blast[] = [];
  /** The server's clock is this far ahead of this page's (ms). */
  let ahead = 0;
  const serverNow = () => Date.now() + ahead;
  const send = (msg: StarToServer) => game.send(msg);
  let asked = 0;
  let aimed = false;
  let preview: { pad: number | null; part: number; ok: boolean; why?: string; site?: { x: number; z: number; dir: number } } | null = null;
  const planMeshes: Mesh[] = [];
  /** What this player was riding last frame, to notice getting out. */
  let was: { pad: number } | { trip: string } | null = null;
  /** Somewhere to be set down on the next step (out of a seat, or out of a landed ship). */
  let putDown: [number, number, number] | null = null;
  /** The trip this player arrived on from another world, until they are in its ship (or it turns out to be gone). */
  const note = game.arrival() as { trip?: unknown } | null;
  let arriving: { trip: string; since: number } | null = typeof note?.trip === "string" ? { trip: note.trip, since: performance.now() } : null;
  /** Everyone drawn sitting in a ship this frame. */
  let sitting = new Set<string>();

  /**
   * A few words above the hotbar. Taken away only when it was this that put
   * them there (a world may have other things that speak there too).
   */
  let spoke = false;
  const panel = (html: string | null) => {
    if (html === null && !spoke) return;
    spoke = html !== null;
    game.panel(html);
  };

  /** How loud something there is from here: 1 beside it, fading to nothing a kilometre off. */
  const loud = (x: number, y: number, z: number) => {
    const p = game.player.position;
    return Math.max(0, 1 - Math.hypot(p.x - x, p.y - y, p.z - z) / 1000) ** 2;
  };

  /** A flame for under a rocket: a long cone with a bright core, pointing down from its node. */
  function makeFlame(parent: TransformNode, wide: number, long: number): Mesh {
    const outer = CreateCylinder("star-flame", { diameterTop: wide, diameterBottom: wide * 0.25, height: long, tessellation: 16, cap: Mesh.NO_CAP }, scene);
    outer.material = fire.outer;
    const inner = CreateCylinder("star-flame-core", { diameterTop: wide * 0.55, diameterBottom: 0.2, height: long * 0.6, tessellation: 12, cap: Mesh.NO_CAP }, scene);
    inner.material = fire.inner;
    inner.parent = outer;
    inner.position.y = long * 0.2;
    outer.parent = parent;
    for (const m of [outer, inner]) m.isPickable = false;
    outer.metadata = long;
    outer.setEnabled(false);
    return outer;
  }
  function burn(flame: Mesh, amount: number, now: number): void {
    flame.setEnabled(amount > 0);
    if (amount <= 0) return;
    const long = flame.metadata as number;
    const k = amount * (0.9 + 0.1 * Math.sin(now * 0.045) + 0.06 * Math.sin(now * 0.13));
    flame.scaling.set(0.8 + 0.2 * amount, k, 0.8 + 0.2 * amount);
    flame.position.y = -(long * k) / 2 - 0.6;
  }

  function makeShown(pad: Pad): Shown {
    const booster = new TransformNode(`star-booster-${pad.id}`, scene), ship = new TransformNode(`star-ship-${pad.id}`, scene);
    return { pad, parts: new Map(), booster, ship, flames: { booster: makeFlame(booster, 9, 80), ship: makeFlame(ship, 7.5, 50) }, smoke: [], open: 1, swung: 1, blocked: false, looked: 0 };
  }

  function dropHeld(held: Held): void {
    held.solid?.body.dispose();
    held.solid?.node.dispose();
    held.mesh.dispose();
  }

  /** Makes what is drawn of a site match what the server says is on it. */
  function show(pad: Pad): Shown {
    let s = pads.get(pad.id);
    if (!s) pads.set(pad.id, (s = makeShown(pad)));
    s.pad = pad;
    for (const [n, held] of s.parts) {
      if (pad.parts.includes(n)) continue;
      dropHeld(held);
      s.parts.delete(n);
    }
    for (const n of pad.parts) {
      if (s.parts.has(n)) continue;
      const mesh = models[kindOf(n)].clone(`star-${pad.id}-${n}`);
      mesh.setEnabled(true);
      mesh.material = steel;
      mesh.receiveShadows = true;
      game.shadows.addShadowCaster(mesh);
      if (isRocket(n)) {
        mesh.parent = isShip(n) ? s.ship : s.booster;
        mesh.position.set(0, fromOf(n), 0);
      } else {
        const o = originOf(n);
        mesh.position.set(...inWorld(pad, ...o));
        mesh.rotation.y = yawOf(pad);
      }
      s.parts.set(n, { mesh, solid: null });
    }
    solidify(s);
    s.looked = 0;
    return s;
  }

  /** Solid where it stands: builders bump into every part, and crosshairs land on them. A rocket in the air is not. */
  function solidify(s: Shown): void {
    for (const [n, held] of s.parts) {
      const want = !(isRocket(n) && s.pad.flight);
      if (want === (held.solid !== null)) continue;
      if (!want) {
        held.solid!.body.dispose();
        held.solid!.node.dispose();
        held.solid = null;
        continue;
      }
      const b = boxOf(s.pad, n);
      const node = new TransformNode(`star-solid-${s.pad.id}-${n}`, scene);
      node.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      node.rotationQuaternion = Quaternion.Identity();
      const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
      body.shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(b[3] - b[0], b[4] - b[1], b[5] - b[2]), scene);
      body.disableSync = true;
      held.solid = { node, body };
    }
  }

  function forget(id: number): void {
    const s = pads.get(id);
    if (!s) return;
    for (const held of s.parts.values()) dropHeld(held);
    for (const m of s.smoke) m.dispose();
    s.flames.booster.dispose();
    s.flames.ship.dispose();
    s.booster.dispose();
    s.ship.dispose();
    pads.delete(id);
  }

  function showShip(ship: Ship): void {
    let s = ships.get(ship.trip);
    if (!s) {
      const node = new TransformNode(`star-in-${ship.trip}`, scene);
      const meshes = [18, 19, 20, 21].map((n) => {
        const mesh = models[kindOf(n)].clone(`star-in-${n}`);
        mesh.setEnabled(true);
        mesh.material = steel;
        mesh.parent = node;
        mesh.position.set(0, fromOf(n), 0);
        return mesh;
      });
      ships.set(ship.trip, (s = { ship, node, meshes, flame: makeFlame(node, 7.5, 50), solid: null }));
    }
    s.ship = ship;
    // Landed: builders bump into it, and crosshairs (the Remove tool's, a trebuchet's) land on it.
    if (ship.down && !s.solid) {
      const b = landedBox(ship);
      const at = new TransformNode(`star-in-solid-${ship.trip}`, scene);
      at.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      at.rotationQuaternion = Quaternion.Identity();
      const body = new PhysicsBody(at, PhysicsMotionType.STATIC, false, scene);
      body.shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(b[3] - b[0], b[4] - b[1], b[5] - b[2]), scene);
      body.disableSync = true;
      s.solid = { node: at, body };
    }
  }

  function forgetShip(trip: string): void {
    const s = ships.get(trip);
    if (!s) return;
    for (const m of s.meshes) m.dispose();
    s.flame.dispose();
    s.node.dispose();
    s.solid?.body.dispose();
    s.solid?.node.dispose();
    ships.delete(trip);
  }

  /** A fireball, and bits flying out of it. */
  function boom(at: [number, number, number], size: number): void {
    const balls = [fire.inner, fire.outer, fire.dark].map((material, i) => {
      const mesh = CreateSphere("star-boom", { diameter: 1, segments: 12 }, scene);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.position.set(at[0] + (i - 1) * size * 0.08, at[1] + i * size * 0.06, at[2] + (1 - i) * size * 0.05);
      return mesh;
    });
    const bits = Array.from({ length: 14 }, (_, i) => {
      const mesh = CreateBox("star-bit", { width: 2 + (i % 3) * 1.5, height: 0.3, depth: 3 + (i % 4) }, scene);
      mesh.material = steel;
      mesh.isPickable = false;
      const a = i * 2.4, up = 0.2 + ((i * 7) % 10) / 12;
      return { mesh, from: new Vector3(...at), v: new Vector3(Math.sin(a) * 30 * (1 - up * 0.5), 10 + up * 45, Math.cos(a) * 30 * (1 - up * 0.5)), spin: new Vector3(1 + (i % 3), 0.7 * (i % 4), 2 - (i % 5) * 0.6) };
    });
    blasts.push({ at: performance.now(), balls, bits, size });
    const near = loud(...at);
    game.sound.noise(2.6, 0.9 * near, 900);
    game.sound.tone("sine", 70, 22, 2.2, 0.8 * near);
    game.sound.tone("sawtooth", 160, 30, 0.7, 0.3 * near);
  }

  /** The seat a rider sits in: round the cabin, facing out. */
  function seatAt(centre: [number, number, number], i: number): { x: number; y: number; z: number; yaw: number; pitch: number; roll: number } {
    const a = (i / SEATS) * Math.PI * 2;
    return { x: centre[0] + Math.sin(a) * 2.6, y: centre[1], z: centre[2] + Math.cos(a) * 2.6, yaw: a, pitch: 0, roll: 0 };
  }

  const timeOf = (pad: Pad) => (pad.flight ? (serverNow() - pad.flight.at) / 1000 : 0);
  /** The middle of the cabin of a site's ship, wherever it is now. */
  const cabinOf = (pad: Pad) => onHull(pad, pad.flight ? shipPose(timeOf(pad)) : REST, SIZE.deck + SIZE.booster, CABIN);
  const cabinOfShip = (ship: Ship) => onShip(ship, arrivalPose((serverNow() - ship.at) / 1000), CABIN);

  const mine = () => {
    const me = game.myId();
    if (!me) return null;
    for (const s of pads.values()) if (s.pad.riders.includes(me)) return s;
    return null;
  };
  const myShip = () => {
    const me = game.myId();
    if (!me) return null;
    for (const s of ships.values()) if (!s.ship.down && s.ship.riders.includes(me)) return s;
    return null;
  };

  /** Where the rocket goes, when there is somewhere. */
  const destination = () => game.worlds()[0] ?? null;
  const fuelling = (pad: Pad) => Math.max(0, Math.ceil((pad.readyAt - serverNow()) / 1000));

  /** A line about a site for the panel. */
  function statusOf(s: Shown): string {
    const pad = s.pad;
    const to = destination();
    if (pad.flight) {
      const t = timeOf(pad);
      if (t < FLIGHT.hold) return `<b class="ok">Engines lit</b>`;
      if (pad.flight.ship) return `<b class="ok">Lift-off${to ? ` · to the ${to.name}` : ""}</b>`;
      return pad.flight.booster ? `<b>Booster coming back · ${Math.max(0, Math.ceil(CATCH - t))} s</b>` : `<b class="bad">Booster lost</b>`;
    }
    if (pad.count) return `<b class="ok">Lift-off in ${Math.max(0, Math.ceil(FLIGHT.count - (serverNow() - pad.count) / 1000))}</b><small>${pad.riders.filter((r) => r !== null).length} of ${SEATS} seats taken</small>`;
    if (pad.parts.length < PARTS) return `<b>Starship · ${pad.parts.length} of ${PARTS} parts</b>`;
    const way = s.blocked ? `<small class="bad">Something is built in its way: it will hit it</small>` : "";
    const wait = fuelling(pad);
    return (wait > 0 ? `<b>Starship fuelling · ${wait} s</b>` : `<b class="ok">Starship ready${to ? ` · to the ${to.name}` : ""}</b>`) + way;
  }

  /** The site this player stands at the foot of (near enough to ride the lift), if any. */
  function nearLift(): Shown | null {
    if (game.player.knockedDown) return null;
    const p = game.player.position;
    for (const s of pads.values()) {
      if (!s.pad.parts.includes(20) || s.pad.flight || p.y > 12) continue;
      const a = towerFoot(s.pad), b = mountFoot(s.pad);
      if (Math.min(Math.hypot(p.x - a[0], p.z - a[2]), Math.hypot(p.x - b[0], p.z - b[2])) <= STARSHIP.boardReach) return s;
    }
    return null;
  }

  /** The site nearest a spot (by its tower or its mount), within `reach` metres. */
  function nearestPad(x: number, z: number, reach: number): Shown | null {
    let best: Shown | null = null;
    let bestDist = reach;
    for (const s of pads.values()) {
      const a = towerFoot(s.pad), b = mountFoot(s.pad);
      const d = Math.min(Math.hypot(x - a[0], z - a[2]), Math.hypot(x - b[0], z - b[2]));
      if (d < bestDist) [best, bestDist] = [s, d];
    }
    return best;
  }

  /** Draws a part's model as a ghost where it would stand. */
  function ghost(index: number, site: Pick<Pad, "x" | "z" | "dir">, n: number, material: StandardMaterial, swell = 1): void {
    let mesh = planMeshes[index];
    const kind = kindOf(n);
    if (!mesh || mesh.metadata !== kind) {
      mesh?.dispose();
      mesh = models[kind].clone("star-plan");
      mesh.metadata = kind;
      // (One plain colour: the tower's own is too dark to show through.)
      mesh.useVertexColors = false;
      planMeshes[index] = mesh;
    }
    mesh.setEnabled(true);
    mesh.material = material;
    mesh.scaling.setAll(swell);
    mesh.position.set(...inWorld(site, ...originOf(n)));
    mesh.rotation.y = yawOf(site);
  }

  /** The spot under the crosshair within the Remove tool's reach, a little into whatever is there. */
  function underCrosshair(): [number, number, number] | null {
    const spot = game.aim(STARSHIP.removeReach);
    if (!spot) return null;
    const yaw = game.viewYaw(), pitch = game.viewPitch();
    return [spot[0] + Math.sin(yaw) * Math.cos(pitch) * 0.2, spot[1] - Math.sin(pitch) * 0.2, spot[2] + Math.cos(yaw) * Math.cos(pitch) * 0.2];
  }

  /** The landed ship under the crosshair, for the Remove tool. */
  function shipUnderCrosshair(): Incoming | null {
    const at = underCrosshair();
    if (!at) return null;
    for (const s of ships.values()) {
      if (!s.ship.down) continue;
      const b = landedBox(s.ship);
      if (at[0] >= b[0] - 0.3 && at[0] <= b[3] + 0.3 && at[1] >= b[1] - 0.3 && at[1] <= b[4] + 0.3 && at[2] >= b[2] - 0.3 && at[2] <= b[5] + 0.3) return s;
    }
    return null;
  }

  /** The part of a site under the crosshair, for the Remove tool. */
  function partUnderCrosshair(): { s: Shown; n: number } | null {
    const into = underCrosshair();
    if (!into) return null;
    for (const s of pads.values()) {
      const standing = { ...s.pad, parts: s.pad.parts.filter((n) => !(isRocket(n) && s.pad.flight)) };
      const n = partAt(standing, ...into, 0.3);
      if (n !== null) return { s, n };
    }
    return null;
  }

  /** Puts a site's flying things where the clock says they are, and everything that moves with them. */
  function place(s: Shown, dt: number, now: number): void {
    const pad = s.pad;
    const yaw = yawOf(pad);
    const t = timeOf(pad);
    const f = pad.flight;
    const bp = f?.booster ? boosterPose(t) : REST, sp = f?.ship ? shipPose(t) : REST;
    s.booster.position.set(...inWorld(pad, 0, SIZE.deck + bp.up, SIZE.ahead + bp.ahead));
    s.booster.rotation.set(bp.tilt, yaw, 0);
    s.ship.position.set(...inWorld(pad, 0, SIZE.deck + SIZE.booster + sp.up, SIZE.ahead + sp.ahead));
    s.ship.rotation.set(sp.tilt, yaw, 0);
    burn(s.flames.booster, pad.parts.some(isBooster) ? bp.burn : 0, now);
    burn(s.flames.ship, pad.parts.some(isShip) ? sp.burn : 0, now);

    // The arms open for the countdown and close on the booster as it comes back; the fuelling arm swings clear.
    const wantOpen = f ? (t > CATCH - 1.3 ? 0 : 1) : pad.count || !pad.parts.includes(17) ? 1 : 0;
    const wantSwung = f || pad.count || !pad.parts.includes(18) ? 1 : 0;
    s.open += (wantOpen - s.open) * Math.min(1, dt * 2.5);
    s.swung += (wantSwung - s.swung) * Math.min(1, dt * 2);
    const a = s.parts.get(11)?.mesh, b = s.parts.get(12)?.mesh, q = s.parts.get(13)?.mesh;
    if (a) a.rotation.y = yaw - s.open * HINGE.open;
    if (b) b.rotation.y = yaw + s.open * HINGE.open;
    if (q) q.rotation.y = yaw + s.swung * 1.25;

    // Smoke rolling out from under the mount as it lifts off: each puff's place is worked out from the clock.
    const smoking = f !== null && t < 16;
    if (smoking && s.smoke.length === 0) {
      for (let i = 0; i < 26; i++) {
        const mesh = CreateSphere("star-smoke", { diameter: 1, segments: 8 }, scene);
        mesh.material = fire.smoke;
        mesh.isPickable = false;
        s.smoke.push(mesh);
      }
    } else if (!smoking && s.smoke.length > 0) {
      for (const m of s.smoke) m.dispose();
      s.smoke = [];
    }
    if (smoking) {
      const foot = mountFoot(pad);
      s.smoke.forEach((mesh, i) => {
        const age = t - i * 0.28;
        mesh.setEnabled(age > 0 && age < 9);
        if (age <= 0 || age >= 9) return;
        const dir = i * 2.4, out = 7 + 26 * (1 - Math.exp(-age * 0.45));
        mesh.position.set(foot[0] + Math.sin(dir) * out, 3 + age * 2.2, foot[2] + Math.cos(dir) * out);
        mesh.scaling.setAll(9 + age * 4.5);
        mesh.visibility = 0.9 * (1 - age / 9);
      });
    }
  }

  const feature = {
    pads,
    ships,
    get seated() {
      return mine()?.pad.id ?? null;
    },
    get aboard() {
      return myShip()?.ship.trip ?? null;
    },
    get preview() {
      return preview;
    },

    joined() {
      for (const id of [...pads.keys()]) forget(id);
      for (const trip of [...ships.keys()]) forgetShip(trip);
      for (const id of sitting) game.ride(id, null);
      sitting = new Set();
    },

    message(data: unknown) {
      const msg = data as StarToPage;
      if (msg.k === "pads") {
        ahead = msg.now - Date.now();
        for (const pad of msg.pads) show(pad);
        for (const ship of msg.ships) showShip(ship);
        // Arrived from another world on one of these: aboard it, or (already landed) beside it.
        if (arriving) {
          const s = ships.get(arriving.trip);
          if (s && !s.ship.down) send({ k: "ship-aboard", trip: arriving.trip });
          else {
            if (s) putDown = [s.ship.x + 9, 0.95, s.ship.z];
            arriving = null;
          }
        }
      } else if (msg.k === "pad") {
        ahead = msg.now - Date.now();
        asked = 0;
        const before = pads.get(msg.pad.id)?.pad;
        const s = show(msg.pad);
        const at = mountFoot(msg.pad);
        const near = loud(at[0], 40, at[2]);
        if (before && before.parts.length < PARTS && msg.pad.parts.length === PARTS) {
          game.toast("The Starship is whole: fuelling", 3500);
          game.sound.tone("sine", 220, 660, 0.8, 0.12);
        }
        if (!before?.count && msg.pad.count) game.sound.tone("square", 660, 660, 0.25, 0.1 * near);
        if (!before?.flight && msg.pad.flight) {
          // The engines light: a roar that goes on and on.
          game.sound.noise(16, 0.8 * near, 260);
          game.sound.noise(6, 0.5 * near, 1400);
          game.sound.tone("sawtooth", 38, 60, 14, 0.35 * near);
        }
        if (before?.flight?.booster && !msg.pad.flight && msg.pad.parts.includes(14)) {
          // Caught.
          game.sound.tone("square", 90, 60, 0.3, 0.3 * near);
          game.sound.noise(0.5, 0.3 * near, 500);
          if (near > 0.3) game.toast("The booster is back in the arms", 3000);
        }
        s.looked = 0;
      } else if (msg.k === "pad-gone") forget(msg.id);
      else if (msg.k === "boom") boom(msg.at, msg.size);
      else if (msg.k === "ship") {
        ahead = msg.now - Date.now();
        showShip(msg.ship);
        if (arriving?.trip === msg.ship.trip && msg.ship.riders.includes(game.myId())) {
          // Aboard: looking down at where it is going to land.
          arriving = null;
          game.look(0.5);
        }
      } else if (msg.k === "ship-gone") forgetShip(msg.trip);
      else if (msg.k === "ship-go") {
        // The ship is leaving this world with this player in it: their page follows it.
        game.travel(msg.to, { trip: msg.trip });
      } else if (msg.k === "pad-no") {
        asked = 0;
        const why: Record<string, string> = {
          have: "That part is already on",
          needs: "Another part has to go on before that one",
          away: "Not while the rocket is counting down or away",
          room: "No room: the whole site must fit inside the building area",
          far: `Too far: build up beside where it goes, to within ${STARSHIP.placeReach} m`,
          locked: "Starships come with the Full Game",
          full: "This world has as many launch sites as it can hold",
          overlap: "Another launch site is in the way",
          crowded: "Something is built where it goes: remove it first",
          holds: "Take off what stands on it or hangs from it first",
          busy: "Every seat is taken",
          fuelling: "Still fuelling",
          broken: "The Starship is not whole",
          counting: "The countdown is running",
          nowhere: "There is nowhere to fly to yet",
        };
        game.toast(why[msg.why] ?? "Not now");
        game.sound.tone("square", 150, 150, 0.07, 0.07);
      }
    },

    /** In a seat, the ship carries the player; getting out sets them down. */
    drive(_dt: number, _input: DriveInput): boolean {
      if (putDown) {
        game.player.seat(...putDown);
        putDown = null;
        return true;
      }
      if (game.player.knockedDown) return false;
      const s = mine(), incoming = myShip();
      if (!s && !incoming) return false;
      const c = s ? cabinOf(s.pad) : cabinOfShip(incoming!.ship);
      game.player.seat(c[0], Math.min(1490, c[1] + 0.9), c[2]);
      return true;
    },

    update(dt: number) {
      const now = performance.now();
      const me = game.myId();
      for (const s of pads.values()) {
        place(s, dt, now);
        // Whether anything is built in the rocket's way, looked at now and then.
        if (now - s.looked > 1000) {
          s.looked = now;
          s.blocked = s.pad.parts.some(isRocket) && !s.pad.flight && inTheWay(game.build, s.pad) !== null;
        }
      }
      for (const s of ships.values()) {
        const t = (serverNow() - s.ship.at) / 1000;
        const pose = arrivalPose(t);
        s.node.setEnabled(t >= 0 || s.ship.riders.includes(me));
        s.node.position.set(s.ship.x, pose.up, s.ship.z);
        s.node.rotation.set(pose.tilt, 0, 0);
        burn(s.flame, t < DESCENT ? pose.burn : 0, now);
      }

      // Everyone sitting in a ship is drawn in their seat.
      const seen = new Set<string>();
      for (const s of pads.values()) {
        const c = cabinOf(s.pad);
        s.pad.riders.forEach((id, i) => {
          if (id === null || (id === me && game.player.knockedDown)) return;
          game.ride(id, seatAt(c, i));
          seen.add(id);
        });
      }
      for (const s of ships.values()) {
        if (s.ship.down) continue;
        const c = cabinOfShip(s.ship);
        s.ship.riders.forEach((id, i) => {
          if (id === me && game.player.knockedDown) return;
          game.ride(id, seatAt(c, i));
          seen.add(id);
        });
      }
      for (const id of sitting) if (!seen.has(id)) game.ride(id, null);
      sitting = seen;

      // This player: the camera pulls back to take in the rocket while they ride, and getting out sets them down.
      const s = game.player.knockedDown ? null : mine(), incoming = game.player.knockedDown ? null : myShip();
      const riding = s ? { pad: s.pad.id } : incoming ? { trip: incoming.ship.trip } : null;
      if (riding) game.chase(s ? (s.pad.flight ? 120 : 85) : 95);
      else if (was) {
        game.chase(null);
        if (!game.player.knockedDown) {
          if ("pad" in was) {
            // Down the lift, out beside the tower.
            const pad = pads.get(was.pad)?.pad;
            if (pad && !pad.flight) putDown = inWorld(pad, 11, 0.95, -3);
          } else {
            const ship = ships.get(was.trip)?.ship;
            if (ship?.down) {
              putDown = [ship.x + 9, 0.95, ship.z];
              game.toast("Touchdown", 2500);
              game.sound.tone("sine", 110, 50, 0.3, 0.35);
            }
          }
        }
      }
      was = riding;
      // The ship this player came on never showed up (it blew up on the way, say): they are simply here.
      if (arriving && now - arriving.since > 25_000) arriving = null;

      // Fireballs and the bits that fly out of them.
      for (let i = blasts.length - 1; i >= 0; i--) {
        const b = blasts[i]!;
        const t = (now - b.at) / 1000;
        if (t > 5) {
          for (const m of b.balls) m.dispose();
          for (const bit of b.bits) bit.mesh.dispose();
          blasts.splice(i, 1);
          continue;
        }
        b.balls.forEach((mesh, k) => {
          const life = 1.6 + k * 1.1;
          mesh.setEnabled(t < life);
          mesh.scaling.setAll(b.size * (0.25 + 0.75 * (1 - Math.exp(-t * (3.2 - k * 0.7)))) * (0.75 + k * 0.2));
          mesh.visibility = Math.max(0, 1 - t / life);
        });
        for (const bit of b.bits) {
          bit.mesh.position.set(bit.from.x + bit.v.x * t, Math.max(0.2, bit.from.y + bit.v.y * t - 13 * t * t), bit.from.z + bit.v.z * t);
          bit.mesh.rotation.set(bit.spin.x * t, bit.spin.y * t, bit.spin.z * t);
          bit.mesh.visibility = Math.max(0, 1 - t / 5);
        }
      }

      // The plan and the panel show only while the Starship tool is being aimed, in a seat, or at the foot of the lift.
      if (!aimed) {
        for (const m of planMeshes) m.setEnabled(false);
        preview = null;
        if (incoming) panel(`<b>Coming in to land</b><small>${Math.max(0, Math.ceil(DESCENT - (serverNow() - incoming.ship.at) / 1000))} s</small>`);
        else {
          const at = s ?? nearLift();
          const ready = s && whole(s.pad) && !s.pad.count && fuelling(s.pad) === 0;
          panel(at ? statusOf(at) + (ready ? `<small>${game.touch ? "Tap Place" : "Click"} to start the countdown</small>` : "") : null);
        }
      }
      aimed = false;
      if (asked && now - asked > 2500) asked = 0;
    },

    board(): boolean {
      if (myShip()) return true;
      const s = mine();
      if (s) {
        if (s.pad.flight) game.toast("No getting out now");
        else send({ k: "pad-sit", id: s.pad.id, on: false });
        return true;
      }
      const at = nearLift();
      if (!at) return false;
      // Visiting: riding comes with building here. (Not ours to take: the game then offers it.)
      if (!game.mayBuild()) return false;
      if (at.pad.riders.every((r) => r !== null)) game.toast("Every seat is taken");
      else if (!asked) {
        asked = performance.now();
        send({ k: "pad-sit", id: at.pad.id, on: true });
        game.sound.tone("sine", 300, 620, 0.12, 0.14);
      }
      return true;
    },

    prompt() {
      if (myShip()) return null;
      const s = mine();
      if (s) return s.pad.flight ? null : { text: "<kbd>H</kbd> ride the lift back down", button: "Get out" };
      const at = nearLift();
      if (!at || at.pad.riders.every((r) => r !== null)) return null;
      return { text: "<kbd>H</kbd> ride the lift up to the ship", button: "Get in" };
    },

    busy() {
      return !game.player.knockedDown && (mine() !== null || myShip() !== null);
    },

    /** In a seat, a click starts the countdown. */
    act() {
      const s = mine();
      if (!s || s.pad.flight) return;
      if (s.pad.count) return game.toast("The countdown is running");
      if (!whole(s.pad)) return game.toast(`Not finished: ${s.pad.parts.length} of ${PARTS} parts`);
      const wait = fuelling(s.pad);
      if (wait > 0) return game.toast(`Still fuelling: ${wait} s`);
      const to = destination();
      if (!to) return game.toast("There is nowhere to fly to yet");
      send({ k: "pad-launch", to: to.id });
    },

    /** The Starship tool is picked: show the plan of the site being aimed at and the part that would go on, or where a new one would start. */
    aimTool(id: string) {
      if (id !== STARSHIP_TOOL.id) return;
      aimed = true;
      const p = game.player.position;
      const yaw = game.viewYaw();
      const spot = game.aim(STARSHIP.placeReach) ?? [p.x + Math.sin(yaw) * 12, 0, p.z + Math.cos(yaw) * 12];
      let used = 0;
      const tap = game.touch ? "tap Place" : "click";
      // A site being aimed at, or stood beside.
      const s = nearestPad(spot[0], spot[2], 22) ?? nearestPad(p.x, p.z, 30);
      if (s && s.pad.parts.length < PARTS) {
        const pad = s.pad;
        const missing = Array.from({ length: PARTS }, (_, i) => i + 1).filter((n) => !pad.parts.includes(n));
        const can = missing.filter((n) => cannotPlace(pad, n) === null);
        // Of the parts that can go on now: one on the side being aimed at (the tower's, or the rocket's), the lowest number first.
        const a = towerFoot(pad), b = mountFoot(pad);
        const rocketSide = Math.hypot(spot[0] - b[0], spot[2] - b[2]) < Math.hypot(spot[0] - a[0], spot[2] - a[2]);
        // Failing that, the next part of that side, to say what it waits for (aiming at the mount: the rocket needs both arms first).
        const onSide = (n: number) => (n === 10 || isRocket(n)) === rocketSide;
        const pick = can.find(onSide) ?? missing.find(onSide) ?? can[0] ?? missing[0]!;
        // (As near as for a wall, in height too: the tower and the rocket are climbed with scaffolding as they go up.)
        const away = reachTo(pad, pick, [p.x, p.y, p.z]);
        const why = cannotPlace(pad, pick) ?? (crowded(game.build, pad, pick, game.env) ? "crowded" : away > STARSHIP.placeReach ? "far" : null);
        for (const n of missing) if (n !== pick) ghost(used++, pad, n, ghosts.plan);
        ghost(used++, pad, pick, why ? ghosts.bad : ghosts.ok);
        const lacks = needsOf(pick).filter((n) => !pad.parts.includes(n));
        const reason = why === "needs" ? `put on ${lacks.map((n) => `${n} · ${nameOf(n)}`).join(" and ")} first` : why === "away" ? "not while the rocket is counting down or away" : why === "crowded" ? "something is built where it goes: remove it first" : why === "far" ? outOfReach([boxOf(pad, pick)], [p.x, p.y, p.z], STARSHIP.placeReach) : "";
        preview = { pad: pad.id, part: pick, ok: why === null, why: `${pick} · ${nameOf(pick)}: ${reason}` };
        panel(`${statusOf(s)}<small>${why ? `<span class="bad">${pick} · ${nameOf(pick)}: ${reason}</span>` : `<span class="ok">${pick} · ${nameOf(pick)}</span> · ${tap} to put it on`}</small>`);
      } else if (s) {
        preview = null;
        panel(statusOf(s) + `<small>Finished. Ride the lift up from the foot of the tower</small>`);
      } else {
        // A new site: its tower here, the mount the way the player faces; the whole of it shown, to see that it fits.
        const dir = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
        const site = { x: Math.floor(spot[0] / CELL), z: Math.floor(spot[2] / CELL), dir };
        const clash = [...pads.values()].some((other) => overlap(other.pad, site));
        const problem = !fits(site) ? "no room: the tower and the mount must fit inside the building area" : clash ? "another launch site is in the way" : !clear(game.build, site) ? "something is built in the way" : reachTo(site, 1, [p.x, p.y, p.z]) > STARSHIP.placeReach ? outOfReach([boxOf(site, 1)], [p.x, p.y, p.z], STARSHIP.placeReach) : null;
        for (let n = 2; n <= PARTS; n++) ghost(used++, site, n, ghosts.plan);
        ghost(used++, site, 1, problem ? ghosts.bad : ghosts.ok);
        preview = { pad: null, part: 1, ok: problem === null, why: problem ?? "", site };
        panel(`<b>New Starship launch site</b><small>${problem ? `<span class="bad">${problem}</span>` : `<span class="ok">1 · ${nameOf(1)}</span> · ${tap} to start the tower here, the rocket this way`}</small>`);
      }
      for (let i = used; i < planMeshes.length; i++) planMeshes[i]!.setEnabled(false);
    },

    /** Nothing can be built into any part of a launch site. */
    blocks(spec: PieceSpec): boolean {
      if (pads.size === 0 && ships.size === 0) return false;
      const box = solidOf(spec, game.env);
      for (const s of pads.values()) if (cutsInto(s.pad, box)) return true;
      for (const s of ships.values()) if (s.ship.down && overlaps(landedBox(s.ship), box, 0.2)) return true;
      return false;
    },

    /** The Remove tool is on a part of a launch site: show which, in red. */
    aimRemove() {
      const found = partUnderCrosshair();
      const landed = found ? null : shipUnderCrosshair();
      if (landed) {
        // A landed ship: all of it in red.
        aimed = true;
        [18, 19, 20, 21].forEach((n, i) => {
          ghost(i, { x: 0, z: 0, dir: 0 }, n, ghosts.bad, 1.02);
          planMeshes[i]!.position.set(landed.ship.x, landed.node.position.y + fromOf(n), landed.ship.z);
        });
        for (let i = 4; i < planMeshes.length; i++) planMeshes[i]!.setEnabled(false);
        panel(`<b>Landed ship</b><small><span class="bad">${game.touch ? "Tap Remove" : "Click"}</span> to take it away</small>`);
        return;
      }
      if (!found) return;
      aimed = true;
      ghost(0, found.s.pad, found.n, ghosts.bad, 1.02);
      for (let i = 1; i < planMeshes.length; i++) planMeshes[i]!.setEnabled(false);
      const held = heldBy(found.n).filter((n) => found.s.pad.parts.includes(n));
      panel(`${statusOf(found.s)}<small><span class="bad">${found.n} · ${nameOf(found.n)}</span> · ${held.length > 0 ? `take off ${Math.max(...held)} · ${nameOf(Math.max(...held))} first` : `${game.touch ? "tap Remove" : "click"} to take it off`}</small>`);
    },

    /** Remove was used on a part of a launch site: ask for it to come off. */
    remove(): boolean {
      const found = partUnderCrosshair();
      const landed = found ? null : shipUnderCrosshair();
      if (landed) {
        if (!game.mayBuild()) return false;
        send({ k: "ship-take", trip: landed.ship.trip });
        game.sound.noise(0.25, 0.2, 500);
        return true;
      }
      if (!found) return false;
      if (!game.mayBuild()) return false;
      send({ k: "pad-take", id: found.s.pad.id, n: found.n });
      return true;
    },

    useTool(id: string) {
      if (id !== STARSHIP_TOOL.id || !preview || asked) return;
      if (!preview.ok) {
        // A click that does nothing says why.
        if (preview.why) game.toast(preview.why[0]!.toUpperCase() + preview.why.slice(1), 3500);
        game.sound.tone("square", 150, 150, 0.07, 0.07);
        return;
      }
      asked = performance.now();
      if (preview.pad === null) send({ k: "pad-new", ...preview.site! });
      else send({ k: "pad-part", id: preview.pad, n: preview.part });
      game.sound.tone("sine", 130, 62, 0.14, 0.5);
      game.sound.tone("sine", 1250, 1500, 0.035, 0.1, 0.02);
    },
  };

  return feature;
}
