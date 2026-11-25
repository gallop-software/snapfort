import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
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
import { groundTexture, landTexture, skyTexture, sunTexture } from "./textures";

/**
 * Mojave's scenery: a dry lakebed under a hard blue sky, the sun high and
 * white, shadows crisp. The building area is 960 m square and dead flat, with
 * nothing on it but its texture (the war draws its own things on the ground).
 * Everything else stands outside it, on the horizon: low mountains all round,
 * fields of solar panels, wind turbines and two launch towers with their
 * rockets. All of that is one mesh that never moves.
 *
 * Copied from the Meadow (2026-11-25) and changed from there; the two share no code.
 */

const HAZE = new Color3(0.92, 0.9, 0.85);
// The area is twice as wide as other worlds', and a general wants to see across it.
const FOG_START = 320, FOG_END = 2500;
const SHADOW_REACH = 150;
/** The ground runs out under the mountains' feet, well past the building area. */
const GROUND_SIZE = 3200;
/** Which way the sunlight travels. */
const SUNLIGHT = new Vector3(-0.42, -1, 0.34).normalize();

type RGB = readonly [number, number, number];

/**
 * Collects flat-coloured triangles for one mesh. Every face is shaded here,
 * once, by how it faces the sun, so the mesh needs no lighting when drawn.
 */
class Solid {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  /** A flat face of three or four corners in one colour (or one colour per corner). `lit` false leaves the colour as given. */
  face(points: readonly (readonly [number, number, number])[], color: RGB | readonly RGB[], lit = true): void {
    const [a, b, c] = [points[0]!, points[1]!, points[2]!];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    // Faces are seen from both sides, so a sloping face is taken to look upward; an upright one
    // could look either way, and gets the light of whichever side is sunnier. The sky fills in the rest.
    const toSun = -(nx * SUNLIGHT.x + ny * SUNLIGHT.y + nz * SUNLIGHT.z);
    const facing = ny > 0.05 ? Math.max(0, toSun) : ny < -0.05 ? Math.max(0, -toSun) : Math.abs(toSun);
    const shade = lit ? 0.55 + 0.55 * facing : 1;
    const base = this.positions.length / 3;
    points.forEach((p, i) => {
      this.positions.push(p[0], p[1], p[2]);
      const [r, g, b] = (typeof color[0] === "number" ? color : color[i]) as RGB;
      this.colors.push(Math.min(1, r * shade), Math.min(1, g * shade), Math.min(1, b * shade), 1);
    });
    for (let i = 1; i < points.length - 1; i++) this.indices.push(base, base + i, base + i + 1);
  }

  /** An upright box on the ground plan, turned `yaw` about the vertical. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: RGB, yaw = 0): void {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const at = (dx: number, dy: number, dz: number): [number, number, number] => [x + dx * cos + dz * sin, y + dy, z - dx * sin + dz * cos];
    const a = w / 2, e = d / 2;
    const low = [at(-a, 0, -e), at(a, 0, -e), at(a, 0, e), at(-a, 0, e)];
    const high = [at(-a, h, -e), at(a, h, -e), at(a, h, e), at(-a, h, e)];
    for (let i = 0; i < 4; i++) this.face([low[i]!, low[(i + 1) % 4]!, high[(i + 1) % 4]!, high[i]!], color);
    this.face(high, color);
  }

  /** An upright tube of `sides` flat sides, from radius `r0` at the bottom to `r1` at the top (0 for a point). */
  tube(x: number, y: number, z: number, r0: number, r1: number, h: number, sides: number, color: RGB): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const low0: [number, number, number] = [x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0];
      const low1: [number, number, number] = [x + Math.cos(a1) * r0, y, z + Math.sin(a1) * r0];
      const high0: [number, number, number] = [x + Math.cos(a0) * r1, y + h, z + Math.sin(a0) * r1];
      const high1: [number, number, number] = [x + Math.cos(a1) * r1, y + h, z + Math.sin(a1) * r1];
      if (r1 > 0) this.face([low0, low1, high1, high0], color);
      else this.face([low0, low1, high0], color);
    }
  }

  mesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions;
    data.colors = this.colors;
    data.indices = this.indices;
    data.applyToMesh(mesh);
    return mesh;
  }
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * A range of low desert mountains in a ring round the lakebed: bare faceted
 * rock, banded, paler and bluer toward its foot where the haze lies. `inner`
 * is how far out its foot starts; the ridge is `depth` further.
 */
