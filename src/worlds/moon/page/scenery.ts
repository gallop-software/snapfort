import type { Camera } from "@babylonjs/core/Cameras/camera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import { Scene } from "@babylonjs/core/scene";
import { CELL } from "../../../game/constants";
import type { Scenery } from "../../pageDoors";
import { earthTexture, moonGroundTexture, starTexture } from "./textures";

/** The horizon: a thin dark haze, so far-off towers fade into the black. */
const HAZE = new Color3(0.06, 0.06, 0.09);
const FOG_START = 260, FOG_END = 1100;
const GROUND_SIZE = 2400;

/**
 * The Moon: a black sky full of stars, the Earth above the horizon, a harsh
 * white sun and long sharp shadows, and grey cratered dust to build on.
 */
export function scenery(scene: Scene, camera: Camera): Scenery {
  scene.clearColor = new Color4(HAZE.r, HAZE.g, HAZE.b, 1);
  scene.ambientColor = new Color3(0, 0, 0);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = HAZE;
  scene.fogStart = FOG_START;
  scene.fogEnd = FOG_END;

  const ambient = new HemisphericLight("ambient", new Vector3(0.2, 1, 0.1), scene);
  ambient.intensity = 0.5;
  ambient.diffuse = new Color3(0.82, 0.86, 1);
  ambient.groundColor = new Color3(0.34, 0.34, 0.38);
  ambient.specular = Color3.Black();

  // The sun is low, bright and white: long, sharp shadows.
  const sun = new DirectionalLight("sun", new Vector3(-0.8, -0.55, 0.45).normalize(), scene);
  sun.intensity = 0.95;
  sun.diffuse = new Color3(1, 1, 0.98);
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
  shadows.setDarkness(0.62);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;

  // Sky dome.
  const sky = CreateSphere("sky", { diameter: 1800, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
  const skyMat = new StandardMaterial("sky", scene);
  skyMat.disableLighting = true;
  skyMat.emissiveTexture = starTexture(scene);
  skyMat.diffuseColor = Color3.Black();
  skyMat.specularColor = Color3.Black();
  skyMat.fogEnabled = false;
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.applyFog = false;

  // No air on the Moon: no clouds. The Earth hangs above the horizon instead.
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
  groundMat.diffuseTexture = moonGroundTexture(scene);
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
    shadows.shadowMaxZ = 110 + h * 0.9;
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
