import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CELL, WORLD_HALF_CELLS } from "../../../game/constants";
import { paintMesh } from "../../../render/paint";
import type { DriveInput, PageGame, WorldFeature } from "../../pageDoors";
import { ceilingIn, climbIn, enduranceIn, HELI, seatOf, speedIn, type HeliPose, type HeliToPage, type HeliToServer } from "../helicopterRules";
import { sky } from "./air";
import { ceilingOver, inWall, surfaceUnder } from "./solid";

const EDGE = WORLD_HALF_CELLS * CELL + 6;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface Shown {
  root: TransformNode;
  rotors: [Mesh, Mesh];
  pose: HeliPose;
  /** Where it is going (someone else flies it). */
  target: HeliPose;
  riders: [string | null, string | null];
  charge: number;
  /** How fast the rotors turn, 0..1. */
  spin: number;
  falling: { from: HeliPose; to: HeliPose; since: number; seconds: number; arc: number } | null;
}

export interface HelicopterFeature extends WorldFeature {
  helis: Map<number, Shown>;
  /** The one this player is in, or null; and which seat. */
  readonly mine: number | null;
  readonly seat: number;
}

/**
 * The page's side of Mars's helicopters (see ../helicopterRules.ts): draws
 * them, lets a builder get in (the first in flies it, the second rides), and
 * flies the one this player pilots: it turns to where they look, the move
 * keys carry it, the jump key climbs and the run key descends, and with
 * neither it hovers. How fast, how high and how long all depend on the air.
 */