function mountains(solid: Solid, seed: number, inner: number, depth: number, low: number, high: number, rock: RGB): void {
  const r = rng(seed);
  const columns = 120;
  const phases = [r() * 6.3, r() * 6.3, r() * 6.3, r() * 6.3];
  const foot: RGB = mix(rock, [HAZE.r, HAZE.g, HAZE.b], 0.5);
  const dark: RGB = [rock[0] * 0.8, rock[1] * 0.78, rock[2] * 0.8];
  // Rows from the foot to the ridge: an apron of fans, a shoulder, then the crest.
  const rows: [number, number, number][][] = [];
  for (let i = 0; i < columns; i++) {
    const a = (i / columns) * Math.PI * 2;
    // Peaks and saddles: slow swells with sharper teeth on top, never quite down to the ground.
    const swell = 0.5 + 0.28 * Math.sin(a * 3 + phases[0]!) + 0.16 * Math.sin(a * 7 + phases[1]!) + 0.1 * Math.sin(a * 17 + phases[2]!);
    const top = low + (high - low) * Math.max(0.04, Math.min(1, swell + (r() - 0.5) * 0.22));
    const out = 40 * Math.sin(a * 5 + phases[3]!) + (r() - 0.5) * 30;
    // Each point is nudged sideways too, so the slopes do not line up in panels like a fence.
    const at = (d: number, y: number): [number, number, number] => {
      const b = a + ((r() - 0.5) * 0.7 * Math.PI * 2) / columns;
      return [Math.cos(b) * (inner + out + d), y, Math.sin(b) * (inner + out + d)];
    };
    rows.push([at(0, -1), at(depth * 0.3, top * (0.1 + r() * 0.06)), at(depth * (0.6 + r() * 0.12), top * (0.5 + r() * 0.2)), at(depth, top), at(depth * 1.9, top * 0.5)]);
  }
  const colours: RGB[] = [foot, mix(foot, rock, 0.5), rock, dark, dark];
  for (let i = 0; i < columns; i++) {
    const a = rows[i]!, b = rows[(i + 1) % columns]!;
    for (let j = 0; j < 4; j++) {
      // Two triangles a square, split the same way every time, each with the colours of its own corners.
      const tint = 0.94 + r() * 0.12;
      const c0 = colours[j]!.map((v) => v * tint) as unknown as RGB, c1 = colours[j + 1]!.map((v) => v * tint) as unknown as RGB;
      solid.face([a[j]!, b[j]!, a[j + 1]!], [c0, c0, c1]);
      solid.face([b[j]!, b[j + 1]!, a[j + 1]!], [c0, c1, c1]);
    }
  }
}

/** A field of solar panels: long rows tilted to the south (-z), dark blue, on a pale service pad. */
function solarField(solid: Solid, x: number, z: number, yaw: number, rows: number, length: number): void {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const at = (dx: number, y: number, dz: number): [number, number, number] => [x + dx * cos + dz * sin, y, z - dx * sin + dz * cos];
  const glass: RGB = [0.1, 0.16, 0.3], back: RGB = [0.25, 0.27, 0.3], rim: RGB = [0.82, 0.86, 0.9];
  const pitch = 13;
  for (let i = 0; i < rows; i++) {
    const dz = (i - (rows - 1) / 2) * pitch;
    const a = length / 2;
    // The panel leans back: its low edge to the front, its high edge behind, with a bright rim along the top.
    solid.face([at(-a, 1.2, dz - 3.2), at(a, 1.2, dz - 3.2), at(a, 6.6, dz + 3.2), at(-a, 6.6, dz + 3.2)], glass, false);
    solid.face([at(-a, 6.6, dz + 3.2), at(a, 6.6, dz + 3.2), at(a, 7.1, dz + 3.4), at(-a, 7.1, dz + 3.4)], rim, false);
    // What holds it up, seen from behind and from the ends.
    solid.face([at(-a, 0, dz + 3.3), at(a, 0, dz + 3.3), at(a, 6.6, dz + 3.3), at(-a, 6.6, dz + 3.3)], back, false);
  }
  // The inverter house at one end.
  solid.box(...at(length / 2 + 14, 0, 0), 10, 6, 16, [0.86, 0.87, 0.86], yaw);
}

