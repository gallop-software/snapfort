import type { BuildState } from "../game/buildState";
import type { Environment } from "../game/environments";
import type { Fall } from "../game/fall";
import type { Piece } from "../game/pieces";
import type { Vec } from "../game/trebuchet";

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
  /** Pieces were taken out of the build (removed, broken or fallen). */
  removed?(room: Room, pieces: readonly Piece[]): void;
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
}