export function startHelicopters(game: PageGame): HelicopterFeature {
  const { scene } = game;
  const send = (msg: HeliToServer) => game.send(msg);

  // ── The model: one to copy. Nose toward +z, skids on the ground at y = 0. ──
  const body = new StandardMaterial("heli", scene);
  body.specularColor = new Color3(0.2, 0.2, 0.2);
  const glass = new StandardMaterial("heli-glass", scene);
  glass.diffuseColor = new Color3(0.5, 0.68, 0.8);
  glass.specularColor = new Color3(0.9, 0.9, 0.9);
  glass.alpha = 0.5;
  const blade = new StandardMaterial("heli-blade", scene);
  blade.diffuseColor = new Color3(0.14, 0.14, 0.16);
  blade.specularColor = Color3.Black();
  blade.backFaceCulling = false;
  const at = <T extends Mesh>(mesh: T, x: number, y: number, z: number, rx = 0, rz = 0): T => {
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.rotation.z = rz;
    return mesh;
  };
  const WHITE: [number, number, number] = [0.94, 0.93, 0.9], ORANGE: [number, number, number] = [0.9, 0.5, 0.2], DARK: [number, number, number] = [0.22, 0.21, 0.23], GOLD: [number, number, number] = [0.85, 0.66, 0.25];
  const hullParts: Mesh[] = [
    // The cabin floor and back, the battery box under it (gold foil), the tail boom and its fin.
    paintMesh(at(CreateBox("h", { width: 1.9, height: 0.25, depth: 2.3 }, scene), 0, 0.72, 0.35), ...WHITE),
    paintMesh(at(CreateBox("h", { width: 1.9, height: 1.5, depth: 0.2 }, scene), 0, 1.45, -0.75), ...WHITE),
    paintMesh(at(CreateBox("h", { width: 1.5, height: 0.42, depth: 1.6 }, scene), 0, 0.42, 0.1), ...GOLD),
    paintMesh(at(CreateCylinder("h", { diameterTop: 0.16, diameterBottom: 0.42, height: 4.2, tessellation: 8 }, scene), 0, 1.5, -2.9, -Math.PI / 2), ...ORANGE),
    paintMesh(at(CreateBox("h", { width: 0.08, height: 1.3, depth: 0.8 }, scene), 0, 1.9, -4.7), ...ORANGE),
    paintMesh(at(CreateBox("h", { width: 1.6, height: 0.06, depth: 0.5 }, scene), 0, 1.5, -4.6), ...WHITE),
    // The roof, and the mast the two rotors turn on.
    paintMesh(at(CreateBox("h", { width: 1.9, height: 0.16, depth: 1.6 }, scene), 0, 2.22, -0.05), ...ORANGE),
    paintMesh(at(CreateCylinder("h", { diameter: 0.22, height: 1.5, tessellation: 8 }, scene), 0, 3.0, 0), ...DARK),
    paintMesh(at(CreateCylinder("h", { diameter: 0.5, height: 0.2, tessellation: 10 }, scene), 0, 2.4, 0), ...DARK),
  ];
  for (const side of [-1, 1]) {
    // Skids, and their struts.
    hullParts.push(paintMesh(at(CreateCylinder("h", { diameter: 0.1, height: 3, tessellation: 6 }, scene), side * 1.05, 0.05, 0.2, Math.PI / 2), ...DARK));
    for (const z of [-0.6, 0.9]) hullParts.push(paintMesh(at(CreateCylinder("h", { diameter: 0.07, height: 0.75, tessellation: 6 }, scene), side * 0.98, 0.38, z, 0, side * -0.25), ...DARK));
  }
  const hull = Mesh.MergeMeshes(hullParts, true, true)!;
  hull.material = body;
  const bubble = CreateSphere("heli-bubble", { diameter: 2.1, segments: 12, slice: 0.62 }, scene);
  bubble.material = glass;
  at(bubble, 0, 1.45, 0.55, Math.PI / 2);
  bubble.scaling.set(0.9, 0.95, 0.72);
  /** One rotor: two long, slender blades. (Thin air needs a great sweep of blade to lift anything.) */
  const makeRotor = () => {
    const blades: Mesh[] = [];
    for (const a of [0, Math.PI]) {
      const b = CreateBox("h", { width: HELI.rotor / 2, height: 0.04, depth: 0.34 }, scene);
      b.position.set((Math.cos(a) * HELI.rotor) / 4, 0, 0);
      b.rotation.z = a === 0 ? 0.03 : -0.03;
      blades.push(b);
    }
    blades.push(CreateCylinder("h", { diameter: 0.34, height: 0.14, tessellation: 10 }, scene));
    const rotor = Mesh.MergeMeshes(blades, true)!;
    rotor.material = blade;
    return rotor;
  };
  const master = new TransformNode("heli-master", scene);
  for (const m of [hull, bubble]) {
    m.parent = master;
    m.isPickable = false;
  }
  const rotorMaster = makeRotor();
  rotorMaster.isPickable = false;
  rotorMaster.setEnabled(false);
  master.setEnabled(false);

  const helis = new Map<number, Shown>();
  let mine: number | null = null;
  let seat = 0;
  /** Which helicopter this player has asked to get in, and when. */
  let asked: { id: number; at: number } | null = null;
  /** The pilot's own flight: how fast it is going each way, and when the server was last told. */
  let v = { x: 0, y: 0, z: 0 };
  let told = 0, flat = false, hum = 0;

  function place(h: Shown): void {
    h.root.position.set(h.pose[0], h.pose[1], h.pose[2]);
    h.root.rotation.set(h.pose[4], h.pose[3], h.pose[5]);
  }

  function show(id: number, pose: HeliPose): Shown {
    let h = helis.get(id);
    if (!h) {
      const root = master.clone(`heli-${id}`, null)!;
      root.setEnabled(true);
      for (const m of root.getChildMeshes()) {
        m.receiveShadows = true;
        game.shadows.addShadowCaster(m);
      }
      const rotors = [0, 1].map((i) => {
        const r = rotorMaster.clone(`heli-rotor-${id}-${i}`);
        r.setEnabled(true);
        r.parent = root;
        r.position.set(0, 3.25 + i * 0.5, 0);
        r.rotation.y = i * 0.9;
        return r;
      }) as [Mesh, Mesh];
      h = { root, rotors, pose: [...pose], target: [...pose], riders: [null, null], charge: 1, spin: 0, falling: null };
      helis.set(id, h);
      place(h);
    }
    h.target = [...pose];
    return h;
  }

  function letGo(): void {
    if (mine === null) return;
    game.ride(game.myId(), null);
    game.chase(null);
    game.panel(null);
    mine = null;
    v = { x: 0, y: 0, z: 0 };
  }

  /** The helicopter within reach of the player, nearest first. */
  function nearest(): { id: number; h: Shown } | null {
    if (game.player.knockedDown) return null;
    const p = game.player.position;
    let best: { id: number; h: Shown } | null = null;
    let bestDist: number = HELI.boardReach;
    for (const [id, h] of helis) {
      if (h.falling) continue;
      const d = Math.hypot(h.pose[0] - p.x, h.pose[2] - p.z);
      if (d <= bestDist && Math.abs(p.y - 0.9 - h.pose[1]) < 3.5) {
        best = { id, h };
        bestDist = d;
      }
    }
    return best;
  }

  const groundAt = (pose: HeliPose) => surfaceUnder(game, pose[0], pose[1], pose[2]);
  const percent = (k: number) => `${Math.round(k * 100)}%`;

  const feature = {
    // Every helicopter but the one this builder is in is solid to them: its hull (the rotors are let through).
    *bodies() {
      for (const [id, h] of helis) {
        if (id === mine || h.falling) continue;
        yield { x: h.pose[0], y: h.pose[1], z: h.pose[2], yaw: h.pose[3], w: 2.6, h: 3.2, d: 6.5 };
      }
    },
    helis,
    get mine() {
      return mine;
    },
    get seat() {
      return seat;
    },

    joined() {
      letGo();
      asked = null;
    },

    message(data: unknown) {
      const msg = data as HeliToPage;
      if (typeof msg !== "object" || msg === null) return;
      if (msg.k === "heli-all") {
        for (const [id, pose, riders, charge] of msg.list) {
          const h = show(id, pose);
          h.pose = [...pose];
          h.riders = [...riders];
          h.charge = charge;
          h.falling = null;
          place(h);
        }
      } else if (msg.k === "heli-poses") {
        for (const [id, pose] of msg.list) if (!(id === mine && seat === 0)) show(id, pose);
      } else if (msg.k === "heli-riders") {
        const h = show(msg.id, msg.pose);
        const was = h.riders;
        // Landed, or sent home: there at once, not sliding across Mars.
        if (h.falling || Math.hypot(h.pose[0] - msg.pose[0], h.pose[1] - msg.pose[1], h.pose[2] - msg.pose[2]) > 40) h.pose = [...msg.pose];
        h.falling = null;
        h.riders = [...msg.riders];
        // (The pilot's own page knows the battery better than the server's last word.)
        if (!(mine === msg.id && seat === 0 && msg.riders[0] === game.myId())) h.charge = msg.charge;
        for (const id of was) if (id && id !== game.myId() && !msg.riders.includes(id)) game.ride(id, null);
        if (asked?.id === msg.id) asked = null;
        const me = msg.riders.indexOf(game.myId());
        if (me >= 0) {
          if (mine !== msg.id) {
            game.sound.tone("sine", 300, 620, 0.12, 0.14);
            game.chase(15);
          }
          mine = msg.id;
          seat = me;
        } else if (mine === msg.id) {
          letGo();
        }
      } else if (msg.k === "heli-fall") {
        const h = show(msg.id, msg.to);
        for (const id of h.riders) if (id && id !== game.myId()) game.ride(id, null);
        h.riders = [null, null];
        if (mine === msg.id) letGo();
        const from: HeliPose = Math.hypot(h.pose[0] - msg.from[0], h.pose[1] - msg.from[1], h.pose[2] - msg.from[2]) < 25 ? [...h.pose] : [...msg.from];
        h.falling = { from, to: [...msg.to], since: performance.now(), seconds: msg.seconds, arc: msg.arc };
      } else if (msg.k === "heli-no") {
        asked = null;
        game.toast(msg.why === "full" ? "That helicopter is full" : "Get closer to the helicopter");
      }
    },

    /** The pilot flies it; the passenger is carried. */
    drive(dt: number, input: DriveInput): boolean {
      const h = mine === null ? undefined : helis.get(mine);
      if (!h) return false;
      if (seat === 0) {
        const air = sky.air;
        const ground = groundAt(h.pose);
        const up = h.pose[1] - ground;
        const flying = up > 0.15;
        // The battery: it runs down in the air and fills on the ground.
        h.charge = flying ? Math.max(0, h.charge - dt / enduranceIn(air)) : Math.min(1, h.charge + dt / HELI.recharge);
        const power = h.charge > 0;
        if (!power && !flat && flying) game.toast("Battery flat: coming down. It recharges on the ground", 4000);
        flat = !power;
        // It turns to where the pilot looks.
        h.pose[3] = wrap(h.pose[3] + wrap(input.yaw - h.pose[3]) * Math.min(1, dt * 2.6));
        const s = Math.sin(h.pose[3]), c = Math.cos(h.pose[3]);
        const top = speedIn(air) * (power ? 1 : 0.35);
        // Across the ground only once it is off it.
        const wantX = flying ? (s * input.forward + c * input.strafe * 0.6) * top : 0;
        const wantZ = flying ? (c * input.forward - s * input.strafe * 0.6) * top : 0;
        const ceiling = ceilingIn(air);
        let wantY = !power ? (flying ? -HELI.flatSink : 0) : input.jump ? climbIn(air) : input.run ? -HELI.descend : 0;
        // Near its ceiling the air will not hold it: the climb fades, and above it, it sinks back.
        if (wantY > 0) wantY *= Math.max(0, Math.min(1, (ceiling - h.pose[1]) / 12));
        if (h.pose[1] > ceiling) wantY = Math.min(wantY, -(h.pose[1] - ceiling) * 0.4 - 0.5);
        const ease = 1 - Math.exp(-dt * 1.8);
        v.x += (wantX - v.x) * ease;
        v.z += (wantZ - v.z) * ease;
        v.y += (wantY - v.y) * (1 - Math.exp(-dt * 3));
        const nx = Math.max(-EDGE, Math.min(EDGE, h.pose[0] + v.x * dt)), nz = Math.max(-EDGE, Math.min(EDGE, h.pose[2] + v.z * dt));
        // Its body: the cabin round its middle, and its tail boom behind (the rotors are let through). Each checked whole, as drawn.
        const back = (x: number, z: number): [number, number] => [x - s * 3.2, z - c * 3.2];
        const [tx, tz] = back(nx, nz);
        if (inWall(game, nx, h.pose[1], nz, 3.2, HELI.radius) || inWall(game, tx, h.pose[1] + 1.2, tz, 1.4, 0.6)) {
          v.x = v.z = 0;
        } else {
          h.pose[0] = nx;
          h.pose[2] = nz;
        }
        const under = groundAt(h.pose);
        // Climbing into the underside of a floor or a roof over it: it stops there.
        let ny = h.pose[1] + v.y * dt;
        if (v.y > 0) {
          const over = ceilingOver(game, h.pose[0], h.pose[1] + 3.2, h.pose[2], HELI.radius * 0.8) - 3.2;
          if (ny > over) {
            ny = Math.max(h.pose[1], over);
            v.y = 0;
          }
        }
        h.pose[1] = Math.max(under, ny);
        if (h.pose[1] <= under + 1e-6 && v.y < 0) v.y = 0;
        // Nose down as it goes forward, banked into a sideways slide.
        const ahead = (v.x * s + v.z * c) / Math.max(1, top), across = (v.x * c - v.z * s) / Math.max(1, top);
        h.pose[4] += (ahead * 0.28 - h.pose[4]) * Math.min(1, dt * 4);
        h.pose[5] += (-across * 0.3 - h.pose[5]) * Math.min(1, dt * 4);
        place(h);
        const now = performance.now();
        if (now - told > 100) {
          told = now;
          send({ k: "heli-fly", pose: h.pose, charge: h.charge });
        }
        game.panel(`<b>Helicopter</b> · battery ${percent(h.charge)} · ${Math.round(Math.max(0, h.pose[1]))} m up<small>${!power ? `<span class="bad">Battery flat</span> · it fills on the ground` : `Flies as high as ${Math.round(ceiling)} m and for ${Math.round(enduranceIn(air))} s in this air · <kbd>Space</kbd> up · <kbd>Shift</kbd> down`}</small>`);
      }
      const sit = seatOf(h.pose, seat);
      game.ride(game.myId(), sit);
      game.player.seat(sit.x, sit.y + 0.9, sit.z);
      return true;
    },

    update(dt: number) {
      // Thrown out (a missile landed by it): the server has already taken this player's seat.
      if (mine !== null && game.player.knockedDown) letGo();
      if (asked && performance.now() - asked.at > 3000) asked = null;
      const now = performance.now();
      const k = 1 - Math.exp(-dt * 10);
      let loud = 0;
      for (const [id, h] of helis) {
        if (h.falling) {
          // Coming down with nobody in it: across and down (over a rise, when it was thrown), tumbling if thrown, then righting itself.
          const f = h.falling;
          const t = (now - f.since) / 1000;
          const p = Math.min(1, t / f.seconds);
          const ease = p * p * (3 - 2 * p);
          h.pose[0] = f.from[0] + (f.to[0] - f.from[0]) * ease;
          h.pose[2] = f.from[2] + (f.to[2] - f.from[2]) * ease;
          h.pose[1] = f.from[1] + (f.to[1] - f.from[1]) * (f.arc > 0 ? p : ease) + f.arc * 4 * p * (1 - p);
          const tumble = f.arc > 0 ? Math.sin(p * Math.PI) : 0;
          h.pose[3] = f.from[3] + (f.arc > 0 ? t * 2.2 : 0) * (1 - ease) + wrap(f.to[3] - f.from[3]) * ease;
          h.pose[4] = tumble * Math.sin(t * 5) * 0.9;
          h.pose[5] = tumble * Math.cos(t * 4) * 0.9;
          if (p >= 1) {
            h.pose = [...f.to];
            h.target = [...f.to];
            h.falling = null;
            const me = game.player.position;
            if (Math.hypot(me.x - h.pose[0], me.y - h.pose[1], me.z - h.pose[2]) < 60) game.sound.tone("sine", 90, 40, 0.3, 0.3);
          }
          place(h);
        } else if (!(id === mine && seat === 0)) {
          for (let i = 0; i < 3; i++) {
            h.pose[i]! += (h.target[i]! - h.pose[i]!) * k;
            h.pose[3 + i]! += wrap(h.target[3 + i]! - h.pose[3 + i]!) * k;
          }
          place(h);
        }
        // Everyone in it who is not this player: in their seats, wherever it has got to.
        h.riders.forEach((rider, i) => {
          if (rider && rider !== game.myId()) game.ride(rider, seatOf(h.pose, i));
        });
        // The rotors turn while someone is at the controls (and run down when they leave), opposite ways.
        const live = h.riders[0] !== null && !h.falling && (id !== mine || seat !== 0 || h.charge > 0);
        h.spin += ((live ? 1 : 0) - h.spin) * Math.min(1, dt * (live ? 1.2 : 0.5));
        h.rotors[0].rotation.y += h.spin * 34 * dt;
        h.rotors[1].rotation.y -= h.spin * 34 * dt;
        const me = game.player.position;
        loud = Math.max(loud, h.spin * Math.max(0, 1 - Math.hypot(me.x - h.pose[0], me.y - h.pose[1], me.z - h.pose[2]) / 90));
      }
      // The rotors: a low beat, what the thin air carries of it.
      hum -= dt;
      if (loud > 0.05 && hum <= 0) {
        hum = 0.14;
        game.sound.tone("sine", 74, 60, 0.13, 0.11 * loud);
        game.sound.noise(0.08, 0.03 * loud, 700);
      }
    },

    board(): boolean {
      if (mine !== null) {
        // Getting out: beside it on the ground, or straight out into the air.
        const h = helis.get(mine)!;
        send({ k: "heli-leave", pose: h.pose, charge: h.charge });
        const out = seat === 0 ? -1 : 1;
        const c = Math.cos(h.pose[3]), s = Math.sin(h.pose[3]);
        letGo();
        const at: [number, number, number] = [h.pose[0] + c * out * 2.1, h.pose[1] + 1.1, h.pose[2] - s * out * 2.1];
        // (On clear ground, or clear air: a wall may stand beside it.)
        game.player.seat(...(game.clearSpot(...at) ?? at));
        return true;
      }
      const near = nearest();
      if (!near) return false;
      if (near.h.riders[0] !== null && near.h.riders[1] !== null) game.toast("That helicopter is full");
      else if (!asked) {
        asked = { id: near.id, at: performance.now() };
        send({ k: "heli-board", id: near.id });
      }
      return true;
    },

    prompt() {
      if (mine !== null) return { text: "<kbd>H</kbd> get out of the helicopter", button: "Get out" };
      const near = nearest();
      if (!near || (near.h.riders[0] !== null && near.h.riders[1] !== null)) return null;
      return near.h.riders[0] === null ? { text: "<kbd>H</kbd> fly the helicopter", button: "Fly" } : { text: "<kbd>H</kbd> ride in the helicopter", button: "Ride" };
    },

    busy() {
      return mine !== null;
    },
  };
  return feature;
}
