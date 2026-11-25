import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { MaterialId, PieceType } from "../../../game/pieces";
import { canvas, line, rng, toTexture } from "../../../render/paint";
import type { PieceSkin } from "../../pageDoors";

/**
 * Mars's art: ice, redbrick and iron, greenhouse glass, rust-red ground, and
 * the night sky. Piece textures are near-white line work; the material colour
 * is multiplied in per piece. The texture spans the whole face of a piece, so
 * its border outlines each piece and edit tiles line up with the pattern.
 *
 * Copied from the Moon's and repainted.
 */
const S = 256;
const DARK = "rgba(24, 20, 26, ";

/** What a piece texture is called: the scenery finds the ones that glow at night by these names. */
export const skinName = (type: PieceType, material: MaterialId) => `piece-${type}-${material}`;

/** Ice (the light slot): cells of ice in an inflatable skin. Quilted pillows, three by three, frosted, with a seam between. */
function ice(g: CanvasRenderingContext2D, r: () => number): void {
  const cells = 3;
  const w = S / cells;
  for (let cx = 0; cx < cells; cx++) {
    for (let cy = 0; cy < cells; cy++) {
      const x = cx * w, y = cy * w;
      // Each pillow bulges: bright in the middle, shaded to the seam.
      const bulge = g.createRadialGradient(x + w * 0.42, y + w * 0.4, w * 0.08, x + w / 2, y + w / 2, w * 0.72);
      bulge.addColorStop(0, "rgba(255, 255, 255, 0.5)");
      bulge.addColorStop(0.6, "rgba(255, 255, 255, 0)");
      bulge.addColorStop(1, "rgba(30, 50, 90, 0.2)");
      g.fillStyle = bulge;
      g.fillRect(x, y, w, w);
    }
  }
  // Frost inside the ice: fine cracks, and the odd trapped bubble.
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(255, 255, 255, ${0.25 + r() * 0.35})`;
    g.lineWidth = 1;
    let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      const len = 6 + r() * 16;
      const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
      line(g, x, y, nx, ny);
      x = nx;
      y = ny;
      a += (r() - 0.5) * 1.6;
    }
  }
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(40, 70, 120, ${0.12 + r() * 0.14})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(r() * S, r() * S, 1 + r() * 2.5, 0, Math.PI * 2);
    g.stroke();
  }
  // Seams where the skin is welded between cells, with a light edge.
  for (let i = 1; i < cells; i++) {
    g.strokeStyle = "rgba(30, 50, 90, 0.3)";
    g.lineWidth = 5;
    line(g, i * w, 0, i * w, S);
    line(g, 0, i * w, S, i * w);
    g.strokeStyle = "rgba(255, 255, 255, 0.55)";
    g.lineWidth = 1.5;
    line(g, i * w + 3, 0, i * w + 3, S);
    line(g, 0, i * w + 3, S, i * w + 3);
  }
}

/** Redbrick (the middle slot): bricks pressed from the red soil, six courses, each a little different, gritty. */
function redbrick(g: CanvasRenderingContext2D, r: () => number): void {
  const rows = 6;
  const h = S / rows;
  const w = S / 3;
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : w / 2;
    for (let x = -offset; x < S; x += w) {
      g.fillStyle = r() > 0.5 ? `${DARK}${r() * 0.16})` : `rgba(255, 255, 255, ${r() * 0.14})`;
      g.fillRect(x + 2, row * h + 2, w - 4, h - 4);
      // The mould's lip leaves a lighter top edge on each brick.
      g.fillStyle = "rgba(255, 255, 255, 0.2)";
      g.fillRect(x + 3, row * h + 3, w - 6, 2);
    }
  }
  // Grit pressed into the faces.
  for (let i = 0; i < 620; i++) {
    g.fillStyle = r() > 0.5 ? `rgba(255, 255, 255, ${0.05 + r() * 0.12})` : `${DARK}${0.06 + r() * 0.14})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  // Joints: dark, dry seams (no mortar: the soil binds itself under pressure).
  g.strokeStyle = `${DARK}0.46)`;
  g.lineWidth = 3;
  for (let row = 0; row <= rows; row++) line(g, 0, row * h, S, row * h);
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : w / 2;
    for (let x = offset; x < S; x += w) if (x > 0) line(g, x, row * h, x, row * h + h);
  }
}