/** A wind turbine: a white tapering mast, a nacelle, and three blades stopped where they were (they do not turn: nothing here costs a frame). */
function turbine(solid: Solid, x: number, z: number, height: number, turn: number, facing: number): void {
  const white: RGB = [0.93, 0.94, 0.95];
  solid.tube(x, 0, z, height * 0.035, height * 0.018, height, 6, white);
  const cos = Math.cos(facing), sin = Math.sin(facing);
  solid.box(x, height - 1.6, z, 4.4, 3.6, 11, white, facing);
  // The hub sits out in front of the mast, the blades in a plane across the wind.
  const hx = x + sin * 6.5, hz = z + cos * 6.5, hy = height + 0.2;
  const span = height * 0.62;
  for (let k = 0; k < 3; k++) {
    const a = turn + (k / 3) * Math.PI * 2;
    // Along the blade and across it, in the rotor's plane.
    const ax = Math.sin(a) * cos, ay = Math.cos(a), az = -Math.sin(a) * sin;
    const cx = Math.cos(a) * cos, cy = -Math.sin(a), cz = -Math.cos(a) * sin;
    const p = (along: number, across: number): [number, number, number] => [hx + ax * along + cx * across, hy + ay * along + cy * across, hz + az * along + cz * across];
    solid.face([p(0, -1.5), p(span * 0.25, -2.4), p(span, -0.4), p(span, 0.4), p(0, 1.5)], white);
  }
}

/**
 * A launch site: a tall black lattice tower with two catch arms, a stainless
 * rocket standing beside it on its mount (booster, black-banded ship, pointed
 * nose and fins), and white tanks in a row.
 */
function launchSite(solid: Solid, x: number, z: number, yaw: number, stacked: boolean): void {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const at = (dx: number, dz: number): [number, number] => [x + dx * cos + dz * sin, z - dx * sin + dz * cos];
  const black: RGB = [0.13, 0.14, 0.16], steel: RGB = [0.8, 0.83, 0.87], white: RGB = [0.94, 0.95, 0.95], grey: RGB = [0.5, 0.52, 0.55];
  // The tower: four dark corner posts with platforms between (it reads as open work from far off).
  const [tx, tz] = at(0, 0);
  const tall = 148;
  for (const [dx, dz] of [[-5, -5], [5, -5], [5, 5], [-5, 5]] as const) {
    const [px, pz] = at(dx, dz);
    solid.box(px, 0, pz, 2.2, tall, 2.2, black, yaw);
  }
  for (let y = 10; y < tall; y += 11.5) solid.box(tx, y, tz, 12.4, 2.6, 12.4, black, yaw);
  solid.box(tx, tall, tz, 14, 3, 14, grey, yaw);
  solid.tube(tx, tall + 3, tz, 0.9, 0.2, 22, 4, grey);
  // The catch arms, reaching toward the rocket.
  for (const side of [-1, 1]) {
    const [ax, az] = at(20, side * 6.5);
    solid.box(ax, stacked ? 104 : 78, az, 34, 4.2, 2.4, black, yaw);
  }
  // The launch mount and the rocket on it.
  const [rx, rz] = at(22, 0);
  solid.tube(rx, 0, rz, 9.5, 8, 16, 8, grey);
  const booster = 62;
  solid.tube(rx, 16, rz, 5.4, 5.4, booster, 10, steel);
  solid.tube(rx, 16, rz, 5.7, 5.7, 4, 10, black);
  if (stacked) {
    solid.tube(rx, 16 + booster, rz, 5.55, 5.55, 3.5, 10, black);
    solid.tube(rx, 19.5 + booster, rz, 5.4, 5.4, 28, 10, steel);
    solid.tube(rx, 47.5 + booster, rz, 5.4, 0.4, 18, 10, steel);
    // The ship's fins: two below, two smaller by the nose.
    for (const side of [-1, 1]) {
      const fin = (y: number, h: number, w: number) => {
        const [fx, fz] = at(22, side * (5.2 + w / 2));
        solid.box(fx, y, fz, 0.8, h, w, black, yaw);
      };
      fin(19.5 + booster, 13, 5.5);
      fin(45 + booster, 9, 3.6);
    }
  } else {
    // A booster alone, back from a flight: its grid fins out at the top.
    solid.tube(rx, 16 + booster, rz, 5.55, 5.55, 3, 10, black);
    for (const side of [-1, 1]) {
      const [fx, fz] = at(22, side * 7.8);
      solid.box(fx, 12 + booster, fz, 3.4, 1, 5, grey, yaw);
    }
  }
  // The tank farm: white upright tanks in a row behind.
  for (let i = 0; i < 5; i++) {
    const [fx, fz] = at(-34 - i * 13, 26);
    solid.tube(fx, 0, fz, 5, 5, 30 + (i % 2) * 6, 8, white);
    solid.tube(fx, 30 + (i % 2) * 6, fz, 5, 1.2, 3.5, 8, white);
  }
}

