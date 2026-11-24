import type { BuildState } from "../game/buildState";
import type { Environment } from "../game/environments";
import type { Fall } from "../game/fall";
import type { Vec } from "../game/trebuchet";

/**
 * The server half of a world: rules of its own, beyond the shared ones. Every
 * hook is optional. A world's server code reaches the shared world only
 * through what these hooks are handed, never by importing the server itself.
 *
 * These are the fixed doors. Add to them; never change what an existing one means.
 */
export interface WorldServer {
  /**
   * A builder is thrown by a stone's impact. Return the flight they take
   * instead of the ordinary one (`hit.fall`), or null to leave it be. The
   * flight is sent to every page and played as given, so it must be complete:
   * a point every tenth of a second, the landing last.
   */
  thrown?(hit: Thrown): Fall | null;
}

export interface Thrown {
  /** The build as it stands (after the impact). Read it; never change it. */
  build: BuildState;
  env: Environment;
  /** Where the builder's body centre was, and the speed the impact gave them. */
  from: Vec;
  v: Vec;
  /** The flight the shared rules planned from that. */
  fall: Fall;
}
