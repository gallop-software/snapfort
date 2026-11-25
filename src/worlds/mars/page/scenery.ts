import type { Camera } from "@babylonjs/core/Cameras/camera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import { Scene } from "@babylonjs/core/scene";
import { CELL } from "../../../game/constants";
import { rng } from "../../../render/paint";
import type { Scenery } from "../../pageDoors";
import { daylight, deimosDirection, dusk, earthDirection, phobosDirection, solsAt, sunDirection, sunHeight } from "../sol";
import { sky as weather } from "./air";
import { auroraTexture, discTexture, glowTexture, hazeTexture, marsGroundTexture, mossTexture, phobosTexture, spreadTexture, starTexture } from "./textures";

/** Dust in the air: far things fade into the colour of the horizon. */
const FOG_START = 220, FOG_END = 1500;
/** Wide enough that its edge is lost in the dust. */
const GROUND_SIZE = 3600;
/** How far off the sun, moons and stars are drawn (they follow the camera, so they are never reached). */
const FAR = 1600;
const ADDITIVE = 1;

type RGB = readonly [number, number, number];
/** The sky by day: butterscotch, paler and dustier toward the horizon. */
const DAY = { zenith: [0.6, 0.47, 0.36], horizon: [0.87, 0.71, 0.53] } as const;
/** With the sun on the horizon: the dust goes grey, and (drawn apart) blue round the sun. */
const DUSK = { zenith: [0.17, 0.16, 0.21], horizon: [0.38, 0.32, 0.3] } as const;
/** The same hours once the air is thick: a blue sky by day, and a sunset gone red, as on the Earth (thick air scatters the blue out of the low sun; Mars's thin dust does the opposite). */
const WET_DAY = { zenith: [0.3, 0.52, 0.88], horizon: [0.78, 0.87, 0.95] } as const;
const WET_DUSK = { zenith: [0.25, 0.24, 0.4], horizon: [0.9, 0.52, 0.32] } as const;
const NIGHT = { zenith: [0.02, 0.02, 0.045], horizon: [0.1, 0.095, 0.14] } as const;

const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const smooth = (lo: number, hi: number, v: number) => {
  const k = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return k * k * (3 - 2 * k);
};
const paint = (c: Color3, [r, g, b]: RGB, k = 1) => c.set(r * k, g * k, b * k);

/** A fixed hour for pictures and checks: `?sol=0.3` holds the sol at that point (0..1 from sunrise). */
function heldSol(): number | null {
  const held = new URLSearchParams(location.search).get("sol");
  const v = held === null ? NaN : Number(held);
  return Number.isFinite(v) ? v : null;
}

/** Something that only glows: drawn at its own colour whatever the light, untouched by the dust. */
function glowing(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.fogEnabled = false;
  return m;
}

function inTheSky<T extends Mesh>(mesh: T, material: StandardMaterial): T {
  mesh.material = material;
  mesh.infiniteDistance = true;
  mesh.isPickable = false;
  mesh.applyFog = false;
  return mesh;
}

/** A soft round light in the sky that always faces the camera and adds to what is behind it. */
function halo(scene: Scene, name: string, texture: Texture): { mesh: Mesh; material: StandardMaterial } {
  const material = glowing(scene, name);
  // Its shape comes from the texture and its colour from the material alone (a texture's colour would be added on top, washing the tint out to white).
  material.opacityTexture = texture;
  material.alphaMode = ADDITIVE;
  material.disableDepthWrite = true;
  const mesh = inTheSky(CreatePlane(name, { size: 1 }, scene), material);
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  return { mesh, material };
}

/**
 * One wall of the canyon: a talus slope of fallen rock, then cliffs in two
 * steps with a bench between, up to the plateau. `side` is +1 for the north
 * wall and -1 for the south. The real walls of Valles Marineris stand up to
 * 7 km high but so far apart that from the floor they are over the horizon;
 * here they are pulled close and kept to a few hundred metres.
 */
