/**
 * Scaffolding for the checks that build a Starship: a part only goes on from
 * within 12 m of where it goes, so the checks climb as a builder would. For a
 * site with its tower in cell (tx, tz) and the rocket along +z: three columns
 * of walls with a floor every two storeys, one each side of the tower and one
 * beside the mount, all clear of the site itself.
 */
const CELL = 5, LEVEL = 3.75, TOP = 38;
const columns = (tx, tz) => ({ tower: [tx + 2, tz, tx + 3], armA: [tx - 2, tz, tx - 2], mount: [tx + 2, tz + 4, tx + 3] });

/** Builds it (through the page, as pieces a builder placed); gives back the ids, to take it down again. */
export async function scaffold(page, tx, tz) {
  const ids = await page.evaluate(([cols, top]) => {
    const s = window.snapfort, ids = [];
    const put = (type, x, y, z, rot) => { const id = s.nextId(); s.history.do({ kind: "place", piece: { type, x, y, z, rot, id, material: "wood", edit: 0 } }); ids.push(id); };
    for (const [cx, cz, wx] of cols) for (let y = 0; y <= top; y++) { put("wall", wx, y, cz, 1); if (y > 0 && y % 2 === 0) put("floor", cx, y, cz, 0); }
    return ids;
  }, [Object.values(columns(tx, tz)), TOP]);
  await new Promise((r) => setTimeout(r, 1500));
  return ids;
}

/** How high the middle of part `n` is, m. */
function middle(n) {
  if (n <= 8) return (n - 0.5) * 17.5;
  if (n === 9) return 143;
  if (n === 10) return 9.4;
  if (n <= 12) return 80;
  if (n === 13) return 94;
  if (n <= 17) return 18.75 + (n - 13.5) * 17.75;
  return 89.75 + [6, 19, 32, 45][n - 18];
}

/** Where on the scaffolding to stand to put part `n` on (a builder's middle, m), and the spot on the site to look at from there. */
export function perch(tx, tz, n) {
  const c = columns(tx, tz);
  const [cx, cz] = n === 11 ? c.armA : n === 10 || n >= 14 ? c.mount : c.tower;
  const level = Math.min(TOP, 2 * Math.floor(middle(n) / (2 * LEVEL)));
  const y = level * LEVEL + 1.15;
  return { at: [(cx + 0.5) * CELL, y, (cz + 0.5) * CELL], look: [(tx + 0.5) * CELL, y, (cz + 0.5) * CELL] };
}
