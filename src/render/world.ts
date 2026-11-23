import type { Camera } from "@babylonjs/core/Cameras/camera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import { Scene } from "@babylonjs/core/scene";
import { CELL } from "../game/constants";
import { MEADOW, type Environment } from "../game/environments";
import { earthTexture, groundTexture, moonGroundTexture, skyTexture, starTexture } from "./textures";

const HORIZON = new Color3(0.98, 0.91, 0.78);
/** The Moon's horizon: a thin dark haze, so far-off towers fade into the black. */
const MOON_HAZE = new Color3(0.06, 0.06, 0.09);
const GROUND_SIZE = 2400;

export interface World {
  shadows: CascadedShadowGenerator;
  /** Live sun shadows on or off (battery saver turns them off). */
  setShadows(on: boolean): void;
  update(dt: number): void;
}

/**
 * Sky, sun, shadows and the flat ground everything is built on: the meadow
 * (soft sky, drifting clouds, warm haze) or the Moon (black sky full of stars,
 * the Earth above the horizon, a harsh white sun and long sharp shadows, grey
 * cratered dust).
 */
export function createWorld(scene: Scene, camera: Camera, env: Environment = MEADOW): World {
  const moon = env.id === "moon";
  const haze = moon ? MOON_HAZE : HORIZON;
  const fogStart = moon ? 260 : 140, fogEnd = moon ? 1100 : 700;
  scene.clearColor = new Color4(haze.r, haze.g, haze.b, 1);
  scene.ambientColor = new Color3(0, 0, 0);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = haze;
  scene.fogStart = fogStart;
  scene.fogEnd = fogEnd;

  const ambient = new HemisphericLight("ambient", new Vector3(0.2, 1, 0.1), scene);
  ambient.intensity = moon ? 0.5 : 0.74;
  ambient.diffuse = moon ? new Color3(0.82, 0.86, 1) : new Color3(0.93, 0.97, 1);
  ambient.groundColor = moon ? new Color3(0.34, 0.34, 0.38) : new Color3(0.78, 0.72, 0.64);
  ambient.specular = Color3.Black();

  // On the Moon the sun is lower, brighter and white: long, sharp shadows.
  const sun = new DirectionalLight("sun", (moon ? new Vector3(-0.8, -0.55, 0.45) : new Vector3(-0.55, -1, 0.4)).normalize(), scene);
  sun.intensity = moon ? 0.95 : 0.62;
  sun.diffuse = moon ? new Color3(1, 1, 0.98) : new Color3(1, 0.95, 0.84);
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
  shadows.setDarkness(moon ? 0.62 : 0.42);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;

  // Sky dome.
  const sky = CreateSphere("sky", { diameter: 1800, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
  const skyMat = new StandardMaterial("sky", scene);
  skyMat.disableLighting = true;
  skyMat.emissiveTexture = moon ? starTexture(scene) : skyTexture(scene);
  skyMat.diffuseColor = Color3.Black();
  skyMat.specularColor = Color3.Black();
  skyMat.fogEnabled = false;
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.applyFog = false;

  // Clouds: one squashed ball drawn many times.
  const cloud = CreateSphere("cloud", { diameter: 1, segments: 6 }, scene);
  const cloudMat = new StandardMaterial("cloud", scene);
  cloudMat.disableLighting = true;
  cloudMat.emissiveColor = new Color3(1, 0.99, 0.96);
  cloudMat.fogEnabled = false;
  cloud.material = cloudMat;
  cloud.isPickable = false;
  cloud.alwaysSelectAsActiveMesh = true;
  const cloudMatrices: number[] = [];
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 16; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 320 + rand() * 480;
    const centre = new Vector3(Math.cos(angle) * radius, 150 + rand() * 90, Math.sin(angle) * radius);
    const puffs = 3 + Math.floor(rand() * 3);
    for (let p = 0; p < puffs; p++) {
      const size = 45 + rand() * 50;
      const offset = new Vector3((p - puffs / 2) * 38 + rand() * 12, rand() * 10, rand() * 26);
      const m = Matrix.Compose(new Vector3(size * 1.5, size * 0.5, size), Quaternion.Identity(), centre.add(offset));
      cloudMatrices.push(...m.asArray());
    }
  }
  cloud.thinInstanceSetBuffer("matrix", new Float32Array(cloudMatrices), 16, true);
  // No air on the Moon: no clouds. The Earth hangs above the horizon instead.
  cloud.setEnabled(!moon);
  if (moon) {
    const earth = CreateSphere("earth", { diameter: 150, segments: 32 }, scene);
    const earthMat = new StandardMaterial("earth", scene);
    earthMat.disableLighting = true;
    earthMat.emissiveTexture = earthTexture(scene);
    earthMat.diffuseColor = Color3.Black();
    earthMat.specularColor = Color3.Black();
    earthMat.fogEnabled = false;
    earth.material = earthMat;
    earth.applyFog = false;
    earth.infiniteDistance = true;
    earth.isPickable = false;
    // Far off to the north-east, a fair way up the sky, turned to show its oceans.
    earth.position.set(330, 250, 680);
    earth.rotation.set(0.35, 2.2, 0.2);
  }

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
  groundMat.diffuseTexture = moon ? moonGroundTexture(scene) : groundTexture(scene);
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
    scene.fogStart = fogStart + h;
    scene.fogEnd = fogEnd + h * 1.5;
    shadows.shadowMaxZ = 110 + h * 0.9;
  };

  return {
    shadows,
    setShadows(on) {
      sun.shadowEnabled = on;
    },
    update(dt) {
      cloud.rotation.y += dt * 0.004;
      followHeight();
    },
  };
}
