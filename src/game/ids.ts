/** Piece ids are unique per client so several players can create pieces without clashing. */
export function createIdSource(clientId: string = randomClientId()): () => string {
  let n = 0;
  return () => `${clientId}-${(n++).toString(36)}`;
}

function randomClientId(): string {
  return Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
}