/** Everything on the horizon, outside the building area, as one mesh. */
function horizon(scene: Scene): Mesh {
  const solid = new Solid();
  // Two ranges: a nearer, lower, redder one, and a higher, bluer one behind that shows through its gaps.
  mountains(solid, 61, 880, 110, 14, 120, [0.6, 0.5, 0.44]);
  mountains(solid, 97, 1010, 150, 60, 230, [0.56, 0.52, 0.55]);

  solarField(solid, -330, 640, 0.12, 9, 300);
  solarField(solid, 690, -250, 1.5, 8, 260);
  solarField(solid, -150, -690, 3.2, 7, 340);

  const r = rng(733);
  // Two wind farms, in loose rows along the foot of the mountains.
  for (let i = 0; i < 9; i++) turbine(solid, -640 - (i % 3) * 40 + r() * 16, -330 + i * 78 + r() * 24, 88 + r() * 14, r() * 2, 1.2 + r() * 0.2);
  for (let i = 0; i < 7; i++) turbine(solid, -60 + i * 70 + r() * 20, 680 + (i % 2) * 46 + r() * 16, 88 + r() * 14, r() * 2, 2.6 + r() * 0.2);

  launchSite(solid, 560, 545, 0.8, true);
  launchSite(solid, -590, -515, 4.0, false);

  const mesh = solid.mesh("mojave-horizon", scene);
  const material = new StandardMaterial("mojave-horizon", scene);
  // Its faces were shaded as they were built: drawn at their own colours, hazed only by the fog.
  material.disableLighting = true;
  material.emissiveColor = Color3.White();
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.freezeWorldMatrix();
  material.freeze();
  return mesh;
}

