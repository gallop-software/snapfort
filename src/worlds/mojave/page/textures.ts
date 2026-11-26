import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { MaterialId, PieceType } from "../../../game/pieces";
import { canvas, rng, toTexture } from "../../../render/paint";
import type { PieceSkin } from "../../pageDoors";

/**
 * Mojave's art: printed concrete (the one material here),
 * a cracked white lakebed and a hard blue desert sky. Piece textures are
 * near-white line work; the material colour is multiplied in per piece. The
 * texture spans the whole face of a piece, so its border outlines each piece
 * and edit tiles line up with the pattern.
 *
 * Every pattern leaves the spot at PLAIN_UV clear (on the canvas that is 115
 * across and 154 down: textures are flipped top to bottom when loaded).
 *
 * Copied from the Meadow (2026-11-25) and changed from there; the two share no code.
 */
const S = 256;

/**
 * Printcrete: concrete laid down by a printer in fine
 * beads, one on another, with the seam where each pass
 * began, grit in the mix and two lifting sockets. The plain spot falls in the middle of a bead.
 */
function printcrete(g: CanvasRenderingContext2D, r: () => number): void {
  // A cool cast under everything: the material's colour is a warm sand, and concrete should not pass for timber.
  g.fillStyle = "rgba(205, 216, 234, 0.4)";
  g.fillRect(0, 0, S, S);
  const pitch = 8;
  for (let y = -2; y < S; y += pitch) {
    // The bead itself: round, so lightest along its upper half where the light catches it, with a dark groove below.
    g.fillStyle = `rgba(255, 255, 255, ${0.3 + r() * 0.12})`;
    g.fillRect(0, y + 1, S, 3);
    g.fillStyle = `rgba(40, 46, 58, ${0.02 + r() * 0.03})`;
    g.fillRect(0, y + 4, S, 2.5);
    g.fillStyle = "rgba(40, 46, 58, 0.24)";
    g.fillRect(0, y + pitch - 1.5, S, 1.5);
  }
  // Grit in the mix: specks, light and dark.
  for (let i = 0; i < 520; i++) {
    const x = r() * S, y = r() * S;
    if (Math.abs(x - 115) < 8 && Math.abs(y - 154) < 4) continue;
    g.fillStyle = r() > 0.5 ? "rgba(40, 46, 58, 0.16)" : "rgba(255, 255, 255, 0.4)";
    g.fillRect(x, y, 1.5, 1.5);
  }
  // The printer goes round and round: where each pass began there is a seam, stepping a little from bead to bead.
  for (let y = -2; y < S; y += pitch) {
    const x = 196 + Math.sin(y * 0.11) * 3;
    g.fillStyle = "rgba(40, 46, 58, 0.3)";
    g.fillRect(x, y + 1, 2, pitch - 2.5);
    g.fillStyle = "rgba(255, 255, 255, 0.45)";
    g.fillRect(x + 2, y + 1, 1.5, pitch - 2.5);
  }
  // Lifting sockets cast into the wall: two dark round holes with a steel rim.
  for (const x of [48, 208]) {
    g.fillStyle = "rgba(255, 255, 255, 0.6)";
    g.beginPath();
    g.arc(x, 44, 7.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(20, 24, 30, 0.6)";
    g.beginPath();
    g.arc(x, 44, 5, 0, Math.PI * 2);
    g.fill();
  }
}

// (One material here: every slot a piece may have been saved under looks the same.)
const PATTERNS: Record<MaterialId, (g: CanvasRenderingContext2D, r: () => number) => void> = { wood: printcrete, brick: printcrete, metal: printcrete };

/** The look of one kind of piece in one material. Steel shines, carbon has a sheen, concrete is matt. */
export function pieceSkin(type: PieceType, material: MaterialId, scene: Scene): PieceSkin {
  return { texture: pieceTexture(type, material, scene), specular: 0 };
}

function pieceTexture(type: PieceType, material: MaterialId, scene: Scene): Texture {
  const [c, g] = canvas(S);
  g.fillStyle = "#fbfbfb";
  g.fillRect(0, 0, S, S);
  const r = rng(151 + type.charCodeAt(0) * 11);
  PATTERNS[material](g, r);

  if (type === "ramp") {
    // Treads across the slope so a ramp reads as stairs: a dark riser and a bright nosing.
    for (let i = 1; i < 8; i++) {
      const y = (i * S) / 8;
      g.fillStyle = "rgba(20, 24, 30, 0.22)";
      g.fillRect(0, y - 5, S, 5);
      g.fillStyle = "rgba(255, 255, 255, 0.5)";
      g.fillRect(0, y, S, 2);
    }
  }

  // Border: a dark edge so each piece reads on its own, with a light bevel inside.
  g.strokeStyle = "rgba(20, 24, 30, 0.42)";
  g.lineWidth = 10;
  g.strokeRect(0, 0, S, S);
  g.strokeStyle = "rgba(255, 255, 255, 0.5)";
  g.lineWidth = 2;
  g.strokeRect(8, 8, S - 16, S - 16);
  return toTexture(c, scene, `mojave-piece-${type}-${material}`);
}

/**
 * The lakebed: pale dried mud cracked into plates, with a faint line on every
 * grid cell edge. One tile covers 2 x 2 cells.
 */
export function groundTexture(scene: Scene): Texture {
  const size = 512;
  const [c, g] = canvas(size);
  g.fillStyle = "#f3efe6";
  g.fillRect(0, 0, size, size);
  const r = rng(2080);
  // Everything is drawn nine times over, shifted by a tile, so the tile repeats without a seam.
  const wrapped = (draw: (ox: number, oy: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(ox, oy);
  };
  // Soft patches of dust and of bare salt.
  for (let i = 0; i < 90; i++) {
    const x = r() * size, y = r() * size, rad = 14 + r() * 40, squash = 0.5 + r() * 0.3;
    g.fillStyle = r() > 0.5 ? `rgba(255, 252, 240, ${0.03 + r() * 0.05})` : `rgba(150, 130, 100, ${0.02 + r() * 0.03})`;
    wrapped((ox, oy) => {
      g.beginPath();
      g.ellipse(x + ox, y + oy, rad, rad * squash, 0, 0, Math.PI * 2);
      g.fill();
    });
  }
  // The plates: scatter their middles on a jittered grid, then crack along the line half way
  // between each middle and its neighbours. A plate is about 1.2 m across.
  const n = 8, cell = size / n;
  const middles: [number, number][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) middles.push([(i + 0.2 + r() * 0.6) * cell, (j + 0.2 + r() * 0.6) * cell]);
  const at = (i: number, j: number): [number, number] => {
    const [x, y] = middles[((j + n) % n) * n + ((i + n) % n)]!;
    return [x + Math.floor(i / n) * size, y + Math.floor(j / n) * size];
  };
  /**
   * The corner three plates share: the point as far from each middle as from the others,
   * kept near the middle of the three (thin triangles would throw it far off, and the cracks would cross).
   */
  const corner = (a: [number, number], b: [number, number], d: [number, number]): [number, number] => {
    const k = 2 * (a[0] * (b[1] - d[1]) + b[0] * (d[1] - a[1]) + d[0] * (a[1] - b[1]));
    const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], d2 = d[0] * d[0] + d[1] * d[1];
    const mx = (a[0] + b[0] + d[0]) / 3, my = (a[1] + b[1] + d[1]) / 3;
    const dx = (a2 * (b[1] - d[1]) + b2 * (d[1] - a[1]) + d2 * (a[1] - b[1])) / k - mx, dy = (a2 * (d[0] - b[0]) + b2 * (a[0] - d[0]) + d2 * (b[0] - a[0])) / k - my;
    const far = Math.hypot(dx, dy), reach = cell * 0.16;
    return far > reach ? [mx + (dx / far) * reach, my + (dy / far) * reach] : [mx + dx, my + dy];
  };
  const crack = (p: [number, number], q: [number, number]) => {
    // A crack wanders a little on its way: one bend in the middle.
    const mx = (p[0] + q[0]) / 2 + (r() - 0.5) * 5, my = (p[1] + q[1]) / 2 + (r() - 0.5) * 5;
    const width = 1.2 + r() * 1.3;
    wrapped((ox, oy) => {
      g.strokeStyle = "rgba(96, 84, 68, 0.5)";
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(p[0] + ox, p[1] + oy);
      g.lineTo(mx + ox, my + oy);
      g.lineTo(q[0] + ox, q[1] + oy);
      g.stroke();
      // The curled lip of the plate beside it catches the sun.
      g.strokeStyle = "rgba(255, 252, 242, 0.22)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(p[0] + ox + 1.5, p[1] + oy + 1.5);
      g.lineTo(mx + ox + 1.5, my + oy + 1.5);
      g.lineTo(q[0] + ox + 1.5, q[1] + oy + 1.5);
      g.stroke();
    });
  };
  // Each square of four middles is split into two triangles; every triangle has one corner,
  // and a crack joins the corners of triangles that share a side.
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const lower = corner(at(i, j), at(i + 1, j), at(i, j + 1));
      const upper = corner(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
      crack(lower, upper);
      crack(upper, corner(at(i + 1, j), at(i + 2, j), at(i + 1, j + 1)));
      crack(upper, corner(at(i, j + 1), at(i + 1, j + 1), at(i, j + 2)));
    }
  }
  // Grid lines: faint and darker than the ground (a pale line would not show on it), like graded survey lines.
  g.fillStyle = "rgba(120, 104, 84, 0.2)";
  for (const p of [0, size / 2]) {
    g.fillRect(p - 2, 0, 4, size);
    g.fillRect(0, p - 2, size, 4);
  }
  g.fillRect(size - 2, 0, 2, size);
  g.fillRect(0, size - 2, size, 2);
  return toTexture(c, scene, "mojave-ground");
}

