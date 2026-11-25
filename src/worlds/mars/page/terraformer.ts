import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import { CELL } from "../../../game/constants";
import { solidOf, type Box } from "../../../game/keepOut";
import type { PieceSpec } from "../../../game/pieces";
import { outOfReach } from "../../../game/reach";
import { paintMesh } from "../../../render/paint";
import type { PageGame, WorldFeature, WorldTool } from "../../pageDoors";
import { airAt, boxOf, builtInto, cannotPlace, canTake, cutsInto, fits, heldBy, localBox, nameOf, needsOf, nextPart, partAt, PARTS, reachTo, readAir, readTerraformer, running, SIZE, TALL, TERRAFORMER, THIN, type Air, type TerraToPage, type TerraToServer, type Terraformer } from "../terraformerRules";
import { sky } from "./air";

/**
 * The page's side of Mars's Terraformer (see ../terraformerRules.ts for what
 * it is): draws every part in place, makes them solid, shows where the next
 * part goes when the Terraformer tool is picked and puts it on (or mends a
 * broken one) at a click, lets the Remove tool take parts off from the top
 * down, and keeps the page's idea of the air (./air.ts) up to date.
 */

export const TERRAFORMER_TOOL: WorldTool = {
  id: "terraformer",
  label: "Terraformer",
  key: "N",
  icon: '<path d="M5 34h30M9 34V20h6v14M25 34V20h6v14M17 34V9h6v25M15 9h10"/><path d="M20 6c-2-3 2-3 0-5"/>',
};

type RGB = [number, number, number];
const SAND: RGB = [0.82, 0.72, 0.58];
const WHITE: RGB = [0.93, 0.92, 0.88];
const STEEL: RGB = [0.62, 0.64, 0.68];
const DARK: RGB = [0.26, 0.24, 0.25];
const RUST: RGB = [0.62, 0.3, 0.2];
const RED: RGB = [0.8, 0.22, 0.16];

interface Shown {
  terra: Terraformer;
  root: TransformNode;
  parts: Map<number, { mesh: Mesh; body: PhysicsBody; node: TransformNode }>;
  /** What only shows while it runs: lit windows, the lamp on top. */
  lights: Mesh;
}

export interface TerraformerFeature extends WorldFeature {
  /** Every Terraformer the page knows of (for the checks that drive it). */
  terras: Map<number, Shown>;
  /** The air as the server last said it is going. */
  air(): Air;
}

