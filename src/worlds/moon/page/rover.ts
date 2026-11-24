import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CharacterSupportedState, PhysicsCharacterController } from "@babylonjs/core/Physics/v2/characterController";
import { BUILDER_GROUP } from "../../../render/physicsGroups";
import { paintMesh } from "../../../render/paint";
import type { DriveInput, PageGame, Ride, WorldFeature } from "../../pageDoors";
import { ROVER, type RoverPose, type ToPage, type ToServer } from "../roverRules";

/**
 * The page's side of the Moon's rovers (see roverRules.ts for what they are):
 * draws all six with whoever sits in them, and drives the one this player is
 * on. Driving goes where the player looks: forward heads that way, back brakes
 * and reverses, the run key goes flat out.
 */

const DOWN = Vector3.Down();
/** How quickly it picks up speed and turns. */
const PICKUP = 1.6;
const TURN = 2.6;
/** Where it is goes to the server this often, ms. */
const REPORT_MS = 100;

interface Shown {
  mesh: Mesh;
  /** Where it is drawn, and where it is heading (others' rovers ease toward what the server last said). */
  pose: RoverPose;
  target: RoverPose;
  rider: string | null;
  /** Drifting off into space: how fast, and since when (performance.now()). */
  lost: { v: [number, number, number]; since: number } | null;
  /** How fast it turns over while it floats or drifts: about the vertical, nose over tail, and rolling (radians a second). */
  spin: [number, number, number];
}

/** The seat of a rover standing (or floating) at `pose`: where its surface is and how it is turned. */
function seatOf(pose: RoverPose): Ride {
  const turned = Matrix.RotationYawPitchRoll(pose[3], -pose[4], pose[5]);
  const at = Vector3.TransformCoordinates(new Vector3(0, ROVER.seatUp, -ROVER.seatBack), turned);
  return { x: pose[0] + at.x, y: pose[1] + at.y, z: pose[2] + at.z, yaw: pose[3], pitch: -pose[4], roll: pose[5] };
}