/**
 * The lie of the land, stretched once over the whole ground and multiplied
 * into it: the bright salt pan in the middle, sandier and darker toward the
 * mountains, with long streaks where the wind and old floods ran. It hides the
 * repeat of the small tile.
 */
export function landTexture(scene: Scene): Texture {
  const size = 256;
  const [c, g] = canvas(size);
  g.fillStyle = "#efe2c8";
  g.fillRect(0, 0, size, size);
  // The pan: white in the middle, fading out.
  const pan = g.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.46);
  pan.addColorStop(0, "rgba(255, 255, 255, 1)");
  pan.addColorStop(0.55, "rgba(255, 253, 246, 0.85)");
  pan.addColorStop(1, "rgba(255, 250, 235, 0)");
  g.fillStyle = pan;
  g.fillRect(0, 0, size, size);
  const r = rng(404);
  for (let i = 0; i < 70; i++) {
    const x = r() * size, y = r() * size, rad = 5 + r() * 22;
    g.fillStyle = r() > 0.6 ? `rgba(196, 164, 120, ${0.04 + r() * 0.07})` : `rgba(255, 255, 255, ${0.08 + r() * 0.14})`;
    g.beginPath();
    g.ellipse(x, y, rad * (1.5 + r() * 2.5), rad * 0.45, 0.5 + (r() - 0.5) * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  const texture = toTexture(c, scene, "mojave-land", false);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** Vertical sky gradient from straight up to below the horizon; the middle of the image is the horizon. */
export function skyTexture(scene: Scene): Texture {
  const [c, g] = canvas(256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  // Babylon's sphere maps the top of the image to the bottom pole, so the stops run upside down.
  grad.addColorStop(1, "#1f62b8");
  grad.addColorStop(0.78, "#3a86d6");
  grad.addColorStop(0.62, "#7db6e6");
  grad.addColorStop(0.54, "#c3dceb");
  grad.addColorStop(0.5, "#ebe6d8");
  grad.addColorStop(0, "#e6dcc8");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const texture = toTexture(c, scene, "mojave-sky");
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** The sun: a white-hot disc in a wide warm glow, clear at the edge. */
export function sunTexture(scene: Scene): Texture {
  const size = 256;
  const [c, g] = canvas(size);
  const glow = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.085, "rgba(255, 255, 250, 1)");
  glow.addColorStop(0.12, "rgba(255, 250, 225, 0.7)");
  glow.addColorStop(0.3, "rgba(255, 244, 205, 0.26)");
  glow.addColorStop(1, "rgba(255, 236, 180, 0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  const texture = new Texture(c.toDataURL("image/png"), scene, false, true, Texture.BILINEAR_SAMPLINGMODE);
  texture.name = "mojave-sun";
  texture.hasAlpha = true;
  return texture;
}
