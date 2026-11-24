import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { MaterialId, PieceType } from "../../../game/pieces";
import { canvas, line, rng, toTexture } from "../../../render/paint";
import type { PieceSkin } from "../../pageDoors";

/**
 * The Moon's art: lattice, regolith and titanium, grey cratered dust, a black sky full of stars and the Earth.
 * Piece textures are near-white line work; the material colour is multiplied
 * in per piece. The texture spans the whole face of a piece, so its border
 * outlines each piece and edit tiles line up with the pattern.
 */
const S = 256;
const LINE = "rgba(20, 24, 34, 0.30)";

/** Lattice (the light slot): a thin skin over a truss. Crossed braces in each bay, gussets at the joints. */
function lattice(g: CanvasRenderingContext2D, r: () => number): void {
  const bays = 2;
  const w = S / bays;
  // Foil skin: faint crinkles.
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(255, 255, 255, ${0.05 + r() * 0.1})`;
    g.lineWidth = 1;
    const x = r() * S, y = r() * S, len = 10 + r() * 34, a = r() * Math.PI;
    line(g, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
  for (let bx = 0; bx < bays; bx++) {
    for (let by = 0; by < bays; by++) {
      const x = bx * w, y = by * w;
      // The braces, a dark strut with a light edge.
      for (const [x0, y0, x1, y1] of [[x, y, x + w, y + w], [x + w, y, x, y + w]] as const) {
        g.strokeStyle = "rgba(20, 24, 34, 0.26)";
        g.lineWidth = 9;
        line(g, x0, y0, x1, y1);
        g.strokeStyle = "rgba(255, 255, 255, 0.4)";
        g.lineWidth = 1.5;
        line(g, x0 + 3, y0, x1 + 3, y1);
      }
      // Hub where they cross.
      g.fillStyle = "rgba(20, 24, 34, 0.42)";
      g.beginPath();
      g.arc(x + w / 2, y + w / 2, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255, 255, 255, 0.55)";
      g.beginPath();
      g.arc(x + w / 2 - 2, y + w / 2 - 2, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // The frame between the bays.
  g.strokeStyle = LINE;
  g.lineWidth = 7;
  line(g, S / 2, 0, S / 2, S);
  line(g, 0, S / 2, S, S / 2);
}

/** Regolith (the middle slot): big blocks baked from moon dust, pitted and speckled. */
function regolith(g: CanvasRenderingContext2D, r: () => number): void {
  const rows = 4;
  const h = S / rows;
  const w = S / 2;
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : w / 2;
    for (let x = -offset; x < S; x += w) {
      g.fillStyle = r() > 0.5 ? `rgba(20, 20, 30, ${r() * 0.1})` : `rgba(255, 255, 255, ${r() * 0.1})`;
      g.fillRect(x + 2, row * h + 2, w - 4, h - 4);
    }
  }
  // Grit, and the small pits left by trapped gas.
  for (let i = 0; i < 520; i++) {
    g.fillStyle = r() > 0.5 ? `rgba(255, 255, 255, ${0.06 + r() * 0.12})` : `rgba(20, 20, 30, ${0.06 + r() * 0.12})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rad = 2 + r() * 5;
    g.fillStyle = "rgba(20, 20, 30, 0.22)";
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255, 255, 255, 0.3)";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(x, y, rad, Math.PI * 0.2, Math.PI * 1.1);
    g.stroke();
  }
  // Joints: dark seams.
  g.strokeStyle = "rgba(20, 20, 30, 0.42)";
  g.lineWidth = 4;
  for (let row = 0; row <= rows; row++) line(g, 0, row * h, S, row * h);
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : w / 2;
    for (let x = offset; x < S; x += w) if (x > 0) line(g, x, row * h, x, row * h + h);
  }
}

/** Titanium (the heavy slot): hull plates, three across, with a stiffening rib and rows of bolts. */
function titanium(g: CanvasRenderingContext2D, r: () => number): void {
  // Brushed sheen, up and down.
  for (let i = 0; i < 200; i++) {
    g.fillStyle = `rgba(255, 255, 255, ${r() * 0.09})`;
    g.fillRect(r() * S, r() * S, 1, 26 + r() * 70);
  }
  const cols = 3;
  const w = S / cols;
  for (let c = 0; c < cols; c++) {
    const x = c * w;
    if (c > 0) {
      g.strokeStyle = "rgba(20, 30, 50, 0.34)";
      g.lineWidth = 4;
      line(g, x, 0, x, S);
      g.strokeStyle = "rgba(255, 255, 255, 0.4)";
      g.lineWidth = 1.5;
      line(g, x + 3, 0, x + 3, S);
    }
    // Bolts down both edges of the plate.
    for (let k = 0; k < 6; k++) {
      const y = 22 + (k * (S - 44)) / 5;
      for (const bx of [x + 13, x + w - 13]) {
        g.fillStyle = "rgba(20, 30, 50, 0.42)";
        g.beginPath();
        g.arc(bx, y, 3.4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(255, 255, 255, 0.65)";
        g.beginPath();
        g.arc(bx - 1, y - 1, 1.3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // A rib across the middle.
  g.fillStyle = "rgba(20, 30, 50, 0.16)";
  g.fillRect(0, S / 2 - 9, S, 18);
  g.fillStyle = "rgba(255, 255, 255, 0.4)";
  g.fillRect(0, S / 2 - 9, S, 2);
  g.fillStyle = "rgba(20, 30, 50, 0.3)";
  g.fillRect(0, S / 2 + 8, S, 2);
}

/** By slot: what the light, middle and heavy materials look like here. */
const PATTERNS: Record<MaterialId, (g: CanvasRenderingContext2D, r: () => number) => void> = { wood: lattice, brick: regolith, metal: titanium };

/** The look of one kind of piece in one material. Titanium shines; the foil on the lattice a little. */
export function pieceSkin(type: PieceType, material: MaterialId, scene: Scene): PieceSkin {
  return { texture: pieceTexture(type, material, scene), specular: material === "metal" ? 0.35 : material === "wood" ? 0.12 : 0 };
}

function pieceTexture(type: PieceType, material: MaterialId, scene: Scene): Texture {
  const [c, g] = canvas(S);
  g.fillStyle = "#fbfbfb";
  g.fillRect(0, 0, S, S);
  const r = rng(material.length * 131 + type.charCodeAt(0) * 7 + material.charCodeAt(0));
  PATTERNS[material](g, r);

  if (type === "ramp") {
    // Treads across the slope so a ramp reads as stairs.
    for (let i = 1; i < 8; i++) {
      const y = (i * S) / 8;
      g.fillStyle = "rgba(20, 24, 34, 0.18)";
      g.fillRect(0, y - 5, S, 5);
      g.fillStyle = "rgba(255, 255, 255, 0.35)";
      g.fillRect(0, y, S, 2);
    }
  }

  // Border: a dark edge so each piece reads on its own, with a light bevel inside.
  g.strokeStyle = "rgba(20, 24, 34, 0.42)";
  g.lineWidth = 10;
  g.strokeRect(0, 0, S, S);
  g.strokeStyle = "rgba(255, 255, 255, 0.45)";
  g.lineWidth = 2;
  g.strokeRect(8, 8, S - 16, S - 16);
  return toTexture(c, scene, `piece-${type}-${material}`);
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