/** A six-wheeled buggy with a seat and a steering wheel: one merged mesh, coloured by vertex, its origin on the ground under its middle, nose toward +z. */
function roverModel(game: PageGame): Mesh {
  const { scene } = game;
  const white: [number, number, number] = [0.9, 0.91, 0.93];
  const grey: [number, number, number] = [0.42, 0.44, 0.5];
  const dark: [number, number, number] = [0.15, 0.16, 0.2];
  const gold: [number, number, number] = [0.9, 0.68, 0.24];
  const red: [number, number, number] = [0.82, 0.22, 0.18];
  const part = (mesh: Mesh, color: [number, number, number], x: number, y: number, z: number, rz = 0, rx = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    mesh.rotation.x = rx;
    return paintMesh(mesh, ...color);
  };
  const parts: Mesh[] = [];
  for (const side of [-1, 1]) {
    for (const z of [-1.05, 0, 1.05]) {
      parts.push(part(CreateCylinder("r-wheel", { diameter: 0.84, height: 0.34, tessellation: 12 }, scene), dark, side * 0.95, 0.42, z, Math.PI / 2));
      parts.push(part(CreateCylinder("r-hub", { diameter: 0.36, height: 0.38, tessellation: 8 }, scene), grey, side * 0.95, 0.42, z, Math.PI / 2));
    }
    parts.push(part(CreateBox("r-rocker", { width: 0.1, height: 0.12, depth: 2.3 }, scene), grey, side * 0.72, 0.5, 0));
    // A low rail each side of the seat.
    parts.push(part(CreateBox("r-side", { width: 0.06, height: 0.3, depth: 0.9 }, scene), white, side * 0.5, 1.02, -0.55));
  }
  parts.push(part(CreateBox("r-chassis", { width: 1.5, height: 0.26, depth: 2.8 }, scene), white, 0, 0.65, 0));
  // The driver's seat: a cushion and a tall back, and in front of it a steering wheel on its column.
  parts.push(part(CreateBox("r-seat", { width: 0.78, height: 0.2, depth: 0.74 }, scene), dark, 0, ROVER.seatUp - 0.1, -ROVER.seatBack));
  parts.push(part(CreateBox("r-seat-back", { width: 0.78, height: 1.05, depth: 0.16 }, scene), dark, 0, ROVER.seatUp + 0.45, -ROVER.seatBack - 0.42, 0, -0.12));
  parts.push(part(CreateBox("r-headrest", { width: 0.4, height: 0.24, depth: 0.14 }, scene), grey, 0, ROVER.seatUp + 1.08, -ROVER.seatBack - 0.5));
  parts.push(part(CreateCylinder("r-column", { diameter: 0.07, height: 0.75, tessellation: 6 }, scene), grey, 0, 1.2, 0.18, 0, -0.55));
  parts.push(part(CreateCylinder("r-wheel-rim", { diameter: 0.46, height: 0.06, tessellation: 12 }, scene), dark, 0, 1.52, -0.02, 0, 1.0));
  // Up front: the equipment box in gold foil, a dish, a lamp bar, and a red stripe along the nose.
  parts.push(part(CreateBox("r-box", { width: 1.2, height: 0.5, depth: 0.95 }, scene), gold, 0, 1.03, 0.8));
  parts.push(part(CreateBox("r-stripe", { width: 1.52, height: 0.08, depth: 0.2 }, scene), red, 0, 0.72, 1.32));
  parts.push(part(CreateBox("r-lamps", { width: 0.9, height: 0.12, depth: 0.1 }, scene), dark, 0, 0.95, 1.3));
  // The dish, on a mast at the back corner, out of the driver's view.
  parts.push(part(CreateCylinder("r-mast", { diameter: 0.07, height: 1.5, tessellation: 6 }, scene), grey, 0.62, 1.5, -1.25));
  parts.push(part(CreateCylinder("r-dish", { diameterTop: 0.6, diameterBottom: 0.1, height: 0.18, tessellation: 12 }, scene), white, 0.62, 2.3, -1.25, 0, -0.5));
  const mesh = Mesh.MergeMeshes(parts, true, true)!;
  mesh.name = "rover";
  const material = new StandardMaterial("rover", scene);
  material.specularColor = Color3.Black();
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return mesh;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function startRovers(game: PageGame): WorldFeature & { rovers: Map<number, Shown>; readonly mine: number | null; readonly speed: number; readonly floating: boolean } {
  const template = roverModel(game);
  template.setEnabled(false);
  const rovers = new Map<number, Shown>();
  /** The rover this player drives, its body in the physics world, and how it is going. */
  let mine: number | null = null;
  let body: PhysicsCharacterController | null = null;
  let speed = 0;
  let yaw = 0;
  let grounded = true;
  /** Left the ground too fast to come back: floating away, for this long so far. */
  let floating = false;
  let floatedFor = 0;
  const floatWay = new Vector3();
  let stuckFor = 0;
  let reportedAt = 0;
  /** Asked the server to get on this rover; no answer yet. */
  let asked: { id: number; at: number } | null = null;
  const gravity = new Vector3(0, -game.env.gravity, 0);
  const send = (msg: ToServer) => game.send(msg);

  function show(id: number, pose: RoverPose, rider: string | null): Shown {
    let r = rovers.get(id);
    if (!r) {
      const mesh = template.clone(`rover-${id}`);
      mesh.setEnabled(true);
      game.shadows.addShadowCaster(mesh);
      // Each rover turns over its own way.
      const sign = (n: number) => (((id + n) & 1) === 0 ? 1 : -1);
      r = { mesh, pose: [...pose], target: [...pose], rider: null, lost: null, spin: [0.45 * sign(0), 0.95 * sign(1), 0.8 * sign(id >> 1)] };
      rovers.set(id, r);
    }
    r.target = [...pose];
    // Whoever was in the seat and no longer is, is on their feet again.
    if (r.rider !== null && r.rider !== rider) game.ride(r.rider, null);
    r.rider = rider;
    return r;
  }

  function place(r: Shown): void {
    r.mesh.position.set(r.pose[0], r.pose[1], r.pose[2]);
    r.mesh.rotation.set(-r.pose[4], r.pose[3], r.pose[5]);
  }

  /** Stops driving (the rover stays where it is). */
  function letGo(): void {
    game.ride(game.myId(), null);
    body = null;
    mine = null;
    speed = 0;
    floating = false;
  }

  function startDriving(id: number): void {
    const r = rovers.get(id);
    if (!r) return;
    mine = id;
    yaw = r.pose[3];
    speed = 0;
    grounded = true;
    floating = false;
    stuckFor = 0;
    floatedFor = 0;
    body = new PhysicsCharacterController(new Vector3(r.pose[0], r.pose[1] + ROVER.radius + 0.05, r.pose[2]), { capsuleHeight: ROVER.radius * 2, capsuleRadius: ROVER.radius }, game.scene);
    body.maxStepHeight = 0.5;
    body.shape.filterMembershipMask = BUILDER_GROUP;
    body.maxCharacterSpeedForSolver = 110;
    body.maxAcceleration = 400;
    body.acceleration = 1;
    game.sound.tone("sine", 300, 620, 0.12, 0.14);
    game.sound.tone("sine", 620, 620, 0.08, 0.1, 0.12);
  }

  /** Left the Moon: thrown clear. The server flies the player back and takes the rover home. */
  function eject(pose: RoverPose, v: Vector3): void {
    send({ k: "eject", pose, v: [v.x, v.y, v.z] });
    const r = rovers.get(mine!);
    if (r) {
      game.ride(game.myId(), null);
      r.rider = null;
      r.lost = { v: [v.x, v.y, v.z], since: performance.now() };
    }
    letGo();
    game.sound.noise(0.5, 0.2, 1800);
    game.sound.tone("sine", 500, 1300, 0.4, 0.16);
  }

  const feature = {
    rovers,
    get mine() {
      return mine;
    },
    get speed() {
      return speed;
    },
    get floating() {
      return floating;
    },

    joined() {
      letGo();
      asked = null;
    },

    message(data: unknown) {
      const msg = data as ToPage;
      if (msg.k === "all") {
        for (const [id, pose, rider] of msg.list) {
          const r = show(id, pose, rider);
          r.pose = [...pose];
          r.lost = null;
          place(r);
        }
      } else if (msg.k === "poses") {
        for (const [id, pose] of msg.list) if (id !== mine) show(id, pose, rovers.get(id)?.rider ?? null);
      } else if (msg.k === "rider") {
        const r = show(msg.id, msg.pose, msg.by);
        // Back from space, or home: there at once, not sliding across the Moon.
        if (r.lost || Math.hypot(r.pose[0] - msg.pose[0], r.pose[1] - msg.pose[1], r.pose[2] - msg.pose[2]) > 40) r.pose = [...msg.pose];
        r.lost = null;
        r.mesh.scaling.setAll(1);
        if (asked?.id === msg.id) asked = null;
        if (msg.by === game.myId() && mine !== msg.id) startDriving(msg.id);
        else if (msg.by !== game.myId() && mine === msg.id) letGo();
      } else if (msg.k === "lost") {
        const r = show(msg.id, msg.pose, null);
        if (!r.lost) r.lost = { v: msg.v, since: performance.now() };
        r.pose = [...msg.pose];
        if (mine === msg.id) letGo();
      } else if (msg.k === "no") {
        asked = null;
        game.toast(msg.why === "taken" ? "Someone else is driving that rover" : "Get closer to the rover");
      }
    },

    drive(dt: number, input: DriveInput): boolean {
      const r = mine === null ? undefined : rovers.get(mine);
      if (!r || !body) return false;
      const support = body.checkSupport(dt, DOWN);
      // Once it floats it is off the Moon for good: brushing something on the way up does not land it.
      const onGround = support.supportedState === CharacterSupportedState.SUPPORTED && !floating;
      const before = body.getVelocity();

      // Steer toward where the player looks (and pushes); back is the brake, then reverse.
      const push = Math.min(1, Math.hypot(input.strafe, input.forward));
      const backing = input.forward < -0.3 && Math.abs(input.strafe) < 0.6;
      const heading = backing ? input.yaw : input.yaw + Math.atan2(input.strafe, input.forward);
      if (push > 0.1 && onGround) yaw += Math.max(-1, Math.min(1, wrap(heading - yaw) * 3)) * TURN * dt * (0.45 + 0.55 * Math.min(1, Math.abs(speed) / 8));
      const top = input.run ? ROVER.sprint : ROVER.cruise;
      const wanted = backing ? -top * 0.4 : push > 0.1 ? top * push : 0;

      const nose = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      let out: Vector3;
      let pitch = r.pose[4];
      let roll = r.pose[5];
      if (onGround) {
        if (!grounded) {
          // Down again: carry on at whatever speed it kept along its nose, right way up.
          floating = false;
          roll = 0;
          speed = before.x * nose.x + before.z * nose.z;
        }
        speed += (wanted - speed) * (1 - Math.exp(-dt * PICKUP));
        // Along the ground it stands on, so a ramp carries it up (and throws it off the top).
        const n = support.averageSurfaceNormal;
        const along = nose.subtract(n.scale(Vector3.Dot(nose, n))).normalize();
        out = along.scale(speed);
        pitch += (Math.asin(Math.max(-1, Math.min(1, along.y))) - pitch) * Math.min(1, dt * 10);
      } else {
        if (grounded && before.y > ROVER.liftOff) {
          // Just left the ground, rising fast (off a ramp): it will not come back down. It floats
          // away the way it was going, and starts to turn over, each time its own way.
          floating = true;
          stuckFor = 0;
          floatedFor = 0;
          const way = before.normalizeToNew();
          way.y = Math.max(way.y, 0.45);
          floatWay.copyFrom(way.normalize().scale(ROVER.floatSpeed));
          const any = (low: number, high: number) => (low + Math.random() * (high - low)) * (Math.random() < 0.5 ? -1 : 1);
          r.spin = [any(0.3, 0.7), any(0.7, 1.2), any(0.6, 1.1)];
          game.toast("Lift-off! The Moon cannot hold you", 2600);
          game.sound.tone("sine", 220, 880, 0.5, 0.14);
        }
        out = before.clone();
        if (floating) {
          // The same steady drift, whatever it brushed against.
          out = floatWay.clone();
          floatedFor += dt;
          yaw += r.spin[0] * dt;
          pitch += r.spin[1] * dt;
          roll += r.spin[2] * dt;
        } else {
          out.y -= game.env.gravity * dt;
          const flat = Math.hypot(out.x, out.z);
          pitch += (Math.atan2(out.y, Math.max(flat, 0.5)) * 0.6 - pitch) * Math.min(1, dt * 3);
        }
      }
      grounded = onGround;
      body.setVelocity(out);
      body.integrate(dt, support, gravity);

      const p = body.getPosition();
      const after = body.getVelocity();
      // Into a wall: it stops, it does not push on.
      if (onGround) speed = Math.sign(speed || 1) * Math.min(Math.abs(speed), after.length() + 2);
      // Floating but going nowhere (under a ceiling): the Moon has it back after all.
      if (floating) {
        stuckFor = after.length() < 3 ? stuckFor + dt : 0;
        if (stuckFor > 1.2) floating = false;
      }
      // The point under its middle: straight below on the ground, wherever "below" has got to when it is turning over.
      const below = Vector3.TransformCoordinates(new Vector3(0, ROVER.middleUp, 0), Matrix.RotationYawPitchRoll(yaw, -pitch, roll));
      r.pose = [p.x - below.x, p.y - ROVER.radius + ROVER.middleUp - below.y, p.z - below.z, wrap(yaw), wrap(pitch), wrap(roll)];
      r.target = [...r.pose];
      place(r);
      // The driver sits in the seat, and the view follows them.
      const seat = seatOf(r.pose);
      game.ride(game.myId(), seat);
      game.player.seat(seat.x, seat.y + 0.6, seat.z);

      const now = performance.now();
      // Thrown clear: after floating a while, or (on the ground or in a hop) past the edge of the building area.
      const gone = floating ? floatedFor >= ROVER.floatFor : Math.abs(p.x) > ROVER.edge || Math.abs(p.z) > ROVER.edge || p.y < -30;
      if (gone) eject(r.pose, after);
      else if (now - reportedAt >= REPORT_MS) {
        reportedAt = now;
        send({ k: "drive", pose: r.pose });
      }
      return !gone;
    },

    update(dt: number) {
      // Thrown off (a stone landed by it): the server has already parked it.
      if (mine !== null && game.player.knockedDown) letGo();
      if (asked && performance.now() - asked.at > 3000) asked = null;
      const now = performance.now();
      const k = 1 - Math.exp(-dt * 10);
      for (const [id, r] of rovers) {
        if (r.lost) {
          // Drifting off: on the way it was going, still turning over, getting small with distance.
          const t = (now - r.lost.since) / 1000;
          for (let i = 0; i < 3; i++) {
            r.pose[i]! += r.lost.v[i]! * dt;
            r.pose[3 + i]! += r.spin[i]! * dt;
          }
          place(r);
          r.mesh.scaling.setAll(Math.max(0.05, 1 - t / (ROVER.lostFor / 1000)));
          continue;
        }
        if (id === mine) continue;
        for (let i = 0; i < 3; i++) {
          r.pose[i]! += (r.target[i]! - r.pose[i]!) * k;
          r.pose[3 + i]! += wrap(r.target[3 + i]! - r.pose[3 + i]!) * k;
        }
        place(r);
        // Someone else at the wheel: in the seat, wherever it has got to.
        if (r.rider !== null && r.rider !== game.myId()) game.ride(r.rider, seatOf(r.pose));
      }
    },

    board(): boolean {
      if (mine !== null) {
        // Getting off: step down beside it.
        const r = rovers.get(mine)!;
        send({ k: "leave", pose: r.pose });
        const side = new Vector3(Math.cos(r.pose[3]), 0, -Math.sin(r.pose[3]));
        letGo();
        game.player.seat(r.pose[0] + side.x * 1.9, r.pose[1] + 1.1, r.pose[2] + side.z * 1.9);
        return true;
      }
      const near = nearest();
      if (!near) return false;
      if (near.r.rider !== null) game.toast("Someone else is driving that rover");
      else if (!asked) {
        asked = { id: near.id, at: performance.now() };
        send({ k: "board", id: near.id });
      }
      return true;
    },

    prompt() {
      if (mine !== null) return { text: "<kbd>H</kbd> get off the rover", button: "Get off" };
      const near = nearest();
      if (!near || near.r.rider !== null) return null;
      return { text: "<kbd>H</kbd> drive the rover", button: "Drive" };
    },

    busy() {
      return mine !== null;
    },
  };

  /** The rover within reach of the player, nearest first. */
  function nearest(): { id: number; r: Shown } | null {
    if (game.player.knockedDown) return null;
    const p = game.player.position;
    let best: { id: number; r: Shown } | null = null;
    let bestDist: number = ROVER.boardReach;
    for (const [id, r] of rovers) {
      if (r.lost) continue;
      const d = Math.hypot(r.pose[0] - p.x, r.pose[2] - p.z);
      if (d <= bestDist && Math.abs(p.y - 0.9 - r.pose[1]) < 3.5) {
        best = { id, r };
        bestDist = d;
      }
    }
    return best;
  }

  return feature;
}
