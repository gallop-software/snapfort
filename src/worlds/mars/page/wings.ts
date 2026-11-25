import { CELL, WORLD_HALF_CELLS } from "../../../game/constants";
import type { DriveInput, PageGame, WorldFeature } from "../../pageDoors";
import { WINGS, wingStep } from "../wingRules";
import { sky } from "./air";
import { inWall as walled, surfaceUnder as under } from "./solid";

/** Half a builder's height: the body's centre is this far above the feet. */
const HALF = 0.9;
const EDGE = WORLD_HALF_CELLS * CELL + 10;

export interface WingsFeature extends WorldFeature {
  /** Whether this player is flying (for the checks that drive it). */
  flying(): boolean;
  /** Spreads the wings now if they can be (for the checks). */
  open(): boolean;
}

/**
 * The page's side of Mars's wings (see ../wingRules.ts). In the air, well
 * clear of the ground, the jump key spreads them; from then on the player
 * flies where they look (down to dive and gain speed, up to climb on it), the
 * jump key held flaps for height when the air is thick, and the back key
 * brakes. Touching down folds them. How well they carry is all down to the
 * air: none on red Mars, and they do not open.
 *
 * The player's own page moves them (as with the Moon's rail gun's flight
 * down); everyone else sees them gliding, wings out.
 */
export function startWings(game: PageGame): WingsFeature {
  let flying: { x: number; y: number; z: number; speed: number; yaw: number } | null = null;
  /** The jump key as it was last frame, and whether it has been let go since the wings opened (so the press that opens them does not flap). */
  let jumpWas = false, released = false;
  let told = -Infinity, wind = 0;

  const surfaceUnder = (x: number, feet: number, z: number) => under(game, x, feet, z);
  const inWall = (x: number, y: number, z: number) => walled(game, x, y - HALF, z, HALF * 2);

  const clear = () => { const p = game.player.position; return p.y - HALF - surfaceUnder(p.x, p.y - HALF, p.z); };
  const canOpen = () => !flying && !game.player.knockedDown && clear() > WINGS.clearance;

  function open(): boolean {
    if (!canOpen()) return false;
    if (sky.air < WINGS.least) {
      if (performance.now() - told > 6000) {
        told = performance.now();
        game.toast(sky.to > 0 ? "The air is still too thin for wings: give the Terraformer a little longer" : "The air is too thin for wings. Mars needs its Terraformer built and running", 4500);
      }
      return false;
    }
    const p = game.player.position;
    flying = { x: p.x, y: p.y, z: p.z, speed: WINGS.open, yaw: game.viewYaw() };
    released = false;
    game.sound.noise(0.25, 0.18, 1400);
    game.sound.tone("sine", 300, 520, 0.18, 0.12);
    return true;
  }

  return {
    flying: () => flying !== null,
    open,

    drive(dt: number, input: DriveInput): boolean {
      const pressed = input.jump && !jumpWas;
      jumpWas = input.jump;
      if (!flying) {
        if (pressed) open();
        if (!flying) return false;
      }
      if (game.player.knockedDown) {
        flying = null;
        return false;
      }
      if (!input.jump) released = true;
      const f = flying;
      // Turned toward where the player looks, not snapped: a wide turn at speed.
      let turn = input.yaw - f.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      f.yaw += turn * Math.min(1, dt * 3.2);
      const step = wingStep(f.speed, game.viewPitch(), sky.air, game.env.gravity, dt, input.jump && released, input.forward < -0.3);
      f.speed = step.speed;
      const nx = Math.max(-EDGE, Math.min(EDGE, f.x + Math.sin(f.yaw) * step.forward * dt));
      const nz = Math.max(-EDGE, Math.min(EDGE, f.z + Math.cos(f.yaw) * step.forward * dt));
      let ny = Math.min(WINGS.ceiling, f.y + step.up * dt);
      if (inWall(nx, ny, nz)) {
        // Into something: stopped short, and most of the speed gone.
        f.speed = Math.min(f.speed, 5);
      } else {
        f.x = nx;
        f.z = nz;
      }
      // Touching down folds them.
      const ground = surfaceUnder(f.x, f.y - HALF, f.z);
      if (ny - HALF <= ground) {
        ny = ground + HALF;
        game.player.seat(f.x, ny, f.z);
        flying = null;
        game.sound.tone("sine", 120, 60, 0.12, 0.3);
        return true;
      }
      f.y = ny;
      game.player.fly(f.x, f.y, f.z);
      // The wind in them: louder the faster.
      wind -= dt;
      if (wind <= 0) {
        wind = 0.45;
        game.sound.noise(0.5, 0.012 + 0.05 * (f.speed / WINGS.fastest), 500 + 900 * (f.speed / WINGS.fastest));
      }
      return true;
    },

    /** Hands busy while flying: no building in the air. */
    busy: () => flying !== null,

    /** On phones the button spreads them; with keys it is the jump key. */
    board(): boolean {
      return !flying && sky.air >= WINGS.least && open();
    },

    prompt() {
      // (On phones the hint would put up a button that does nothing: the jump button flaps there.)
      if (flying && game.touch) return null;
      if (flying) return { text: sky.air >= WINGS.flapFrom ? "Look where you want to fly · hold <kbd>Space</kbd> to flap up · <kbd>S</kbd> brakes" : "Look where you want to fly: down to gain speed · <kbd>S</kbd> brakes", button: "" };
      if (sky.air >= WINGS.least && canOpen()) return { text: "<kbd>Space</kbd> spread your wings", button: "Wings" };
      return null;
    },
  };
}
