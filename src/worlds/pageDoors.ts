import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { MaterialId, PieceType } from "../game/pieces";

/**
 * The page half of a world: everything a world draws and plays itself. The
 * shared drawing machinery (pieces, the builder's skeleton, cameras, the siege
 * engine's aiming and stones) asks a world for these and nothing else, so a
 * world can look and sound however it likes without touching shared code.
 *
 * These are the fixed doors. Add to them; never change what an existing one means.
 */
export interface WorldPage {
  /** Sky, sun, shadows and the ground. */
  scenery(scene: Scene, camera: Camera): Scenery;
  /** The look of one kind of piece in one material. */
  pieceSkin(type: PieceType, material: MaterialId, scene: Scene): PieceSkin;
  /** Dresses a builder: adds body parts to the shared skeleton. */
  outfit: OutfitBuilder;
  /** The siege engine above its turntable. */
  siegeModel(scene: Scene): SiegeModel;
  sounds: SoundTable;
  /** Colour of the dust where things break, RGB 0..1. */
  dust: readonly [number, number, number];
}

export interface Scenery {
  shadows: CascadedShadowGenerator;
  /** Live sun shadows on or off (battery saver turns them off). */
  setShadows(on: boolean): void;
  update(dt: number): void;
}

export interface PieceSkin {
  /**
   * Near-white line work covering the whole face of a piece; the material's
   * colour is multiplied in per piece. The spot at PLAIN_UV (see
   * render/geometry.ts) must stay free of lines.
   */
  texture: Texture;
  /** How shiny: 0 matt, up to 1. */
  specular: number;
}

/**
 * The shared skeleton a world dresses. Joints come in pairs, left then right.
 * Hips hang from an upright pelvis at 0.9 m; knees 0.45 m below the hips;
 * shoulders at 1.46 m, 0.32 m out; elbows 0.31 m below the shoulders. `body`
 * carries everything above the legs, with its origin at the feet.
 */
export interface OutfitRig {
  scene: Scene;
  body: TransformNode;
  hips: readonly TransformNode[];
  knees: readonly TransformNode[];
  shoulders: readonly TransformNode[];
  elbows: readonly TransformNode[];
  /** Hangs a part on a joint at an offset from it. */
  add(mesh: Mesh, material: StandardMaterial, parent: TransformNode, x: number, y: number, z: number): Mesh;
  /** A plain matt colour that every builder in the scene shares, by name. */
  shared(name: string, r: number, g: number, b: number): StandardMaterial;
  /** A plain matt colour of this builder's own (for the part in the player's colour). */
  own(name: string, hex: string): StandardMaterial;
}

export interface Outfit {
  /** The material that takes the player's colour. */
  tint: StandardMaterial;
  /** Parts that can be shown and hidden by name (all hidden to start with). */
  extras?: Record<string, Mesh[]>;
}

export type OutfitBuilder = (rig: OutfitRig, color: string) => Outfit;

export interface SiegeModel {
  /** One merged mesh, coloured by vertex, with its origin on top of the turntable, throwing toward +z. */
  frame: Mesh;
  /** One merged mesh drawn upright with its origin at the pivot. */
  arm: Mesh;
  /** Height of the arm's pivot above the turntable. */
  pivot: number;
  /** Arm angle (about the throwing axis) when wound back, and at the top of a throw. */
  cocked: number;
  thrown: number;
  /** Seconds for the arm to swing over. */
  swing: number;
  /** A new stone (or whatever this engine throws), `radius` metres across the middle. */
  stone(radius: number): Mesh;
}

/** What a world's sounds are made with: the game ships no audio files. */
export interface SoundKit {
  /** A note sliding from one pitch to another (Hz), fading out over `duration` seconds. */
  tone(type: OscillatorType, from: number, to: number, duration: number, gain: number, delay?: number): void;
  /** A burst of hiss below `cutoff` Hz. */
  noise(duration: number, gain: number, cutoff: number): void;
}

/** Every sound the game asks for. `near` runs from 0 (far off) to 1 (right here). */
export interface SoundTable {
  yelp(kit: SoundKit): void;
  launch(kit: SoundKit): void;
  boom(kit: SoundKit, near: number): void;
  place(kit: SoundKit): void;
  remove(kit: SoundKit): void;
  edit(kit: SoundKit): void;
  undo(kit: SoundKit): void;
  redo(kit: SoundKit): void;
  select(kit: SoundKit): void;
  chat(kit: SoundKit): void;
  ping(kit: SoundKit): void;
  rotate(kit: SoundKit): void;
  deny(kit: SoundKit): void;
  knock(kit: SoundKit): void;
  crumble(kit: SoundKit): void;
  horn(kit: SoundKit): void;
  caught(kit: SoundKit): void;
}