/** Iron (the heavy slot): two big cast plates, hammered, riveted round every edge, with a streak of rust or two. */
function iron(g: CanvasRenderingContext2D, r: () => number): void {
  // Hammer marks: soft light and dark dimples.
  for (let i = 0; i < 150; i++) {
    const x = r() * S, y = r() * S, rad = 5 + r() * 12;
    const dimple = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
    dimple.addColorStop(0, `rgba(255, 255, 255, ${0.05 + r() * 0.1})`);
    dimple.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = dimple;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Rust weeping down from the top.
  for (let i = 0; i < 9; i++) {
    const x = r() * S, len = 30 + r() * 90;
    const streak = g.createLinearGradient(0, 0, 0, len);
    streak.addColorStop(0, "rgba(255, 150, 90, 0.34)");
    streak.addColorStop(1, "rgba(255, 150, 90, 0)");
    g.fillStyle = streak;
    g.fillRect(x, 0, 2 + r() * 5, len);
  }
  // The joint between the two plates, and rivets along every edge.
  g.strokeStyle = `${DARK}0.5)`;
  g.lineWidth = 5;
  line(g, 0, S / 2, S, S / 2);
  g.strokeStyle = "rgba(255, 255, 255, 0.3)";
  g.lineWidth = 1.5;
  line(g, 0, S / 2 + 4, S, S / 2 + 4);
  const rivet = (x: number, y: number) => {
    g.fillStyle = `${DARK}0.5)`;
    g.beginPath();
    g.arc(x, y, 4.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255, 255, 255, 0.6)";
    g.beginPath();
    g.arc(x - 1.2, y - 1.2, 1.7, 0, Math.PI * 2);
    g.fill();
  };
  for (let k = 0; k < 8; k++) {
    const p = 20 + (k * (S - 40)) / 7;
    for (const y of [18, S / 2 - 16, S / 2 + 18, S - 18]) rivet(p, y);
  }
  for (const y of [50, 84, 174, 208]) for (const x of [18, S - 18]) rivet(x, y);
}

/**
 * The greenhouse (every roof): panes of glass in a frame, leaves pressed
 * against the inside. The frame takes the colour of the material it is built
 * in; the leaves come through as darker shapes behind the glass.
 */
function greenhouse(g: CanvasRenderingContext2D, r: () => number): void {
  const panes = 4;
  const w = S / panes;
  // Leaves first, under the glass: clusters along the bottom, thinning upward.
  for (let i = 0; i < 150; i++) {
    const x = r() * S, y = S - r() * r() * S * 0.85;
    g.fillStyle = `rgba(30, 120, 50, ${0.16 + r() * 0.2})`;
    g.beginPath();
    g.ellipse(x, y, 5 + r() * 9, 2.5 + r() * 4, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // A sheen across each pane.
  for (let px = 0; px < panes; px++) {
    for (let py = 0; py < panes; py++) {
      const x = px * w, y = py * w;
      const sheen = g.createLinearGradient(x, y, x + w, y + w);
      sheen.addColorStop(0, "rgba(255, 255, 255, 0.36)");
      sheen.addColorStop(0.45, "rgba(255, 255, 255, 0)");
      sheen.addColorStop(1, "rgba(30, 50, 80, 0.1)");
      g.fillStyle = sheen;
      g.fillRect(x, y, w, w);
    }
  }
  // Glazing bars.
  for (let i = 1; i < panes; i++) {
    g.strokeStyle = `${DARK}0.5)`;
    g.lineWidth = 6;
    line(g, i * w, 0, i * w, S);
    line(g, 0, i * w, S, i * w);
    g.strokeStyle = "rgba(255, 255, 255, 0.4)";
    g.lineWidth = 1.5;
    line(g, i * w - 3, 0, i * w - 3, S);
    line(g, 0, i * w - 3, S, i * w - 3);
  }
}

/** By slot: what the light, middle and heavy materials look like here. */
const PATTERNS: Record<MaterialId, (g: CanvasRenderingContext2D, r: () => number) => void> = { wood: ice, brick: redbrick, metal: iron };

/** The look of one kind of piece in one material. Glass and ice shine, iron a little, pressed soil not at all. */
export function pieceSkin(type: PieceType, material: MaterialId, scene: Scene): PieceSkin {
  const specular = type === "roof" ? 0.5 : material === "wood" ? 0.3 : material === "metal" ? 0.2 : 0;
  return { texture: pieceTexture(type, material, scene), specular };
}

function pieceTexture(type: PieceType, material: MaterialId, scene: Scene): Texture {
  const [c, g] = canvas(S);
  g.fillStyle = "#fbfbfb";
  g.fillRect(0, 0, S, S);
  const r = rng(material.length * 131 + type.charCodeAt(0) * 7 + material.charCodeAt(0));
  if (type === "roof") greenhouse(g, r);
  else PATTERNS[material](g, r);

  if (type === "ramp") {
    // Treads across the slope so a ramp reads as stairs.
    for (let i = 1; i < 8; i++) {
      const y = (i * S) / 8;
      g.fillStyle = `${DARK}0.18)`;
      g.fillRect(0, y - 5, S, 5);
      g.fillStyle = "rgba(255, 255, 255, 0.35)";
      g.fillRect(0, y, S, 2);
    }
  }

  // Border: a dark edge so each piece reads on its own, with a light bevel inside.
  g.strokeStyle = `${DARK}0.42)`;
  g.lineWidth = 10;
  g.strokeRect(0, 0, S, S);
  g.strokeStyle = "rgba(255, 255, 255, 0.45)";
  g.lineWidth = 2;
  g.strokeRect(8, 8, S - 16, S - 16);
  return toTexture(c, scene, skinName(type, material));
}

/** Mars's ground: rust-red dust, wind ripples, scattered dark basalt stones, and the same faint cell lines. */
export function marsGroundTexture(scene: Scene): Texture {
  const size = 512;
  const [c, g] = canvas(size);
  g.fillStyle = "#b5694a";
  g.fillRect(0, 0, size, size);
  const r = rng(47);
  const wrapped = (draw: (ox: number, oy: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(ox, oy);
  };
  // Drifts: broad lighter and darker patches of dust.
  for (let i = 0; i < 46; i++) {
    const x = r() * size, y = r() * size, rad = 30 + r() * 80;
    const light = r() > 0.5;
    wrapped((ox, oy) => {
      const patch = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      patch.addColorStop(0, light ? "rgba(232, 160, 110, 0.2)" : "rgba(96, 44, 30, 0.2)");
      patch.addColorStop(1, light ? "rgba(232, 160, 110, 0)" : "rgba(96, 44, 30, 0)");
      g.fillStyle = patch;
      g.beginPath();
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      g.fill();
    });
  }
  // Wind ripples: short curved lines, all lying the same way.
  for (let i = 0; i < 150; i++) {
    const x = r() * size, y = r() * size, len = 18 + r() * 44, bend = (r() - 0.5) * 8;
    g.lineWidth = 1.5;
    wrapped((ox, oy) => {
      g.strokeStyle = "rgba(96, 44, 30, 0.2)";
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.quadraticCurveTo(x + ox + len / 2, y + oy + bend, x + ox + len, y + oy);
      g.stroke();
      g.strokeStyle = "rgba(240, 180, 130, 0.18)";
      g.beginPath();
      g.moveTo(x + ox, y + oy + 2);
      g.quadraticCurveTo(x + ox + len / 2, y + oy + bend + 2, x + ox + len, y + oy + 2);
      g.stroke();
    });
  }
  // Grit.
  for (let i = 0; i < 1100; i++) {
    const x = r() * size, y = r() * size, rad = 0.8 + r() * 1.8;
    g.fillStyle = r() > 0.5 ? `rgba(240, 180, 130, ${0.08 + r() * 0.1})` : `rgba(70, 30, 22, ${0.1 + r() * 0.14})`;
    g.fillRect(x, y, rad, rad);
  }
  // Stones: dark basalt, angular, lit from one side, each with a small shadow.
  for (let i = 0; i < 34; i++) {
    const x = r() * size, y = r() * size, rad = 3 + r() * r() * 11, turn = r() * Math.PI;
    const corners = 5 + Math.floor(r() * 3);
    const shape = Array.from({ length: corners }, (_, k) => {
      const a = turn + (k / corners) * Math.PI * 2;
      const d = rad * (0.7 + r() * 0.4);
      return [Math.cos(a) * d, Math.sin(a) * d * 0.8] as const;
    });
    wrapped((ox, oy) => {
      const cx = x + ox, cy = y + oy;
      g.fillStyle = "rgba(60, 24, 18, 0.34)";
      g.beginPath();
      g.ellipse(cx + rad * 0.35, cy + rad * 0.35, rad * 1.05, rad * 0.8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#5d4038";
      g.beginPath();
      shape.forEach(([sx, sy], k) => (k === 0 ? g.moveTo(cx + sx, cy + sy) : g.lineTo(cx + sx, cy + sy)));
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(214, 160, 130, 0.5)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx + shape[0]![0], cy + shape[0]![1]);
      g.lineTo(cx + shape[corners - 1]![0], cy + shape[corners - 1]![1]);
      g.stroke();
    });
  }
  g.fillStyle = "rgba(255, 226, 200, 0.14)";
  for (const p of [0, size / 2]) {
    g.fillRect(p - 2, 0, 4, size);
    g.fillRect(0, p - 2, size, 4);
  }
  g.fillRect(size - 2, 0, 2, size);
  g.fillRect(0, size - 2, size, 2);
  return toTexture(c, scene, "mars-ground");
}

/** The night sky: black, full of stars, a faint band of the galaxy across it. (The day's sky is plain colour over this: see scenery.ts.) */
export function starTexture(scene: Scene): Texture {
  // Large, so a star stays a point however wide the screen.
  const w = 4096, h = 2048;
  const [c, g] = canvas(w, h);
  g.fillStyle = "#000000";
  g.fillRect(0, 0, w, h);
  const r = rng(73);
  // The galaxy: a soft, tilted band.
  for (let i = 0; i < 5000; i++) {
    const x = r() * w;
    const y = h * 0.7 + Math.sin((x / w) * Math.PI * 2 + 1.3) * h * 0.1 + (r() - 0.5) * h * 0.12;
    g.fillStyle = `rgba(190, 180, 220, ${0.004 + r() * 0.01})`;
    g.beginPath();
    g.arc(x, y, 4 + r() * 14, 0, Math.PI * 2);
    g.fill();
  }
  // Stars: mostly tiny, a few bright ones with a soft glow. Babylon's sphere puts
  // the top of the image at the bottom pole, so the sky is the lower half here
  // (the upper half is below the horizon, behind the ground, and left plain).
  for (let i = 0; i < 3600; i++) {
    const x = r() * w, y = h * 0.45 + r() * h * 0.55;
    const bright = r();
    const size = bright > 0.985 ? 2.6 : bright > 0.9 ? 1.7 : 1.1;
    const tint = r();
    g.fillStyle = tint > 0.85 ? "rgba(255, 225, 190, 1)" : tint > 0.7 ? "rgba(200, 215, 255, 1)" : "rgba(255, 255, 255, 1)";
    g.globalAlpha = 0.45 + bright * 0.55;
    g.beginPath();
    g.arc(x, y, size, 0, Math.PI * 2);
    g.fill();
    if (bright > 0.985) {
      g.globalAlpha = 0.12;
      g.beginPath();
      g.arc(x, y, size * 2.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  const texture = new Texture(c.toDataURL("image/png"), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = "stars";
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** A soft round glow, white in the middle and clear at the edge: the sun's halo, tinted by the scenery. */
export function glowTexture(scene: Scene): Texture {
  const size = 256;
  const [c, g] = canvas(size);
  const glow = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.12, "rgba(255, 255, 255, 0.62)");
  glow.addColorStop(0.4, "rgba(255, 255, 255, 0.2)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  const texture = new Texture(c.toDataURL("image/png"), scene, false, true, Texture.BILINEAR_SAMPLINGMODE);
  texture.name = "glow";
  texture.hasAlpha = true;
  return texture;
}

/** The sun's own disc: white, with a soft edge. */
export function discTexture(scene: Scene): Texture {
  const size = 128;
  const [c, g] = canvas(size);
  const disc = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  disc.addColorStop(0, "rgba(255, 255, 255, 1)");
  disc.addColorStop(0.55, "rgba(255, 255, 255, 1)");
  disc.addColorStop(0.75, "rgba(255, 255, 255, 0.3)");
  disc.addColorStop(1, "rgba(255, 255, 255, 0)");
  g.fillStyle = disc;
  g.fillRect(0, 0, size, size);
  const texture = new Texture(c.toDataURL("image/png"), scene, false, true, Texture.BILINEAR_SAMPLINGMODE);
  texture.name = "disc";
  texture.hasAlpha = true;
  return texture;
}

/** The haze along the horizon: solid at the bottom, clear at the top (the top of the image is the top of the band). */
export function hazeTexture(scene: Scene): Texture {
  const [c, g] = canvas(4, 256);
  const fade = g.createLinearGradient(0, 0, 0, 256);
  fade.addColorStop(0, "rgba(255, 255, 255, 0)");
  fade.addColorStop(0.45, "rgba(255, 255, 255, 0.5)");
  fade.addColorStop(0.72, "rgba(255, 255, 255, 1)");
  fade.addColorStop(1, "rgba(255, 255, 255, 1)");
  g.fillStyle = fade;
  g.fillRect(0, 0, 4, 256);
  const texture = new Texture(c.toDataURL("image/png"), scene, false, true, Texture.BILINEAR_SAMPLINGMODE);
  texture.name = "haze";
  texture.hasAlpha = true;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** Phobos: a dark grey lump, pocked, with the big crater Stickney on one side. */
export function phobosTexture(scene: Scene): Texture {
  const w = 256, h = 128;
  const [c, g] = canvas(w, h);
  g.fillStyle = "#8a7f78";
  g.fillRect(0, 0, w, h);
  const r = rng(13);
  for (let i = 0; i < 60; i++) {
    const x = r() * w, y = r() * h, rad = 2 + r() * r() * 12;
    g.fillStyle = "rgba(40, 34, 32, 0.4)";
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(220, 205, 195, 0.4)";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(x, y, rad, Math.PI * 0.2, Math.PI * 1.1);
    g.stroke();
  }
  g.fillStyle = "rgba(34, 28, 26, 0.6)";
  g.beginPath();
  g.arc(w * 0.3, h * 0.5, 24, 0, Math.PI * 2);
  g.fill();
  // Grooves running away from the big crater.
  g.strokeStyle = "rgba(40, 34, 32, 0.3)";
  g.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) line(g, w * 0.4, h * (0.15 + i * 0.09), w, h * (0.1 + i * 0.1));
  return toTexture(c, scene, "phobos", false);
}

/** What grows once Mars thaws: a patchy mat of lichen and moss, near-white so the scenery can tint it from dark lichen to green. Tiles. */
export function mossTexture(scene: Scene): Texture {
  const size = 256;
  const [c, g] = canvas(size);
  g.fillStyle = "#c8c8c8";
  g.fillRect(0, 0, size, size);
  const r = rng(61);
  for (let i = 0; i < 700; i++) {
    const x = r() * size, y = r() * size, rad = 2 + r() * 7;
    g.fillStyle = r() > 0.45 ? `rgba(255, 255, 255, ${0.1 + r() * 0.25})` : `rgba(60, 70, 50, ${0.1 + r() * 0.25})`;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.beginPath();
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
  return toTexture(c, scene, "moss");
}

/** How the growth thins toward its edge: solid in the middle, breaking into patches, then nothing. Stretched over the whole of it. */
export function spreadTexture(scene: Scene): Texture {
  const size = 512;
  const [c, g] = canvas(size);
  const fade = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  fade.addColorStop(0, "rgba(255, 255, 255, 0.92)");
  fade.addColorStop(0.55, "rgba(255, 255, 255, 0.85)");
  fade.addColorStop(0.8, "rgba(255, 255, 255, 0.3)");
  fade.addColorStop(1, "rgba(255, 255, 255, 0)");
  g.fillStyle = fade;
  g.fillRect(0, 0, size, size);
  // Bare patches eaten out of it, more of them toward the edge.
  const r = rng(83);
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 900; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * size * 0.5;
    const k = d / (size * 0.5);
    g.fillStyle = `rgba(0, 0, 0, ${0.15 + k * 0.6})`;
    g.beginPath();
    g.arc(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d, 2 + r() * 9 * (0.4 + k), 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
  const texture = new Texture(c.toDataURL("image/png"), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = "spread";
  texture.hasAlpha = true;
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** The aurora: curtains of light, brightest low down and fading upward. Tiles round the sky. */
export function auroraTexture(scene: Scene): Texture {
  const w = 1024, h = 256;
  const [c, g] = canvas(w, h);
  g.clearRect(0, 0, w, h);
  const r = rng(101);
  for (let i = 0; i < 150; i++) {
    const x = r() * w, wide = 3 + r() * 16, tall = h * (0.35 + r() * 0.65), strong = 0.08 + r() * 0.3;
    const ray = g.createLinearGradient(0, h, 0, h - tall);
    ray.addColorStop(0, `rgba(255, 255, 255, 0)`);
    ray.addColorStop(0.12, `rgba(255, 255, 255, ${strong})`);
    ray.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = ray;
    for (const ox of [-w, 0, w]) g.fillRect(x + ox, h - tall, wide, tall);
  }
  const texture = new Texture(c.toDataURL("image/png"), scene, false, true, Texture.BILINEAR_SAMPLINGMODE);
  texture.name = "aurora";
  texture.hasAlpha = true;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}
