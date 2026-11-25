import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { MATERIALS, PIECE_TYPES } from "../src/game/pieces";
import { ROOF_SHAPES } from "../src/game/environments";
import { DEFAULT_WORLD, WORLDS, worldAtPath, worldOf } from "../src/worlds";

/**
 * The guard rails around worlds. The building core is shared and frozen; each
 * world owns its code in src/worlds/<id>/ and may be as different as it likes.
 * These fail the build when that separation is broken.
 */

const root = join(__dirname, "..");
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    if (statSync(path).isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}
const worldsDir = join(root, "src", "worlds");
const ids = readdirSync(worldsDir).filter((name) => statSync(join(worldsDir, name)).isDirectory());
/** Code with its comments taken out (so a comment may still mention a world by name). */
const code = (path: string) => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/<!--[\s\S]*?-->/g, "");

describe("the list of worlds", () => {
  it("has every world folder, each with a different id, address and room", () => {
    expect(WORLDS.map((w) => w.id).sort()).toEqual([...ids].sort());
    for (const key of ["id", "path", "room"] as const) expect(new Set(WORLDS.map((w) => w[key])).size).toBe(WORLDS.length);
  });

  it("starts with a free world at the front door, where anything unknown ends up", () => {
    expect(DEFAULT_WORLD.path).toBe("/");
    expect(DEFAULT_WORLD.paid).toBe(false);
    expect(worldOf("no-such-world")).toBe(DEFAULT_WORLD);
    expect(worldOf(undefined)).toBe(DEFAULT_WORLD);
    expect(worldAtPath("/no-such-world")).toBe(DEFAULT_WORLD);
    for (const w of WORLDS) {
      expect(worldOf(w.id)).toBe(w);
      expect(worldAtPath(w.path)).toBe(w);
      expect(worldAtPath(`${w.path}/`)).toBe(w);
    }
  });

  it("gives every world a complete definition with sensible numbers", () => {
    for (const w of WORLDS) {
      expect(w.id, w.id).toMatch(/^[a-z][a-z0-9-]{1,20}$/);
      expect(w.room, w.id).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(w.path, w.id).toMatch(/^\/[a-z0-9-]*$/);
      expect(w.name.length, w.id).toBeGreaterThan(0);
      expect(w.card.blurb.length, w.id).toBeGreaterThan(0);
      // (In the bucket, on the CDN: not a file in the build.)
      expect(w.card.picture, w.id).toBe(`https://cdn.snapfort.io/worlds/${w.id}.jpg`);
      for (const n of [w.gravity, w.jumpHeight, w.stoneGravity, w.flightTime, w.range, w.throwPower, w.knockdownDrop, w.rubbleGravity]) expect(n > 0 && Number.isFinite(n), w.id).toBe(true);
      expect(Object.keys(w.materials).sort(), w.id).toEqual([...MATERIALS].sort());
      for (const m of MATERIALS) {
        const def = w.materials[m];
        expect(def.label.length, `${w.id} ${m}`).toBeGreaterThan(0);
        expect(def.hits >= 1 && Number.isInteger(def.hits), `${w.id} ${m}`).toBe(true);
        expect(def.maxLevel >= 0, `${w.id} ${m}`).toBe(true);
        expect(def.color.every((c) => c >= 0 && c <= 1), `${w.id} ${m}`).toBe(true);
      }
      // Something can always be built at any height.
      expect(MATERIALS.some((m) => w.materials[m].maxLevel === Infinity), w.id).toBe(true);
      // (Only the minimum range may be 0: an engine that can hit things right beside it.)
      for (const [key, n] of Object.entries(w.siege)) if (typeof n === "number") expect((n > 0 || (key === "minRange" && n === 0)) && Number.isFinite(n), `${w.id} ${key}`).toBe(true);
      expect(w.siege.minRange, w.id).toBeLessThan(w.siege.baseRange);
      expect(ROOF_SHAPES, w.id).toContain(w.roof);
    }
  });

  it("gives every world a server half and a page half", () => {
    for (const id of ids) {
      for (const file of ["world.ts", "server.ts", join("page", "index.ts")]) expect(statSync(join(worldsDir, id, file)).isFile(), `${id}/${file}`).toBe(true);
    }
  });
});

describe("worlds stay apart", () => {
  it("never import from another world", () => {
    for (const id of ids) {
      for (const path of files(join(worldsDir, id))) {
        const dir = join(path, "..");
        for (const match of code(path).matchAll(/from\s+"(\.[^"]+)"|import\s*\(\s*"(\.[^"]+)"/g)) {
          const target = relative(worldsDir, join(dir, match[1] ?? match[2]!)).split(sep);
          // Inside src/worlds, a world may only reach its own folder and the doors.
          if (target[0] !== ".." && ids.includes(target[0]!)) expect(target[0], `${relative(root, path)} imports ${match[1] ?? match[2]}`).toBe(id);
        }
      }
    }
  });

  it("keeps drawing code out of what the server loads", () => {
    for (const id of ids) {
      for (const file of ["world.ts", "server.ts"]) {
        const text = code(join(worldsDir, id, file));
        expect(/@babylonjs|\/page\/|\.\.\/\.\.\/render|\.\.\/pageDoors/.test(text), `${id}/${file}`).toBe(false);
      }
    }
    expect(/pageDoors|load"|\/page\//.test(code(join(worldsDir, "index.ts")))).toBe(false);
  });
});

describe("shared code", () => {
  /** Shared files: everything outside the world folders. The list of worlds is the one place that names them. */
  const shared = [
    ...files(join(root, "src")).filter((p) => !ids.some((id) => p.startsWith(join(worldsDir, id) + sep)) && p !== join(worldsDir, "index.ts")),
    ...files(join(root, "worker")),
    join(root, "index.html"),
  ].filter((p) => /\.(ts|css|html)$/.test(p));

  it("never imports a world directly", () => {
    for (const path of shared) {
      const text = code(path);
      for (const id of ids) expect(new RegExp(`worlds/${id}/`).test(text), `${relative(root, path)} imports world ${id}`).toBe(false);
    }
  });

  it("never names a particular world", () => {
    for (const path of shared) {
      const text = code(path).toLowerCase();
      // Not in a string, an identifier, a selector or a line of markup: only comments may.
      for (const w of WORLDS) expect(text.includes(w.id), `${relative(root, path)} names the ${w.name}`).toBe(false);
    }
  });
});

describe("how builds are saved", () => {
  it("keeps the numbering of pieces and materials (new ones go on the end)", () => {
    expect(PIECE_TYPES.slice(0, 5)).toEqual(["wall", "floor", "ramp", "roof", "trebuchet"]);
    expect(MATERIALS.slice(0, 3)).toEqual(["wood", "brick", "metal"]);
  });
});
