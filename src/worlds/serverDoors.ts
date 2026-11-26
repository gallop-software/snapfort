import type { BuildState } from "../game/buildState";
import type { Environment } from "../game/environments";
import type { Fall } from "../game/fall";
import type { Piece } from "../game/pieces";
import type { Box } from "../game/solids";
import type { Flight, Vec } from "../game/trebuchet";

/**
 * The server half of a world: rules of its own, beyond the shared ones. Every
 * hook is optional. A world's server code reaches the shared world only
 * through the Room these hooks are handed, never by importing the server itself.
 *
 * These are the fixed doors. Add to them; never change what an existing one means.
 */
export interface WorldServer {
  /**
   * A room of this world wakes up (they sleep when empty, and forget): returns
   * this world's own memory for it, kept as `room.memory`. Keep nothing in
   * module variables: several rooms of one world can share a process.
   */
  open?(room: Room): unknown;
  /**
   * A builder is thrown by a stone's impact. Return the flight they take
   * instead of the ordinary one (`hit.fall`), or null to leave it be. The
   * flight is sent to every page and played as given, so it must be complete:
   * a point every tenth of a second, the landing last.
   */
  thrown?(hit: Thrown, room: Room): Fall | null;
  /** A builder has joined and been sent the shared world: send them this world's own things. */
  joined?(room: Room, playerId: string): void;
  left?(room: Room, playerId: string): void;
  /** A world message from a builder's page (see WorldPage.start): anything at all, so check it. */
  message?(room: Room, playerId: string, data: unknown): void;
  /**
   * Something of this world's own that a shot hits on its way: when (seconds
   * into the flight) and where. The shot lands there if that is before
   * anything the shared rules say it hits. Null when it hits nothing of the world's.
   */
  shotHits?(room: Room, flight: Flight): { time: number; point: Vec } | null;
  /** A stone (or whatever this world's engine throws) landed at `point`, after the shared rules dealt with it. */
  struck?(room: Room, point: Vec): void;
  /** Pieces were taken out of the build (removed, broken or fallen). */
  removed?(room: Room, pieces: readonly Piece[]): void;
  /**
   * A builder wants to put this piece in the build: true when something of
   * this world's own stands where it would go, so it cannot.
   */
  blocks?(room: Room, piece: Piece): boolean;
  /**
   * This world's own solid things just now, as boxes in metres (see
   * `Room.solidThings`): thrown builders land on them and are stopped by
   * them, stones burst on them. Optional: none.
   */
  solids?(room: Room): readonly Box[];
  /**
   * A builder wants to put this piece in the build: false refuses it (as
   * `blocks` does, but knowing who asks). After the action it came in,
   * `placed` is always told what really went in (perhaps nothing).
   */
  mayPlace?(room: Room, playerId: string, piece: Piece): boolean;
  /** The pieces a builder's action put in the build, once it is settled (called whenever `mayPlace` was asked, even with none). */
  placed?(room: Room, playerId: string, pieces: readonly Piece[]): void;
  /** A builder wants to remove or edit this piece: false refuses it (a world may say whose a piece is). */
  mayChange?(room: Room, playerId: string, piece: Piece, kind: "remove" | "edit"): boolean;
  /**
   * Another world's server half sent this world something (see Room.toWorld):
   * anything at all, so check it. What is returned (plain data) is that
   * world's answer.
   */
  fromWorld?(room: Room, fromWorldId: string, data: unknown): unknown;
}

export interface Thrown {
  /** The build as it stands (after the impact). Read it; never change it. */
  build: BuildState;
  env: Environment;
  /** Who is thrown. */
  playerId: string;
  /** Where the builder's body centre was, and the speed the impact gave them. */
  from: Vec;
  v: Vec;
  /** The flight the shared rules planned from that. */
  fall: Fall;
}

/** One shared world, as a world's own server code sees it. */
export interface Room {
  env: Environment;
  /** The build. Read it; never change it. */
  build: BuildState;
  /** What `open` returned. */
  memory: unknown;
  /** The ids of everyone in the room. */
  players(): string[];
  /** Where a builder's body centre was last known to be, or null (unknown, or no such builder). */
  positionOf(playerId: string): Vec | null;
  /** Whether that builder is in the air or getting up from a throw or fall. */
  isDown(playerId: string): boolean;
  /** Sends a world message to one builder's page, or to everyone's (but `exceptId`'s). */
  send(playerId: string, data: unknown): void;
  broadcast(data: unknown, exceptId?: string): void;
  /** Sends a builder along a flight, as a stone's hit does: every page plays it. */
  fly(playerId: string, fall: Fall): void;
  /** Runs `fn` after `ms` (the room stays awake until then). */
  later(ms: number, fn: () => void): void;
  /** Whether that builder may build here (in a paid world: has the Full Game; anyone else is visiting). */
  mayBuild(playerId: string): boolean;
  /**
   * Keeps something of this world's own with the room, under a name, so it is
   * still there after the room has slept (`memory` is not). Small things only:
   * it is saved whole each time. `load` gives back what was last saved, or
   * undefined.
   */
  save(name: string, value: unknown): void;
  load(name: string): unknown;
  /** The other worlds there are: somewhere to send things, or people. */
  worlds(): { id: string; name: string; said?: string }[];
  // The doors below are always there in a real room. They are optional in the type only so
  // that the stand-in rooms older worlds' tests are written with need not have them.
  /** A builder's name and colour as they gave them, or null (no such builder). */
  who?(playerId: string): { name: string; color: string } | null;
  /**
   * Something that is the same for a builder's browser tab every time it
   * joins (a reload, a dropped connection coming back), or null. Never send it
   * to a page.
   */
  tabOf?(playerId: string): string | null;
  /**
   * Takes pieces out of the build by this world's own rules; whatever that
   * leaves unsupported falls. Every page is told, and it is logged as `by`.
   */
  remove?(ids: readonly string[], by: string): void;
  /**
   * Wears pieces down at `point` with something of this world's own: each
   * [piece id, hits] adds that many hits (fractions allowed). What runs out of
   * hits breaks, and what that strands falls, as when a stone lands.
   */
  wear?(point: Vec, hits: readonly (readonly [string, number])[], by: string): void;
  /** True in a test room on a developer's own computer (there are none on the live site): what is only for checks may be allowed there. */
  test?(): boolean;
  /**
   * This world's own solid things just now (boxes in metres: a launcher, a
   * parked vehicle, a building), as `WorldServer.solids` gives them: for the
   * shared rules' questions (a throw, a stone, where something comes down),
   * so they meet them as they meet pieces.
   */
  solidThings?(): readonly Box[];
  /**
   * Sends plain data to another world's server half (its `fromWorld`), waking
   * that world if it sleeps. Resolves with its answer; undefined when there is
   * no such world, it has no `fromWorld`, or it could not be reached.
   */
  toWorld(worldId: string, data: unknown): Promise<unknown>;
}
