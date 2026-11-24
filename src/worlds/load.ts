import type { WorldPage } from "./pageDoors";

/**
 * Loads the page half of one world. Each world's drawing code is its own file
 * in the build, fetched only by someone who is in that world: a world's code
 * is never even present on the page of another.
 */
const pages = import.meta.glob<{ page: WorldPage }>("./*/page/index.ts");

export async function loadPage(id: string): Promise<WorldPage> {
  const load = pages[`./${id}/page/index.ts`];
  if (!load) throw new Error(`World "${id}" has no page half (src/worlds/${id}/page/index.ts)`);
  return (await load()).page;
}
