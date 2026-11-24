/**
 * The server half of a world: rules of its own, beyond the shared ones. Every
 * hook is optional. A world's server code reaches the shared world only
 * through what these hooks are handed, never by importing the server itself.
 *
 * These are the fixed doors. Add to them; never change what an existing one means.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WorldServer {}
