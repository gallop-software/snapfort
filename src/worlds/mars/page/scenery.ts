import type { Camera } from "@babylonjs/core/Cameras/camera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
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
import { discTexture, glowTexture, hazeTexture, marsGroundTexture, phobosTexture, starTexture } from "./textures";

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
  const place = (mesh: Mesh, [x, y, z]: RGB) => mesh.position.set(x * FAR, y * FAR, z * FAR);
  /** Sets everything that depends on the hour. */
  const tell = () => {
    const sols = held ?? solsAt(Date.now());
    const height = sunHeight(sols), day = daylight(sols), low = dusk(sols), night = 1 - day;
    const toSun = sunDirection(sols);

    // The sky's colours: night, through dusk, to day.
    const high = smooth(0, 0.24, height);
    const zenith = mix(NIGHT.zenith, mix(DUSK.zenith, DAY.zenith, high), day);
    const horizon = mix(NIGHT.horizon, mix(DUSK.horizon, DAY.horizon, high), day);
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
    paint(sunHalo.material.emissiveColor, mix([1, 0.9, 0.74], [0.22, 0.5, 1], low), 0.5 + 0.5 * low);
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

    findLit();
    for (const { material, color } of lit) paint(material.emissiveColor, color, night);
  };
  tell();

  let since = 0;
  return {
    shadows,
    setShadows(on) {
      sun.shadowEnabled = on;
    },
    update(dt) {
      followHeight();
      // The sky moves slowly: a few times a second is plenty.
      since += dt;
      if (since < 0.1) return;
      since = 0;
      tell();
    },
  };
}