/** Mojave: a white lakebed, a ring of mountains, a blue sky and a hot high sun. */
export function scenery(scene: Scene, camera: Camera): Scenery {
  scene.clearColor = new Color4(HAZE.r, HAZE.g, HAZE.b, 1);
  scene.ambientColor = new Color3(0, 0, 0);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = HAZE;
  scene.fogStart = FOG_START;
  scene.fogEnd = FOG_END;

  // Less light from the sky and more from the sun than in the Meadow, and the two together only
  // just reach full brightness on the ground, so a shadow is plainly darker: hard light, crisp shadows.
  const ambient = new HemisphericLight("ambient", new Vector3(0.2, 1, 0.1), scene);
  ambient.intensity = 0.54;
  ambient.diffuse = new Color3(0.9, 0.95, 1);
  // The pale ground throws a lot of warm light back up.
  ambient.groundColor = new Color3(0.86, 0.78, 0.66);
  ambient.specular = Color3.Black();

  const sun = new DirectionalLight("sun", SUNLIGHT.clone(), scene);
  sun.intensity = 0.54;
  sun.diffuse = new Color3(1, 0.985, 0.94);
  sun.specular = new Color3(1, 0.98, 0.92);

  // Two 1024 cascades: crisp near the builder at a sixth of the cost of three 2048 ones.
  const shadows = new CascadedShadowGenerator(1024, sun, undefined, camera);
  shadows.numCascades = 2;
  shadows.shadowMaxZ = SHADOW_REACH;
  shadows.lambda = 0.85;
  shadows.stabilizeCascades = true;
  shadows.cascadeBlendPercentage = 0.08;
  shadows.bias = 0.004;
  shadows.normalBias = 0.02;
  shadows.setDarkness(0.22);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;

  // Sky dome: wide enough that the mountains stand in front of it.
  const sky = CreateSphere("sky", { diameter: 3900, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
  const skyMat = new StandardMaterial("sky", scene);
  skyMat.disableLighting = true;
  skyMat.emissiveTexture = skyTexture(scene);
  skyMat.diffuseColor = Color3.Black();
  skyMat.specularColor = Color3.Black();
  skyMat.fogEnabled = false;
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.applyFog = false;

  // The sun itself, where the light comes from: a disc and its glare, added to the sky behind.
  const disc = CreatePlane("sun-disc", { size: 620 }, scene);
  const discMat = new StandardMaterial("sun-disc", scene);
  discMat.disableLighting = true;
  discMat.diffuseColor = Color3.Black();
  discMat.specularColor = Color3.Black();
  discMat.emissiveColor = new Color3(1, 0.97, 0.86);
  discMat.opacityTexture = sunTexture(scene);
  discMat.alphaMode = Constants.ALPHA_ADD;
  discMat.disableDepthWrite = true;
  discMat.fogEnabled = false;
  disc.material = discMat;
  disc.position.copyFrom(SUNLIGHT.scale(-1700));
  disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
  disc.infiniteDistance = true;
  disc.isPickable = false;
  disc.applyFog = false;

  horizon(scene);

  // Ground: dead flat at y = 0. The small cracked tile repeats every two cells; the lie of the land is laid once over all of it.
  const ground = new Mesh("ground", scene);
  const h = GROUND_SIZE / 2;
  const uv = h / (CELL * 2);
  const data = new VertexData();
  data.positions = [-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h];
  data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  data.uvs = [-uv, -uv, uv, -uv, uv, uv, -uv, uv];
  data.uvs2 = [0, 0, 1, 0, 1, 1, 0, 1];
  data.indices = [0, 1, 2, 0, 2, 3];
  data.applyToMesh(ground);
  const groundMat = new StandardMaterial("ground", scene);
  groundMat.diffuseTexture = groundTexture(scene);
  const land = landTexture(scene);
  land.coordinatesIndex = 1;
  groundMat.ambientTexture = land;
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
  ground.receiveShadows = true;
  ground.isPickable = false;
  const groundShape = new PhysicsShapeBox(new Vector3(0, -1, 0), Quaternion.Identity(), new Vector3(GROUND_SIZE, 2, GROUND_SIZE), scene);
  const groundBody = new PhysicsBody(ground, PhysicsMotionType.STATIC, false, scene);
  groundBody.shape = groundShape;
  groundBody.disableSync = true;

  // Up a tall tower the ground is further away: push the fog and the shadows'
  // reach out with height, so the view down stays clear and shadowed.
  let lastHeight = 0;
  const followHeight = () => {
    const h = Math.max(0, camera.globalPosition.y);
    if (Math.abs(h - lastHeight) < 2) return;
    lastHeight = h;
    scene.fogStart = FOG_START + h;
    scene.fogEnd = FOG_END + h * 1.5;
    shadows.shadowMaxZ = SHADOW_REACH + h * 0.9;
  };

  return {
    shadows,
    setShadows(on) {
      sun.shadowEnabled = on;
    },
    update() {
      followHeight();
    },
  };
}
