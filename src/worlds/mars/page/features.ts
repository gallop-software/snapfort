import type { WorldFeature } from "../../pageDoors";

/**
 * Mars will have more than one thing of its own (copied from the Moon): this makes
 * one feature of several, for the game to talk to. Each is asked in turn; the
 * first that takes a key, a seat or a prompt has it.
 */
export function together(...parts: WorldFeature[]): WorldFeature {
  return {
    message: (data) => parts.forEach((p) => p.message?.(data)),
    joined: () => parts.forEach((p) => p.joined?.()),
    drive: (dt, input) => parts.some((p) => p.drive?.(dt, input) === true),
    update: (dt) => parts.forEach((p) => p.update?.(dt)),
    board: () => parts.some((p) => (p.busy?.() ? p.board?.() === true : false)) || parts.some((p) => p.board?.() === true),
    prompt: () => {
      for (const p of parts) {
        const said = p.prompt?.();
        if (said) return said;
      }
      return null;
    },
    busy: () => parts.some((p) => p.busy?.() === true),
    act: () => parts.forEach((p) => p.busy?.() && p.act?.()),
    aimTool: (id) => parts.forEach((p) => p.aimTool?.(id)),
    useTool: (id) => parts.forEach((p) => p.useTool?.(id)),
    blocks: (spec) => parts.some((p) => p.blocks?.(spec) === true),
    aimRemove: () => parts.forEach((p) => p.aimRemove?.()),
    remove: () => parts.some((p) => p.remove?.() === true),
  };
}
