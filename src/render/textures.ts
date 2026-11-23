import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { MaterialId, PieceType } from "../game/pieces";

/**
 * All art is drawn here with canvas 2D, so the game ships no image files.
 * Piece textures are near-white line work; the material colour is multiplied
 * in per piece. The texture spans the whole face of a piece, so its border
 * outlines each piece and edit tiles line up with the pattern.
 */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

function toTexture(c: HTMLCanvasElement, scene: Scene, name: string): Texture {
  const texture = new Texture(c.toDataURL("image/png"), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = name;
  texture.anisotropicFilteringLevel = 8;
  return texture;
}

/** Small deterministic random source so the art is the same on every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const S = 256;
const LINE = "rgba(40, 30, 20, 0.26)";

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function wood(g: CanvasRenderingContext2D, r: () => number): void {
  // Planks across the piece, with grain streaks, butt joints and nails.
  const planks = 6;
  const h = S / planks;
  for (let i = 0; i < planks; i++) {
    const y = i * h;
    g.fillStyle = `rgba(90, 55, 25, ${0.03 + r() * 0.06})`;
    g.fillRect(0, y, S, h);
    g.strokeStyle = "rgba(90, 55, 25, 0.10)";
    g.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      const gy = y + 6 + r() * (h - 12);
      g.beginPath();
      g.moveTo(0, gy);
      g.bezierCurveTo(S * 0.3, gy + (r() - 0.5) * 6, S * 0.6, gy + (r() - 0.5) * 6, S, gy);
      g.stroke();
    }
    g.strokeStyle = LINE;
    g.lineWidth = 3;
    if (i > 0) line(g, 0, y, S, y);
    const joint = 40 + r() * (S - 80);
    line(g, joint, y, joint, y + h);
    g.fillStyle = "rgba(40, 30, 20, 0.35)";
    for (const nx of [joint - 7, joint + 7]) {
      g.fillRect(nx - 1.5, y + h * 0.3 - 1.5, 3, 3);
      g.fillRect(nx - 1.5, y + h * 0.7 - 1.5, 3, 3);
    }
  }
}

function brick(g: CanvasRenderingContext2D, r: () => number): void {
  // Staggered courses with uneven brick shades and mortar lines.
  const rows = 8;
  const h = S / rows;
  const w = S / 4;
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : w / 2;
    for (let x = -offset; x < S; x += w) {
      g.fillStyle = r() > 0.5 ? `rgba(120, 40, 20, ${r() * 0.1})` : `rgba(255, 240, 220, ${r() * 0.12})`;
      g.fillRect(x + 2, row * h + 2, w - 4, h - 4);
    }
  }
  g.strokeStyle = "rgba(255, 250, 240, 0.55)";
  g.lineWidth = 3;
  for (let row = 0; row <= rows; row++) line(g, 0, row * h, S, row * h);
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : w / 2;
    for (let x = offset; x < S; x += w) if (x > 0) line(g, x, row * h, x, row * h + h);
  }
  g.strokeStyle = "rgba(60, 25, 15, 0.18)";
  g.lineWidth = 1;
  for (let row = 0; row <= rows; row++) line(g, 0, row * h + 2, S, row * h + 2);
}

function metal(g: CanvasRenderingContext2D, r: () => number): void {
  // Four plates with brushed streaks, a cross brace and rivets.
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255, 255, 255, ${r() * 0.08})`;
    g.fillRect(r() * S, r() * S, 30 + r() * 60, 1);
  }
  g.strokeStyle = "rgba(30, 40, 55, 0.30)";
  g.lineWidth = 4;
  line(g, S / 2, 0, S / 2, S);
  line(g, 0, S / 2, S, S / 2);
  g.strokeStyle = "rgba(255, 255, 255, 0.35)";
  g.lineWidth = 1.5;
  line(g, S / 2 + 3, 0, S / 2 + 3, S);
  line(g, 0, S / 2 + 3, S, S / 2 + 3);
  for (const [ox, oy] of [[0, 0], [S / 2, 0], [0, S / 2], [S / 2, S / 2]] as const) {
    g.strokeStyle = "rgba(30, 40, 55, 0.12)";
    g.lineWidth = 8;
    line(g, ox + 22, oy + 22, ox + S / 2 - 22, oy + S / 2 - 22);
    for (const [rx, ry] of [[14, 14], [S / 2 - 14, 14], [14, S / 2 - 14], [S / 2 - 14, S / 2 - 14]] as const) {
      g.fillStyle = "rgba(30, 40, 55, 0.4)";
      g.beginPath();
      g.arc(ox + rx, oy + ry, 4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255, 255, 255, 0.6)";
      g.beginPath();
      g.arc(ox + rx - 1, oy + ry - 1, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  }
}

const PATTERNS: Record<MaterialId, (g: CanvasRenderingContext2D, r: () => number) => void> = { wood, brick, metal };

export function pieceTexture(type: PieceType, material: MaterialId, scene: Scene): Texture {
  const [c, g] = canvas(S);
  g.fillStyle = "#fbfbfb";
  g.fillRect(0, 0, S, S);
  const r = rng(material.length * 131 + type.charCodeAt(0) * 7 + material.charCodeAt(0));
  PATTERNS[material](g, r);

  if (type === "ramp") {
    // Treads across the slope so a ramp reads as stairs.
    for (let i = 1; i < 8; i++) {
      const y = (i * S) / 8;
      g.fillStyle = "rgba(40, 30, 20, 0.16)";
      g.fillRect(0, y - 5, S, 5);
      g.fillStyle = "rgba(255, 255, 255, 0.35)";
      g.fillRect(0, y, S, 2);
    }
  }

  // Border: a dark edge so each piece reads on its own, with a light bevel inside.
  g.strokeStyle = "rgba(40, 30, 20, 0.38)";
  g.lineWidth = 10;
  g.strokeRect(0, 0, S, S);
  g.strokeStyle = "rgba(255, 255, 255, 0.45)";
  g.lineWidth = 2;
  g.strokeRect(8, 8, S - 16, S - 16);
  return toTexture(c, scene, `piece-${type}-${material}`);
}

/** Meadow with a faint line on every grid cell edge. One tile covers 2 x 2 cells. */
export function groundTexture(scene: Scene): Texture {
  const size = 512;
  const [c, g] = canvas(size);
  g.fillStyle = "#8dbb6e";
  g.fillRect(0, 0, size, size);
  const r = rng(7);
  for (let i = 0; i < 260; i++) {
    const x = r() * size, y = r() * size, rad = 6 + r() * 26;
    g.fillStyle = r() > 0.5 ? `rgba(255, 244, 190, ${0.03 + r() * 0.05})` : `rgba(30, 90, 60, ${0.03 + r() * 0.05})`;
    // Draw wrapped copies so the tile repeats without a seam.
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        g.beginPath();
        g.ellipse(x + ox, y + oy, rad, rad * (0.5 + r() * 0.2), 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.fillStyle = "rgba(255, 250, 225, 0.30)";
  for (const p of [0, size / 2]) {
    g.fillRect(p - 2, 0, 4, size);
    g.fillRect(0, p - 2, size, 4);
  }
  g.fillRect(size - 2, 0, 2, size);
  g.fillRect(0, size - 2, size, 2);
  return toTexture(c, scene, "ground");
}

/** Vertical sky gradient from straight up to below the horizon; the middle of the image is the horizon. */
export function skyTexture(scene: Scene): Texture {
  const [c, g] = canvas(256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  // Babylon's sphere maps the top of the image to the bottom pole, so the stops run upside down.
  grad.addColorStop(1, "#3d93bd");
  grad.addColorStop(0.7, "#74bfd0");
  grad.addColorStop(0.56, "#c5e3d2");
  grad.addColorStop(0.5, "#fbe9c8");
  grad.addColorStop(0, "#f3dfb9");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const texture = toTexture(c, scene, "sky");
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** The Moon's dust: grey, with craters (dark bowls, bright rims) and the same faint cell lines. */
export function moonGroundTexture(scene: Scene): Texture {
  const size = 512;
  const [c, g] = canvas(size);
  g.fillStyle = "#9a9a9f";
  g.fillRect(0, 0, size, size);
  const r = rng(29);
  const wrapped = (draw: (ox: number, oy: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(ox, oy);
  };
  // Dusty speckle.
  for (let i = 0; i < 900; i++) {
    const x = r() * size, y = r() * size, rad = 1 + r() * 3;
    g.fillStyle = r() > 0.5 ? `rgba(255, 255, 255, ${0.04 + r() * 0.06})` : `rgba(20, 20, 30, ${0.04 + r() * 0.07})`;
    wrapped((ox, oy) => {
      g.beginPath();
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      g.fill();
    });
  }
  // Craters: a darker bowl, shaded on one side, with a bright rim.
  for (let i = 0; i < 26; i++) {
    const x = r() * size, y = r() * size, rad = 8 + r() * r() * 46;
    wrapped((ox, oy) => {
      const cx = x + ox, cy = y + oy;
      const bowl = g.createRadialGradient(cx - rad * 0.25, cy - rad * 0.25, rad * 0.1, cx, cy, rad);
      bowl.addColorStop(0, "rgba(40, 40, 50, 0.30)");
      bowl.addColorStop(0.85, "rgba(60, 60, 70, 0.16)");
      bowl.addColorStop(1, "rgba(60, 60, 70, 0)");
      g.fillStyle = bowl;
      g.beginPath();
      g.arc(cx, cy, rad, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(235, 235, 240, 0.28)";
      g.lineWidth = Math.max(1.5, rad * 0.08);
      g.beginPath();
      g.arc(cx, cy, rad * 0.97, Math.PI * 0.15, Math.PI * 1.15);
      g.stroke();
    });
  }
  g.fillStyle = "rgba(255, 255, 255, 0.16)";
  for (const p of [0, size / 2]) {
    g.fillRect(p - 2, 0, 4, size);
    g.fillRect(0, p - 2, size, 4);
  }
  g.fillRect(size - 2, 0, 2, size);
  g.fillRect(0, size - 2, size, 2);
  return toTexture(c, scene, "moon-ground");
}

/** A black sky full of stars, a faint band of the galaxy across it. */
export function starTexture(scene: Scene): Texture {
  const w = 2048, h = 1024;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#04040a";
  g.fillRect(0, 0, w, h);
  const r = rng(91);
  // The galaxy: a soft, tilted band.
  for (let i = 0; i < 3200; i++) {
    const x = r() * w;
    const y = h * 0.72 + Math.sin((x / w) * Math.PI * 2) * h * 0.08 + (r() - 0.5) * h * 0.12;
    g.fillStyle = `rgba(170, 180, 230, ${0.008 + r() * 0.018})`;
    g.beginPath();
    g.arc(x, y, 2 + r() * 7, 0, Math.PI * 2);
    g.fill();
  }
  // Stars: mostly tiny, a few bright ones with a soft glow. Babylon's sphere puts
  // the top of the image at the bottom pole, so the sky is the lower half here
  // (the upper half is below the horizon, behind the ground, and left plain).
  for (let i = 0; i < 2600; i++) {
    const x = r() * w, y = h * 0.45 + r() * h * 0.55;
    const bright = r();
    const size = bright > 0.985 ? 2.2 : bright > 0.9 ? 1.4 : 0.8;
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

/** The Earth seen from the Moon: blue oceans, green and brown land, swirls of white cloud. */
export function earthTexture(scene: Scene): Texture {
  const w = 512, h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const ocean = g.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, "#2f6fb8");
  ocean.addColorStop(0.5, "#2a7fd0");
  ocean.addColorStop(1, "#2f6fb8");
  g.fillStyle = ocean;
  g.fillRect(0, 0, w, h);
  const r = rng(5);
  // Land: clusters of blobs.
  for (let k = 0; k < 7; k++) {
    const cx = r() * w, cy = h * (0.2 + r() * 0.6);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = r() > 0.4 ? "#5f9a4a" : "#a48a5a";
      g.beginPath();
      g.ellipse(cx + (r() - 0.5) * 90, cy + (r() - 0.5) * 50, 8 + r() * 22, 6 + r() * 14, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Ice caps.
  g.fillStyle = "#f2f6fa";
  g.fillRect(0, 0, w, h * 0.07);
  g.fillRect(0, h * 0.93, w, h * 0.07);
  // Clouds: long thin swirls.
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(255, 255, 255, ${0.25 + r() * 0.35})`;
    g.lineWidth = 2 + r() * 4;
    const x = r() * w, y = r() * h, len = 30 + r() * 90;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len / 2, y + (r() - 0.5) * 24, x + len, y + (r() - 0.5) * 10);
    g.stroke();
  }
  return new Texture(c.toDataURL("image/png"), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
}
