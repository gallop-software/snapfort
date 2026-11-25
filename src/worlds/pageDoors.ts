import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildState } from "../game/buildState";
import type { Environment } from "../game/environments";
import type { MaterialId, PieceSpec, PieceType } from "../game/pieces";

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
  /**
   * Things of this world's own to pick on the hotbar, after the shared ones.
   * Picking one hands aiming and clicking to the world's feature (`aimTool`, `useTool`).
   */
  tools?: readonly WorldTool[];
  /**
   * Starts whatever this world has that no other does (vehicles, say), once
   * the game is set up. Optional. It reaches the game only through `game`.
   */
  start?(game: PageGame): WorldFeature;
}

/** Something of a world's own on the hotbar. */
export interface WorldTool {
  /** Not the name of any piece. */
  id: string;
  label: string;
  /** The letter key that picks it (one no shared tool uses). */
  key: string;
  /** Its picture: the inside of a 40 by 40 SVG, drawn in lines. */
  icon: string;
}

/** The running game, as a world's own page code sees it. */
export interface PageGame {
  scene: Scene;
  shadows: CascadedShadowGenerator;
  env: Environment;
  /** The build. Read it; never change it. */
  build: BuildState;
  /** This player: where their body's centre is, and whether they are thrown, falling or getting up. */
  player: {
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    readonly knockedDown: boolean;
    /** Puts the player's body centre here and holds them still this frame (riding something). */
    seat(x: number, y: number, z: number): void;
    /** Puts the player's body centre here, in the air, this frame (flying with something of the world's own): drawn gliding, and seen so by everyone. */
    fly(x: number, y: number, z: number): void;
  };
  /**
   * Draws a builder (this player or anyone else, by id) sitting on a seat,
   * turned whichever way the seat is, until called again with null. For this
   * player, also call `player.seat` each frame (that is where the camera looks).
   */
  ride(playerId: string, seat: Ride | null): void;
  /** Which way the player looks, radians about the vertical. */
  viewYaw(): number;
  /** How far down the player looks, radians (level is 0; up is negative). */
  viewPitch(): number;
  /** This player's id in the shared world ("" until joined). */
  myId(): string;
  /** Sends a message to this world's server half (see WorldServer.message). */
  send(data: unknown): void;
  toast(text: string, ms?: number): void;
  /** For sounds of the world's own. */
  sound: SoundKit;
  /** True on phones and tablets. */
  touch: boolean;
  /** The spot under the crosshair within `range` metres (on the ground or anything solid), or null. */
  aim(range: number): [number, number, number] | null;
  /** Whether this player may build here (false: visiting). */
  mayBuild(): boolean;
  /** Shows a few words of the world's own above the hotbar (HTML), or takes them away (null). */
  panel(html: string | null): void;
  /** The other worlds there are: somewhere to go. */
  worlds(): { id: string; name: string }[];
  /**
   * Leaves for another world, still playing: its page opens in place of this
   * one, and is handed `note` (plain data) as its `arrival`.
   */
  travel(worldId: string, note: unknown): void;
  /** What the page of the world this player just came from handed over (see `travel`), or null. */
  arrival(): unknown;
  /**
   * Pulls the camera back to this many metres behind the player, through
   * anything in the way (to watch something big they are riding); null puts
   * it back over the shoulder.
   */
  chase(distance: number | null): void;
  /** Turns the player's view up or down: `pitch` radians below level (as `viewPitch` gives it). */
  look(pitch: number): void;
}

/** What a world's own page code does each frame, and when asked. Every hook is optional. */
export interface WorldFeature {
  /** A message from this world's server half. */
  message?(data: unknown): void;
  /** Joined (or joined again): forget what was known; the server sends it afresh. */
  joined?(): void;
  /**
   * Moves the player in place of walking, straight after physics. Return true
   * when it did (the player is riding something), false to let them walk.
   */
  drive?(dt: number, input: DriveInput): boolean;
  /** Once a frame, before drawing. */
  update?(dt: number): void;
  /** The key for getting on and off things was pressed: return true when that was for this world's own thing. */
  board?(): boolean;
  /** What to tell the player about getting on or off something, when anything: a line for the screen and a label for the button on phones. */
  prompt?(): { text: string; button: string } | null;
  /** True while the player's hands are busy with something of this world's (no building). */
  busy?(): boolean;
  /** While busy, the player clicked (or tapped the main button). */
  act?(): void;
  /** One of this world's tools is picked, and the player is playing: called every frame, to show where it would go. */
  aimTool?(id: string): void;
  /** One of this world's tools is picked, and the player clicked. */
  useTool?(id: string): void;
  /** True when something of this world's own stands where this piece would go, so it cannot be built there (the server says the same: WorldServer.blocks). */
  blocks?(spec: PieceSpec): boolean;
  /** The Remove tool is picked and the crosshair is not on a piece: called every frame, to show what of this world's own it would take away (if anything). */
  aimRemove?(): void;
  /** The player used Remove (the tool, or the right button) and the crosshair was not on a piece: take away what of this world's own is there. True when something was. */
  remove?(): boolean;
}

/** A seat a builder sits on: where its surface is, and how it is turned (radians: about the vertical, nose down, and rolled). */
export interface Ride {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

/** What the player is pressing, as for walking. */
export interface DriveInput {
  /** -1..1, positive is to the right of the view. */
  strafe: number;
  /** -1..1, positive is forward. */
  forward: number;
  run: boolean;
  jump: boolean;
  /** The way the player looks. */
  yaw: number;
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
  /**
   * Parts that can be shown and hidden by name (all hidden to start with).
   * "glide" is shown while the builder flies down under control at the end of
   * a throw (see Fall.glideFrom).
   */
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
  /**
   * A shot has just been fired at `to` and arrives in `seconds`: for anything
   * of the world's own shown at the target meanwhile (a marker everyone sees).
   * Optional.
   */
  mark?(to: readonly [number, number, number], seconds: number): void;
  /** True when what it throws has a nose: it is turned to point the way it is going (drawn nose toward +z). Optional. */
  pointed?: boolean;
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
  /** A builder's way back from a throw starts (see Fall.glideFrom), for `seconds`. Optional. */
  glide?(kit: SoundKit, seconds: number): void;
}