function canyonWall(scene: Scene, side: 1 | -1, material: StandardMaterial): Mesh {
  const r = rng(side === 1 ? 211 : 307);
  const half = 1900, step = 50;
  const columns = Math.round((half * 2) / step) + 1;
  const p1 = r() * 6, p2 = r() * 6, p3 = r() * 6, p4 = r() * 6;
  // Layers of rock, bottom to top: fallen rubble, then bands laid down over ages.
  const bands: RGB[] = [[0.66, 0.4, 0.28], [0.6, 0.35, 0.24], [0.5, 0.28, 0.2], [0.63, 0.38, 0.27], [0.46, 0.25, 0.18], [0.58, 0.34, 0.24], [0.68, 0.43, 0.3]];
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let i = 0; i < columns; i++) {
    const x = -half + i * step;
    const top = 330 + 70 * Math.sin(x * 0.0041 + p1) + 40 * Math.sin(x * 0.0113 + p2) + (r() - 0.5) * 30;
    // The wall wanders in and out: bays and headlands.
    const out = 70 * Math.sin(x * 0.0057 + p3) + 30 * Math.sin(x * 0.017 + p4) + (r() - 0.5) * 16;
    const rows: [number, number][] = [
      [400 + out * 0.4, -2],
      [480 + out * 0.7, 46 + r() * 12],
      [530 + out, 96 + r() * 14],
      [548 + out, top * 0.52],
      [590 + out, top * 0.57],
      [606 + out, top],
      [1500, top + 30],
    ];
    rows.forEach(([d, y], j) => {
      positions.push(x, y, side * d);
      const shade = 0.92 + r() * 0.16;
      const [cr, cg, cb] = bands[j]!;
      colors.push(cr * shade, cg * shade, cb * shade, 1);
    });
    if (i === 0) continue;
    const n = rows.length;
    for (let j = 0; j < n - 1; j++) {
      const a = (i - 1) * n + j, b = i * n + j;
      if (side === 1) indices.push(a, b, a + 1, b, b + 1, a + 1);
      else indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const mesh = new Mesh(`canyon-${side}`, scene);
  const data = new VertexData();
  data.positions = positions;
  data.colors = colors;
  data.indices = indices;
  data.applyToMesh(mesh);
  // Flat faces: the rock reads as broken slabs, not a smooth drape.
  mesh.convertToFlatShadedMesh();
  mesh.material = material;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/**
 * Mars: the floor of a great canyon, rust-red under a butterscotch sky, with
 * a day that passes. The sun is small and its setting is blue; at night there
 * are stars, Phobos crossing the wrong way, Deimos, and the Earth as an
 * evening star, and what is built of ice or glass glows.
 *
 * And it changes with the air (./air.ts: 0 thin, 1 thick). As a Terraformer
 * runs the sky pales to blue and its sunsets redden, clouds form, showers
 * pass, lichen and then green spread outward from the machine, water stands
 * in pools, and at night an aurora hangs over it all. Stop the machine and it
 * all goes back the way it came.
 *
 * Copied from the Moon's and changed from there.
 */
export function scenery(scene: Scene, camera: Camera): Scenery {
  const haze = new Color3(...DAY.horizon);
  scene.clearColor = new Color4(haze.r, haze.g, haze.b, 1);
  scene.ambientColor = new Color3(0, 0, 0);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = haze;
  scene.fogStart = FOG_START;
  scene.fogEnd = FOG_END;

  const ambient = new HemisphericLight("ambient", new Vector3(0.2, 1, 0.1), scene);
  ambient.specular = Color3.Black();

  // One light for the sun by day, and for the faint light of the sky at night.
  const sun = new DirectionalLight("sun", new Vector3(-0.6, -0.7, 0.4).normalize(), scene);
  sun.specular = Color3.Black();

  // Two 1024 cascades: crisp near the builder at a sixth of the cost of three 2048 ones.
  const shadows = new CascadedShadowGenerator(1024, sun, undefined, camera);
  shadows.numCascades = 2;
  shadows.shadowMaxZ = 110;
  shadows.lambda = 0.85;
  shadows.stabilizeCascades = true;
  shadows.cascadeBlendPercentage = 0.08;
  shadows.bias = 0.004;
  shadows.normalBias = 0.02;
  shadows.setDarkness(0.5);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;

  // The sky: one colour overhead, with the stars added to it as the light goes.
  const stars = starTexture(scene);
  const skyMat = glowing(scene, "sky");
  skyMat.emissiveTexture = stars;
  inTheSky(CreateSphere("sky", { diameter: 3600, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene), skyMat);

  // The dust along the horizon: a band round the whole view, solid low down and clearing upward.
  const bandMat = glowing(scene, "horizon");
  bandMat.opacityTexture = hazeTexture(scene);
  bandMat.disableDepthWrite = true;
  const band = inTheSky(CreateCylinder("horizon", { diameter: 3400, height: 1500, tessellation: 32, cap: Mesh.NO_CAP, sideOrientation: Mesh.BACKSIDE }, scene), bandMat);
  band.position.y = 50;
  // Drawn before anything else that is see-through, so the sun and its halo shine over the dust, not under it.
  band.alphaIndex = 0;

  // The sun: small (Mars is half as far again from it as the Earth), with a wide soft halo.
  const glow = glowTexture(scene);
  const sunHalo = halo(scene, "sun-halo", glow);
  const sunDisc = halo(scene, "sun-disc", discTexture(scene));
  sunDisc.mesh.scaling.setAll(34);

  // Phobos: a dark lump, big enough to see its shape; it is lit by the sun, so it shows by day too.
  const phobosMat = glowing(scene, "phobos");
  phobosMat.emissiveTexture = phobosTexture(scene);
  const phobos = inTheSky(CreateSphere("phobos", { diameter: 46, segments: 10 }, scene), phobosMat);
  phobos.scaling.set(1.3, 1, 1.08);
  // Deimos and the Earth: points of light.
  const deimos = halo(scene, "deimos", glow);
  deimos.mesh.scaling.setAll(26);
  const earth = halo(scene, "earth", glow);
  earth.mesh.scaling.setAll(44);

  // Ground.
  const ground = new Mesh("ground", scene);
  const h = GROUND_SIZE / 2;
  const uv = h / (CELL * 2);
  const data = new VertexData();
  data.positions = [-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h];
  data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  data.uvs = [-uv, -uv, uv, -uv, uv, uv, -uv, uv];
  data.indices = [0, 1, 2, 0, 2, 3];
  data.applyToMesh(ground);
  const groundMat = new StandardMaterial("ground", scene);
  groundMat.diffuseTexture = marsGroundTexture(scene);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
  ground.receiveShadows = true;
  ground.isPickable = false;
  const groundShape = new PhysicsShapeBox(new Vector3(0, -1, 0), Quaternion.Identity(), new Vector3(GROUND_SIZE, 2, GROUND_SIZE), scene);
  const groundBody = new PhysicsBody(ground, PhysicsMotionType.STATIC, false, scene);
  groundBody.shape = groundShape;
  groundBody.disableSync = true;

  // The canyon's walls, north and south; east and west it runs on out of sight.
  const rock = new StandardMaterial("canyon", scene);
  rock.specularColor = Color3.Black();
  rock.backFaceCulling = false;
  canyonWall(scene, 1, rock);
  canyonWall(scene, -1, rock);

  // ── What thick air brings ──
  // Clouds: one squashed ball drawn many times, as the Meadow's are; they only show once there is air to hold them.
  const cloudMat = glowing(scene, "cloud");
  cloudMat.fogEnabled = false;
  const cloud = CreateSphere("cloud", { diameter: 1, segments: 6 }, scene);
  cloud.material = cloudMat;
  cloud.isPickable = false;
  cloud.alwaysSelectAsActiveMesh = true;
  {
    const r = rng(17);
    const matrices: number[] = [];
    for (let i = 0; i < 18; i++) {
      const angle = r() * Math.PI * 2, radius = 300 + r() * 900;
      const centre = new Vector3(Math.cos(angle) * radius, 260 + r() * 160, Math.sin(angle) * radius);
      const puffs = 3 + Math.floor(r() * 3);
      for (let p = 0; p < puffs; p++) {
        const size = 60 + r() * 70;
        matrices.push(...Matrix.Compose(new Vector3(size * 1.6, size * 0.45, size), Quaternion.Identity(), centre.add(new Vector3((p - puffs / 2) * 52 + r() * 16, r() * 12, r() * 34))).asArray());
      }
    }
    cloud.thinInstanceSetBuffer("matrix", new Float32Array(matrices), 16, true);
  }

  // Rain: short pale streaks falling round the camera while a shower passes.
  const DROPS = 260, RAIN_WIDE = 46, RAIN_TALL = 30;
  const rainMat = glowing(scene, "rain");
  rainMat.emissiveColor = new Color3(0.82, 0.88, 0.95);
  rainMat.alpha = 0.34;
  const rain = CreateBox("rain", { width: 0.035, height: 1.5, depth: 0.035 }, scene);
  rain.material = rainMat;
  rain.isPickable = false;
  rain.alwaysSelectAsActiveMesh = true;
  const drops = new Float32Array(DROPS * 16);
  const dropAt: number[] = [];
  {
    const r = rng(29);
    for (let i = 0; i < DROPS; i++) dropAt.push((r() - 0.5) * RAIN_WIDE, r() * RAIN_TALL, (r() - 0.5) * RAIN_WIDE, 16 + r() * 8);
    Matrix.Identity().copyToArray(drops, 0);
    for (let i = 1; i < DROPS; i++) drops.copyWithin(i * 16, 0, 16);
  }
  rain.thinInstanceSetBuffer("matrix", drops, 16, false);
  rain.setEnabled(false);
  let rainClock = 0;

  // What grows: a mat of lichen, then moss, then green, spreading outward from the machine over the ground.
  const growth = CreateDisc("growth", { radius: 1, tessellation: 48 }, scene);
  growth.rotation.x = Math.PI / 2;
  growth.position.y = 0.035;
  const moss = mossTexture(scene);
  const growthMat = new StandardMaterial("growth", scene);
  growthMat.diffuseTexture = moss;
  growthMat.opacityTexture = spreadTexture(scene);
  growthMat.specularColor = Color3.Black();
  growthMat.zOffset = -2;
  growth.material = growthMat;
  growth.receiveShadows = true;
  growth.isPickable = false;
  growth.setEnabled(false);
  // (It stays where it grew while the air thins, even if the machine is taken away.)
  const grewFrom = { x: 0, z: 0 };

  // Standing water: wide pools in the low places, which fill as it warms. Builders wade into them (see `wade` below).
  const poolMat = new StandardMaterial("pool", scene);
  poolMat.diffuseColor = new Color3(0.16, 0.3, 0.44);
  poolMat.specularColor = new Color3(0.9, 0.9, 0.9);
  poolMat.specularPower = 90;
  // (Not see-through: where two pools run together their water is one colour, with no darker lens where they overlap.)
  poolMat.zOffset = -4;
  const pool = CreateDisc("pool", { radius: 1, tessellation: 72 }, scene);
  // (Each pool is laid flat by its own matrix below: turning the disc here as well would stand them on edge, far from where they belong.)
  pool.material = poolMat;
  pool.isPickable = false;
  pool.receiveShadows = true;
  pool.alwaysSelectAsActiveMesh = true;
  const POOLS: [number, number, number, number][] = [];
  {
    const r = rng(53);
    for (let i = 0; i < 16; i++) POOLS.push([(r() - 0.5) * 620, (r() - 0.5) * 620, 18 + r() * 52, 0.75 + r() * 0.5]);
  }
  const poolMatrices = new Float32Array(POOLS.length * 16);
  pool.thinInstanceSetBuffer("matrix", poolMatrices, 16, false);
  pool.setEnabled(false);
  let poolsAt = -1;
  /** The deepest a pool gets, m (to a builder's waist), and how fast its bed falls away from the shore. */
  const POOL_DEEP = 0.9, POOL_SLOPE = 0.12;
  /** How deep the water is at a spot: nothing at a pool's shore, deepening toward its middle. */
  const wade = (x: number, z: number): number => {
    if (poolsAt <= 0) return 0;
    let deep = 0;
    for (const [px, pz, wide, squash] of POOLS) {
      const rx = wide * poolsAt, rz = rx * squash;
      const d = Math.hypot((x - px) / rx, (z - pz) / rz);
      if (d < 1) deep = Math.max(deep, Math.min(POOL_DEEP, (1 - d) * Math.min(rx, rz) * POOL_SLOPE));
    }
    return deep;
  };

  // Whoever moves through a pool stirs it: rings spreading over the water from where they are, and drops thrown up round them.
  const WATER = 0.06;
  const foamMat = glowing(scene, "foam");
  foamMat.zOffset = -6;
  const rings: { mesh: Mesh; age: number; life: number; wide: number }[] = [];
  for (let i = 0; i < 28; i++) {
    const mesh = CreateTorus("ripple", { diameter: 2, thickness: 0.09, tessellation: 28 }, scene);
    mesh.material = foamMat;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    rings.push({ mesh, age: 0, life: 0, wide: 0 });
  }
  const DROPLETS = 160;
  const drop = CreateSphere("splash", { diameter: 1, segments: 3 }, scene);
  drop.material = foamMat;
  drop.isPickable = false;
  drop.alwaysSelectAsActiveMesh = true;
  const splashes = new Float32Array(DROPLETS * 16);
  /** Each drop: where it is, how it moves, how much longer it lasts (s), and its size (m). */
  const flying = Array.from({ length: DROPLETS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, left: 0, size: 0 }));
  drop.thinInstanceSetBuffer("matrix", splashes, 16, false);
  drop.setEnabled(false);
  let ringNext = 0, dropNext = 0, ringDue = 0, dropDue = 0;
  const wake = (x: number, z: number, vx: number, vz: number, dt: number): void => {
    const speed = Math.hypot(vx, vz);
    if (speed < 0.6 || wade(x, z) <= 0) return;
    const hard = Math.min(1, speed / 14);
    // A ring every stride or so; more drops the faster they go.
    ringDue += dt * (2.2 + 3.5 * hard);
    while (ringDue >= 1) {
      ringDue -= 1;
      const ring = rings[ringNext++ % rings.length]!;
      ring.age = 0;
      ring.life = 1.3 + Math.random() * 0.6;
      ring.wide = 1.6 + 2.2 * hard + Math.random() * 0.6;
      ring.mesh.position.set(x + (Math.random() - 0.5) * 0.5, WATER, z + (Math.random() - 0.5) * 0.5);
      ring.mesh.setEnabled(true);
    }
    dropDue += dt * 70 * hard;
    while (dropDue >= 1) {
      dropDue -= 1;
      const d = flying[dropNext++ % DROPLETS]!;
      const angle = Math.random() * Math.PI * 2, out = 0.6 + Math.random() * 1.6;
      d.x = x + Math.cos(angle) * 0.3;
      d.z = z + Math.sin(angle) * 0.3;
      d.y = WATER;
      // (Thrown forward with whoever threw them, and out to the sides: a runner carries a spray along.)
      const along = 0.55 + Math.random() * 0.5;
      d.vx = vx * along + Math.cos(angle) * out;
      d.vz = vz * along + Math.sin(angle) * out;
      // (Mars's pull: they hang in the air longer than they would on Earth.)
      d.vy = 2 + Math.random() * 2.6 * (0.5 + hard);
      d.left = 5;
      d.size = 0.05 + Math.random() * 0.07;
    }
  };
  const FALL = 9.9;
  const hidden = Matrix.Zero();
  /** Moves the rings and the drops on. */
  const stir = (dt: number) => {
    for (const ring of rings) {
      if (!ring.mesh.isEnabled()) continue;
      ring.age += dt;
      const t = ring.age / ring.life;
      if (t >= 1) { ring.mesh.setEnabled(false); continue; }
      const r = 0.35 + ring.wide * (1 - (1 - t) ** 2);
      ring.mesh.scaling.set(r, 0.25, r);
      ring.mesh.visibility = 0.55 * (1 - t) ** 1.5;
    }
    let any = false;
    for (let i = 0; i < DROPLETS; i++) {
      const d = flying[i]!;
      if (d.left > 0) {
        d.vy -= FALL * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        d.left = d.y < WATER - 0.05 ? 0 : d.left - dt;
      }
      if (d.left > 0) {
        any = true;
        Matrix.Compose(new Vector3(d.size, d.size, d.size), Quaternion.Identity(), new Vector3(d.x, d.y, d.z)).copyToArray(splashes, i * 16);
      } else hidden.copyToArray(splashes, i * 16);
    }
    if (any || drop.isEnabled()) drop.thinInstanceBufferUpdated("matrix");
    drop.setEnabled(any);
  };

  // The aurora: a ring of curtains high round the night sky, while there is thick air to light up.
  const auroraMat = glowing(scene, "aurora");
  const curtains = auroraTexture(scene);
  curtains.uScale = 3;
  auroraMat.opacityTexture = curtains;
  auroraMat.emissiveColor = new Color3(0.2, 1, 0.5);
  auroraMat.alphaMode = ADDITIVE;
  auroraMat.disableDepthWrite = true;
  auroraMat.backFaceCulling = false;
  const aurora = inTheSky(CreateCylinder("aurora", { diameterTop: 1500, diameterBottom: 2600, height: 700, tessellation: 40, cap: Mesh.NO_CAP, sideOrientation: Mesh.BACKSIDE }, scene), auroraMat);
  aurora.position.y = 620;
  aurora.setEnabled(false);

  // Up a tall tower the ground is further away: push the fog and the shadows'
  // reach out with height, so the view down stays clear and shadowed.
  let lastHeight = -10;
  const followHeight = () => {
    const h = Math.max(0, camera.globalPosition.y);
    if (Math.abs(h - lastHeight) < 2) return;
    lastHeight = h;
    scene.fogStart = FOG_START + h;
    scene.fogEnd = FOG_END + h * 1.5;
    shadows.shadowMaxZ = 110 + h * 0.9;
  };

  // What glows at night: ice (lit from inside) and the greenhouses (their grow lamps).
  // The pieces' materials are made after the scenery, so they are looked for as the sol goes on.
  let lit: { material: StandardMaterial; color: RGB }[] = [];
  let lookedAt = -1;
  const findLit = () => {
    if (scene.materials.length === lookedAt) return;
    lookedAt = scene.materials.length;
    lit = [];
    for (const m of scene.materials) {
      const name = m instanceof StandardMaterial ? (m.diffuseTexture?.name ?? "") : "";
      if (name.startsWith("piece-roof-")) lit.push({ material: m as StandardMaterial, color: [0.34, 0.3, 0.12] });
      else if (name.startsWith("piece-") && name.endsWith("-wood")) lit.push({ material: m as StandardMaterial, color: [0.1, 0.2, 0.34] });
    }
  };

  const held = heldSol();
  /** How hard it is raining, 0..1 (set with the hour; the drops move every frame). */
  let raining = 0;
  const place = (mesh: Mesh, [x, y, z]: RGB) => mesh.position.set(x * FAR, y * FAR, z * FAR);
  /** Sets everything that depends on the hour. */
  const tell = () => {
    const sols = held ?? solsAt(Date.now());
    const air = weather.air;
    // How far the thaw has got: the sky turns first, then cloud, then rain; lichen first on the ground, then green.
    const wet = smooth(0.05, 0.75, air);
    const height = sunHeight(sols), day = daylight(sols), low = dusk(sols), night = 1 - day;
    const toSun = sunDirection(sols);

    // The sky's colours: night, through dusk, to day.
    const high = smooth(0, 0.24, height);
    // A shower passing: they come and go through the sol once the air is thick enough to rain.
    const shower = smooth(0.6, 0.85, air) * smooth(0.25, 0.6, Math.sin(sols * Math.PI * 2 * 9));
    const grey = (c: RGB): RGB => mix(c, [0.56, 0.6, 0.66], shower * 0.55);
    const zenith = mix(NIGHT.zenith, grey(mix(mix(DUSK.zenith, WET_DUSK.zenith, wet), mix(DAY.zenith, WET_DAY.zenith, wet), high)), day);
    const horizon = mix(NIGHT.horizon, grey(mix(mix(DUSK.horizon, WET_DUSK.horizon, wet), mix(DAY.horizon, WET_DAY.horizon, wet), high)), day);
    paint(skyMat.emissiveColor, zenith);
    stars.level = night * night;
    paint(bandMat.emissiveColor, horizon);
    paint(haze, horizon);
    scene.clearColor.set(horizon[0], horizon[1], horizon[2], 1);

    // The sun. As it sets the dust scatters blue toward you: the halo grows and turns blue.
    const up = height > -0.22;
    sunHalo.mesh.setEnabled(up);
    sunDisc.mesh.setEnabled(up);
    place(sunHalo.mesh, toSun);
    place(sunDisc.mesh, toSun);
    sunHalo.mesh.scaling.setAll(700 + 900 * low);
    // (In thick air it is the other way about: the low sun goes red.)
    paint(sunHalo.material.emissiveColor, mix([1, 0.9, 0.74], mix([0.22, 0.5, 1], [1, 0.42, 0.16], wet), low), (0.5 + 0.5 * low) * (1 - 0.6 * shower));
    paint(sunDisc.material.emissiveColor, mix([1, 0.97, 0.9], [0.8, 0.9, 1], low));

    // Light. By day it comes from the sun (never from quite on the horizon, or shadows run forever);
    // at night a little comes down from the sky, so shapes still read.
    const sunPower = smooth(-0.02, 0.3, height);
    const skyPower = smooth(-0.1, -0.3, height);
    if (height > -0.1) {
      const lift = Math.max(toSun[1], 0.2);
      sun.direction.set(-toSun[0], -lift, -toSun[2]).normalize();
    } else {
      sun.direction.set(0.3, -1, -0.2).normalize();
    }
    sun.intensity = 0.9 * sunPower + 0.3 * skyPower;
    paint(sun.diffuse, mix(mix([0.7, 0.8, 1], [1, 0.82, 0.66], smooth(0, 0.25, height)), [1, 0.93, 0.84], smooth(0.2, 0.6, height)));
    if (height <= -0.1) paint(sun.diffuse, [0.6, 0.68, 1]);
    ambient.intensity = 0.5 + 0.12 * day;
    paint(ambient.diffuse, mix([0.56, 0.62, 0.9], [1, 0.88, 0.76], day));
    paint(ambient.groundColor, mix([0.26, 0.24, 0.34], [0.52, 0.36, 0.27], day));

    // The moons and the Earth.
    place(phobos, phobosDirection(sols));
    phobos.rotation.y = sols * 9;
    phobosMat.emissiveTexture!.level = 0.55 + 0.45 * night;
    place(deimos.mesh, deimosDirection(sols));
    paint(deimos.material.emissiveColor, [1, 0.96, 0.9], 0.25 + 0.75 * night);
    place(earth.mesh, earthDirection(sols));
    paint(earth.material.emissiveColor, [0.55, 0.75, 1], night);

    // Clouds: white by day, dim at night; thicker and greyer in a shower.
    const cloudy = smooth(0.3, 0.7, air);
    cloud.setEnabled(cloudy > 0.01);
    cloud.visibility = cloudy * (0.75 + 0.25 * shower);
    cloud.rotation.y = sols * 1.7;
    paint(cloudMat.emissiveColor, mix(mix([0.1, 0.1, 0.14], [1, 0.97, 0.93], day), [0.6, 0.63, 0.68], shower * 0.7));
    raining = shower;

    // The ground: lichen spreading from the machine, greening as it goes; and the pools filling.
    if (weather.source && weather.to > 0) [grewFrom.x, grewFrom.z] = [weather.source.x, weather.source.z];
    growth.setEnabled(air > 0.02);
    if (air > 0.02) {
      const reach = 20 + 2300 * smooth(0.02, 1, air) ** 1.5;
      growth.position.x = grewFrom.x;
      growth.position.z = grewFrom.z;
      growth.scaling.set(reach, reach, 1);
      moss.uScale = moss.vScale = reach / 9;
      paint(growthMat.diffuseColor, mix([0.32, 0.27, 0.2], [0.34, 0.62, 0.27], smooth(0.3, 0.95, air)));
    }
    const filled = Math.round(smooth(0.45, 0.95, air) * 50) / 50;
    pool.setEnabled(filled > 0);
    if (filled !== poolsAt) {
      poolsAt = filled;
      POOLS.forEach(([x, z, wide, squash], i) => Matrix.Compose(new Vector3(wide * filled, wide * filled * squash, 1), Quaternion.RotationAxis(Vector3.Right(), Math.PI / 2), new Vector3(x, 0.05, z)).copyToArray(poolMatrices, i * 16));
      pool.thinInstanceBufferUpdated("matrix");
    }
    paint(poolMat.diffuseColor, mix([0.03, 0.04, 0.08], mix([0.16, 0.3, 0.44], [0.28, 0.4, 0.52], shower), day));
    paint(foamMat.emissiveColor, mix([0.2, 0.24, 0.32], [0.86, 0.93, 1], day));

    // The aurora, at night, for as long as there is thick air.
    const lights = night * smooth(0.08, 0.5, air);
    aurora.setEnabled(lights > 0.01);
    auroraMat.alpha = lights * 0.8;
    curtains.uOffset = sols * 3;
    aurora.rotation.y = sols * 2.3;

    findLit();
    for (const { material, color } of lit) paint(material.emissiveColor, color, night);
  };
  tell();

  /** Moves the rain: every drop falls, and starts again at the top, round wherever the camera is. */
  const fall = (dt: number) => {
    rain.setEnabled(raining > 0.02);
    if (raining <= 0.02) return;
    rainClock += dt;
    rainMat.alpha = 0.34 * raining;
    const eye = camera.globalPosition;
    const wrap = (v: number, size: number) => ((v % size) + size) % size;
    for (let i = 0; i < DROPS; i++) {
      const o = i * 4;
      // (Each keeps its own place in a block of air that the camera moves through, so walking does not drag the rain along.)
      const x = eye.x + wrap(dropAt[o]! - eye.x, RAIN_WIDE) - RAIN_WIDE / 2;
      const z = eye.z + wrap(dropAt[o + 2]! - eye.z, RAIN_WIDE) - RAIN_WIDE / 2;
      const y = eye.y - RAIN_TALL / 2 + wrap(dropAt[o + 1]! - rainClock * dropAt[o + 3]! - eye.y, RAIN_TALL);
      drops[i * 16 + 12] = x;
      drops[i * 16 + 13] = Math.max(0.7, y);
      drops[i * 16 + 14] = z;
    }
    rain.thinInstanceBufferUpdated("matrix");
  };

  let since = 0;
  return {
    shadows,
    setShadows(on) {
      sun.shadowEnabled = on;
    },
    wade,
    wake,
    update(dt) {
      followHeight();
      fall(dt);
      stir(dt);
      // The sky moves slowly: a few times a second is plenty.
      since += dt;
      if (since < 0.1) return;
      since = 0;
      tell();
    },
  };
}