export function startTerraformers(game: PageGame): TerraformerFeature {
  const { scene } = game;
  const send = (msg: TerraToServer) => game.send(msg);

  const paint = new StandardMaterial("terra", scene);
  paint.specularColor = new Color3(0.14, 0.14, 0.14);
  // A broken part: scorched, with fire still in it (it pulses: see update).
  const charred = new StandardMaterial("terra-broken", scene);
  charred.diffuseColor = new Color3(0.2, 0.17, 0.16);
  charred.specularColor = Color3.Black();
  const lit = new StandardMaterial("terra-lit", scene);
  lit.disableLighting = true;
  lit.diffuseColor = Color3.Black();
  lit.emissiveColor = new Color3(1, 0.74, 0.3);
  const steam = new StandardMaterial("terra-plume", scene);
  steam.disableLighting = true;
  steam.diffuseColor = Color3.Black();
  steam.emissiveColor = new Color3(0.93, 0.9, 0.86);
  steam.alpha = 0.34;
  steam.fogEnabled = false;
  const ghostMaterial = (name: string, r: number, g: number, b: number, alpha: number) => {
    const m = new StandardMaterial(`terra-ghost-${name}`, scene);
    m.disableLighting = true;
    m.emissiveColor = new Color3(r, g, b);
    m.diffuseColor = Color3.Black();
    m.alpha = alpha;
    m.backFaceCulling = false;
    m.fogEnabled = false;
    return m;
  };
  const ghosts = { plan: ghostMaterial("plan", 0.35, 0.65, 1, 0.1), ok: ghostMaterial("ok", 0.25, 0.95, 0.55, 0.45), bad: ghostMaterial("bad", 1, 0.3, 0.25, 0.45) };

  // ── Drawing a part: shapes fitted to the space the rules give it, from the machine's corner ──
  const block = (b: Box, color: RGB, inset = 0) => {
    const m = CreateBox("t", { width: b[3] - b[0] - inset * 2, height: b[4] - b[1], depth: b[5] - b[2] - inset * 2 }, scene);
    m.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    return paintMesh(m, ...color);
  };
  const drum = (b: Box, color: RGB, top = 1, bottom = 1, sides = 20) => {
    const wide = b[3] - b[0];
    const m = CreateCylinder("t", { diameterTop: wide * top, diameterBottom: wide * bottom, height: b[4] - b[1], tessellation: sides }, scene);
    m.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    return paintMesh(m, ...color);
  };
  /** A slice of a box between two heights (fractions of its own), grown or shrunk sideways. */
  const band = (b: Box, lo: number, hi: number, grow: number): Box => [b[0] - grow, b[1] + (b[4] - b[1]) * lo, b[2] - grow, b[3] + grow, b[1] + (b[4] - b[1]) * hi, b[5] + grow];

  function drawPart(n: number): Mesh {
    const b = localBox(n);
    const name = nameOf(n);
    const bits: Mesh[] = [];
    if (n === 1) {
      // The slab, a darker kerb round it, and hazard stripes at the corners.
      bits.push(block(band(b, 0, 0.8, 0), SAND), block(band(b, 0.8, 1, -0.6), STEEL));
      for (const [x, z] of [[0, 0], [38, 0], [0, 38], [38, 38]] as const) bits.push(block([x, 0, z, x + 2, 1.56, z + 2], RED));
    } else if (name.startsWith("Intake tower")) {
      bits.push(block(b, WHITE, 0.4));
      // Louvres: dark slots up every face.
      for (let k = 0; k < 7; k++) bits.push(block(band(b, 0.1 + k * 0.12, 0.16 + k * 0.12, -0.25), DARK));
      bits.push(block(band(b, 0, 0.05, 0), STEEL), block(band(b, 0.96, 1, 0), STEEL));
    } else if (name === "Reactor") {
      bits.push(drum(b, STEEL));
      for (const at of [0.08, 0.5, 0.92]) bits.push(drum(band(b, at - 0.03, at + 0.03, 0.4), DARK));
      bits.push(drum(band(b, 0.6, 0.78, 0.08), RUST));
    } else if (name === "Control house") {
      bits.push(block(b, SAND), block(band(b, 0.5, 0.75, 0.06), DARK), block(band(b, 0.94, 1, 0.3), STEEL));
    } else if (name === "Feed hopper") {
      bits.push(block(band(b, 0.45, 1, 0), RUST));
      const funnel = drum(band(b, 0, 0.45, 0), STEEL, 1, 0.3, 4);
      funnel.rotation.y = Math.PI / 4;
      bits.push(funnel, block(band(b, 0.93, 1, 0.25), DARK));
    } else if (name.startsWith("Duct")) {
      bits.push(block(b, STEEL), block(band(b, 0.4, 0.6, 0.15), DARK));
    } else if (name.startsWith("Intake fan")) {
      bits.push(drum(band(b, 0, 0.7, -0.6), DARK), drum(band(b, 0.7, 1, -1.4), STEEL));
      // The blades, seen from above.
      for (let k = 0; k < 3; k++) {
        const blade = block([b[0] + 1, b[1] + 3.3, (b[2] + b[5]) / 2 - 0.5, b[3] - 1, b[1] + 3.6, (b[2] + b[5]) / 2 + 0.5], WHITE);
        blade.rotation.y = (k * Math.PI) / 3;
        bits.push(blade);
      }
    } else if (name === "Reactor dome") {
      bits.push(drum(band(b, 0, 0.55, 0), STEEL), drum(band(b, 0.55, 1, 0), WHITE, 0.45, 1));
      bits.push(drum(band(b, 0.5, 0.58, 0.4), DARK));
    } else if (name === "Furnace collar") {
      bits.push(drum(b, RUST, 0.55, 0.86), drum(band(b, 0, 0.14, 0), DARK, 0.86, 0.9));
    } else if (name.startsWith("Stack")) {
      // A chimney: white, with a red band on every other length.
      bits.push(drum(b, n % 2 === 0 ? WHITE : RED, 1, 1, 16), drum(band(b, 0.94, 1, 0.35), DARK, 1, 1, 16));
      // A ladder up one side.
      bits.push(block([b[3] - 0.1, b[1], (b[2] + b[5]) / 2 - 0.4, b[3] + 0.25, b[4], (b[2] + b[5]) / 2 + 0.4], DARK));
    } else if (name === "Crown") {
      bits.push(drum(b, DARK, 1, 0.72, 16), drum(band(b, 0.82, 1, 0.5), STEEL, 1, 1, 16));
    } else {
      // The igniter: a mast and its lamp housing.
      bits.push(drum(band(b, 0, 0.7, -1.4), STEEL, 1, 1, 8), drum(band(b, 0.7, 1, -0.6), DARK, 1, 1, 8));
    }
    const mesh = Mesh.MergeMeshes(bits, true, true)!;
    mesh.name = `terra-part-${n}`;
    mesh.material = paint;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    return mesh;
  }
  const models = new Map<number, Mesh>();
  const modelOf = (n: number) => models.get(n) ?? models.set(n, drawPart(n)).get(n)!;

  /** What is lit while it runs: the control house's window, a ring of glow round the reactor, the lamp on top. */
  function drawLights(): Mesh {
    const glow = (b: Box, round = false) => {
      const m = round ? CreateCylinder("t", { diameter: b[3] - b[0], height: b[4] - b[1], tessellation: 20 }, scene) : CreateBox("t", { width: b[3] - b[0], height: b[4] - b[1], depth: b[5] - b[2] }, scene);
      m.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      return m;
    };
    const lamp = CreateSphere("t", { diameter: 3.4, segments: 10 }, scene);
    lamp.position.set(20, TALL + 0.6, 20);
    const mesh = Mesh.MergeMeshes([glow(band(localBox(7), 0.52, 0.73, 0.1)), glow(band(localBox(6), 0.62, 0.76, 0.12), true), glow(band(localBox(18), 0.3, 0.5, 0.05), true), lamp], true)!;
    mesh.material = lit;
    mesh.isPickable = false;
    return mesh;
  }

  // The plume from the crown while it runs: puffs that rise, swell and thin out. Shared by all (there is one machine).
  const puffs: Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const puff = CreateSphere("terra-puff", { diameter: 1, segments: 6 }, scene);
    puff.material = steam;
    puff.isPickable = false;
    puff.setEnabled(false);
    puffs.push(puff);
  }

  // ── What the page knows ──
  const terras = new Map<number, Shown>();
  let air: Air = { ...THIN };
  /** The server's clock, ms ahead of this page's. */
  let ahead = 0;
  const serverNow = () => Date.now() + ahead;

  function share(): void {
    sky.solids = [...terras.values()].flatMap((s) => s.terra.parts.map((n) => boxOf(s.terra, n)));
    const any = [...terras.values()][0];
    sky.source = any ? { x: any.terra.x * CELL + 20, z: any.terra.z * CELL + 20 } : null;
  }

  function show(terra: Terraformer): void {
    let s = terras.get(terra.id);
    if (!s) {
      const root = new TransformNode(`terra-${terra.id}`, scene);
      root.position.set(terra.x * CELL, 0, terra.z * CELL);
      const lights = drawLights();
      lights.parent = root;
      s = { terra, root, parts: new Map(), lights };
      terras.set(terra.id, s);
    }
    s.terra = terra;
    for (const [n, part] of s.parts) {
      if (terra.parts.includes(n)) continue;
      part.mesh.dispose();
      part.body.dispose();
      part.node.dispose();
      s.parts.delete(n);
    }
    for (const n of terra.parts) {
      let part = s.parts.get(n);
      if (!part) {
        const mesh = modelOf(n).clone(`terra-${terra.id}-${n}`);
        mesh.setEnabled(true);
        mesh.parent = s.root;
        mesh.receiveShadows = true;
        game.shadows.addShadowCaster(mesh);
        // Solid: builders cannot walk through it (and can stand on it), and crosshairs land on it.
        const b = boxOf(terra, n);
        const node = new TransformNode(`terra-solid-${terra.id}-${n}`, scene);
        node.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
        node.rotationQuaternion = Quaternion.Identity();
        const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
        body.shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(b[3] - b[0], b[4] - b[1], b[5] - b[2]), scene);
        body.disableSync = true;
        part = { mesh, body, node };
        s.parts.set(n, part);
      }
      part.mesh.material = terra.broken.includes(n) ? charred : paint;
    }
    s.lights.setEnabled(running(terra));
    share();
  }

  function forget(id: number): void {
    const s = terras.get(id);
    if (!s) return;
    for (const part of s.parts.values()) {
      part.mesh.dispose();
      part.body.dispose();
      part.node.dispose();
    }
    s.lights.dispose();
    s.root.dispose();
    terras.delete(id);
    share();
  }

  // ── Showing where things go ──
  const planBoxes: Mesh[] = [];
  let used = 0;
  let aimed = false;
  function ghost(b: Box, material: StandardMaterial, grow = 0): void {
    let mesh = planBoxes[used];
    if (!mesh) {
      mesh = CreateBox("terra-plan", { size: 1 }, scene);
      mesh.isPickable = false;
      planBoxes[used] = mesh;
    }
    used++;
    mesh.setEnabled(true);
    mesh.material = material;
    mesh.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    mesh.scaling.set(b[3] - b[0] + grow, b[4] - b[1] + grow, b[5] - b[2] + grow);
  }
  const hideUnused = () => { for (let i = used; i < planBoxes.length; i++) planBoxes[i]!.setEnabled(false); };

  /** What a click with the tool would do now, as worked out by the last `aimTool`. */
  let preview: { ask: TerraToServer | null; why: string } | null = null;
  /** When something was last asked of the server (ms), so a held button does not ask twice. */
  let asked = 0;
  const percent = () => Math.round(sky.air * 100);
  const airWords = () => (sky.to > sky.air + 0.001 ? `the air is thickening: ${percent()}%` : sky.to < sky.air - 0.001 ? `the air is thinning: ${percent()}%` : sky.air > 0.99 ? "the air is thick" : "the air is thin");
  const statusOf = (t: Terraformer) => `<b>Terraformer</b> · ${running(t) ? `running · ${airWords()}` : t.broken.length > 0 ? `stopped: ${t.broken.length} broken ${t.broken.length === 1 ? "part" : "parts"} · ${airWords()}` : `${t.parts.length} of ${PARTS} parts`}`;
  const click = () => (game.touch ? "tap Place" : "click");

  function partUnderCrosshair(): { s: Shown; n: number } | null {
    const spot = game.aim(TERRAFORMER.removeReach);
    if (!spot) return null;
    // (A little into what was hit, so a spot on a part's face counts as that part.)
    const yaw = game.viewYaw(), pitch = game.viewPitch();
    const into: [number, number, number] = [spot[0] + Math.sin(yaw) * Math.cos(pitch) * 0.3, spot[1] - Math.sin(pitch) * 0.3, spot[2] + Math.cos(yaw) * Math.cos(pitch) * 0.3];
    for (const s of terras.values()) {
      const n = partAt(s.terra, into);
      if (n !== null) return { s, n };
    }
    return null;
  }

  // For pictures and checks on a developer's own computer only: `?air=0.8` holds this page's air there.
  // (Never on the live site: wings are flown by the page, so it would let anyone fly on red Mars.)
  const asked_ = location.hostname === "localhost" ? Number(new URLSearchParams(location.search).get("air") ?? NaN) : NaN;
  const heldAir = Number.isFinite(asked_) ? Math.max(0, Math.min(1, asked_)) : null;

  let clock = 0;
  return {
    terras,
    air: () => air,

    message(data) {
      const msg = data as TerraToPage;
      if (typeof msg !== "object" || msg === null) return;
      if (msg.k === "terras") {
        for (const id of [...terras.keys()]) forget(id);
        ahead = msg.now - Date.now();
        air = readAir(msg.air);
        for (const raw of Array.isArray(msg.list) ? msg.list : []) {
          const t = readTerraformer(raw);
          if (t) show(t);
        }
      } else if (msg.k === "terra") {
        const t = readTerraformer(msg.terra);
        if (!t) return;
        ahead = msg.now - Date.now();
        const before = terras.get(t.id)?.terra;
        show(t);
        asked = 0;
        if (msg.hit?.length) {
          game.sound.noise(0.5, 0.3, 500);
          game.sound.tone("sawtooth", 180, 50, 0.5, 0.2);
        } else if (before && t.parts.length > before.parts.length) {
          game.sound.tone("sine", 130, 62, 0.14, 0.4);
        }
      } else if (msg.k === "terra-gone") {
        forget(msg.id);
      } else if (msg.k === "air") {
        ahead = msg.now - Date.now();
        const was = air.to;
        air = readAir(msg.air);
        if (air.to > was) game.toast("The Terraformer is running: the air is thickening. Wings will carry you soon", 5000);
        else if (air.to < was) game.toast("The Terraformer has stopped: the air is thinning", 5000);
      } else if (msg.k === "terra-no") {
        asked = 0;
        const why = { have: "That part is already on", needs: "Another part has to go on first", crowded: "Something is built where it goes: remove it first", room: "No room: all 40 m of it must fit inside the building area", far: `Too far: get within ${TERRAFORMER.placeReach} m of where it goes`, locked: "Building here comes with the Full Game", full: "Mars has its Terraformer already: add to that one", overlap: "Another Terraformer is in the way", held: "Something stands on that part: take that off first" }[msg.why];
        if (why) game.toast(why, 3500);
      }
    },

    joined() {
      for (const id of [...terras.keys()]) forget(id);
      air = { ...THIN };
    },

    update(dt) {
      clock += dt;
      sky.air = heldAir ?? airAt(air, serverNow());
      sky.to = air.to;
      // Fire in what is broken.
      const flicker = 0.35 + 0.25 * Math.sin(clock * 9) + 0.15 * Math.sin(clock * 23);
      charred.emissiveColor.set(0.9 * flicker, 0.3 * flicker, 0.05 * flicker);
      lit.emissiveColor.set(1, 0.72 + 0.06 * Math.sin(clock * 3), 0.3);
      // The plume.
      const live = [...terras.values()].find((s) => running(s.terra));
      for (let i = 0; i < puffs.length; i++) {
        const puff = puffs[i]!;
        puff.setEnabled(!!live);
        if (!live) continue;
        const k = (clock / 9 + i / puffs.length) % 1;
        puff.position.set(live.terra.x * CELL + 20 + Math.sin(i * 2.4 + k * 3) * 6 * k + k * k * 30, TALL - 4 + k * 150, live.terra.z * CELL + 20 + Math.cos(i * 1.7 + k * 2) * 6 * k);
        puff.scaling.setAll(9 + k * 46);
        puff.visibility = Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) * (1 - k);
      }
      if (!aimed) {
        if (used > 0) {
          used = 0;
          hideUnused();
          game.panel(null);
        }
        preview = null;
      }
      aimed = false;
      if (asked && performance.now() - asked > 1500) asked = 0;
    },

    /** The Terraformer tool is picked: show the next part (or the broken one to mend), or where a new machine would stand. */
    aimTool(id: string) {
      if (id !== TERRAFORMER_TOOL.id) return;
      aimed = true;
      used = 0;
      const p = game.player.position;
      const me: [number, number, number] = [p.x, p.y, p.z];
      const s = [...terras.values()][0];
      if (s) {
        const t = s.terra;
        // Mend first: the broken part nearest to hand. Then the next part of the kit.
        const mend = [...t.broken].sort((a, b) => reachTo(t, a, me) - reachTo(t, b, me))[0];
        const n = mend ?? nextPart(t);
        if (n === undefined || n === null) {
          preview = null;
          game.panel(`${statusOf(t)}<small>Whole. Keep it from being hit: a broken part stops it</small>`);
        } else {
          const far = reachTo(t, n, me) > TERRAFORMER.placeReach;
          const problem = mend !== undefined ? null : cannotPlace(game.build, t, n);
          const why = problem === "needs" ? `put on ${needsOf(n).filter((m) => !t.parts.includes(m)).map((m) => `${m} · ${nameOf(m)}`).join(" and ")} first` : problem === "crowded" ? "something is built where it goes: remove it first" : problem ? "it cannot go there" : far ? outOfReach([boxOf(t, n)], me, TERRAFORMER.placeReach) : null;
          if (mend === undefined) for (let m = n + 1; m <= PARTS; m++) ghost(boxOf(t, m), ghosts.plan);
          ghost(boxOf(t, n), why ? ghosts.bad : ghosts.ok, mend !== undefined ? 0.3 : 0);
          const label = `${n} · ${nameOf(n)}`;
          preview = { ask: why ? null : mend !== undefined ? { k: "terra-mend", id: t.id, n } : { k: "terra-part", id: t.id, n }, why: why ? `${label}: ${why}` : "" };
          game.panel(`${statusOf(t)}<small>${why ? `<span class="bad">${label}: ${why}</span>` : `<span class="ok">${label}</span> · ${click()} to ${mend !== undefined ? "mend it" : "put it on"}`}</small>`);
        }
      } else {
        // A new one: centred on the spot aimed at; the whole of it shown, to see that it fits.
        const yaw = game.viewYaw();
        const spot = game.aim(60) ?? [p.x + Math.sin(yaw) * 24, 0, p.z + Math.cos(yaw) * 24];
        const site = { x: Math.floor(spot[0] / CELL) - SIZE / 2, z: Math.floor(spot[2] / CELL) - SIZE / 2 };
        const problem = !fits(site) ? "no room: all 40 m of it must fit inside the building area" : builtInto(game.build, site, 1) ? "something is built in the way: it needs 40 m of clear ground" : reachTo(site, 1, me) > TERRAFORMER.placeReach ? outOfReach([boxOf(site, 1)], me, TERRAFORMER.placeReach) : null;
        for (let n = 2; n <= PARTS; n++) ghost(boxOf(site, n), ghosts.plan);
        ghost(boxOf(site, 1), problem ? ghosts.bad : ghosts.ok);
        preview = { ask: problem ? null : { k: "terra-new", ...site }, why: problem ?? "" };
        game.panel(`<b>New Terraformer</b> · ${PARTS} parts, ${TALL} m tall<small>${problem ? `<span class="bad">${problem}</span>` : `<span class="ok">1 · Foundation</span> · ${click()} to start it here. Whole, it thickens the air of all Mars`}</small>`);
      }
      hideUnused();
    },

    useTool(id: string) {
      if (id !== TERRAFORMER_TOOL.id || !preview || asked) return;
      if (!preview.ask) {
        // A click that does nothing says why.
        if (preview.why) game.toast(preview.why[0]!.toUpperCase() + preview.why.slice(1), 3500);
        game.sound.tone("square", 150, 150, 0.07, 0.07);
        return;
      }
      if (!game.mayBuild()) return;
      asked = performance.now();
      send(preview.ask);
      game.sound.tone("sine", 1250, 1500, 0.035, 0.1, 0.02);
    },

    /** Nothing can be built into any part of a Terraformer. */
    blocks(spec: PieceSpec): boolean {
      if (terras.size === 0) return false;
      const box = solidOf(spec, game.env);
      for (const s of terras.values()) if (cutsInto(s.terra, box)) return true;
      return false;
    },

    /** The Remove tool is on a part: show it in red, and say whether it can come off. */
    aimRemove() {
      const found = partUnderCrosshair();
      if (!found) return;
      aimed = true;
      used = 0;
      const { s, n } = found;
      ghost(boxOf(s.terra, n), ghosts.bad, 0.3);
      hideUnused();
      const on = heldBy(n).filter((m) => s.terra.parts.includes(m));
      game.panel(`${statusOf(s.terra)}<small><span class="bad">${n} · ${nameOf(n)}</span> · ${canTake(s.terra, n) ? `${game.touch ? "tap Remove" : "click"} to take it off` : `take off ${on.map((m) => `${m} · ${nameOf(m)}`).join(" and ")} first`}</small>`);
    },

    remove(): boolean {
      const found = partUnderCrosshair();
      if (!found) return false;
      if (!game.mayBuild()) return false;
      send({ k: "terra-take", id: found.s.terra.id, n: found.n });
      return true;
    },
  };
}
