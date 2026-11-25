import type { SoundTable } from "../../pageDoors";

/**
 * Mojave's sounds: dry desert air and military kit. Nothing rings on: every
 * sound is short and punchy, with a clean electronic note on top from the
 * suit's own systems. The rail battery cracks; what it hits goes off with a
 * sharp dry blast.
 *
 * Copied from the Meadow (2026-11-25) and changed from there; the two share no code.
 */
export const sounds: SoundTable = {
  /** Thrown into the air: a shout over the radio, clipped, with a burst of static. */
  yelp(k) {
    k.tone("square", 380, 900, 0.22, 0.12);
    k.tone("triangle", 900, 460, 0.45, 0.2, 0.2);
    k.noise(0.12, 0.1, 4200);
  },
  /** The rail battery fires: the capacitors let go with a crack, a falling electric whip, and the kick through the ground. */
  launch(k) {
    k.noise(0.06, 0.55, 7000);
    k.tone("sawtooth", 3200, 180, 0.16, 0.2);
    k.tone("square", 1800, 90, 0.09, 0.14);
    k.tone("sine", 120, 34, 0.32, 0.6, 0.01);
    // The rails ring for a moment after.
    k.tone("sine", 2400, 2250, 0.3, 0.04, 0.05);
  },
  /** A slug lands: a sharp dry blast with no echo, and a patter of grit. Quieter further away. */
  boom(k, near) {
    const v = 0.25 + 0.75 * near;
    k.noise(0.09, 0.7 * v, 5200);
    k.tone("sine", 150, 36, 0.34, 0.95 * v);
    k.tone("square", 210, 50, 0.1, 0.22 * v);
    k.noise(0.4, 0.3 * v, 900);
  },
  /** A piece locks home: a hard clack and the suit's confirming blip. */
  place(k) {
    k.tone("square", 240, 110, 0.06, 0.24);
    k.noise(0.035, 0.3, 3200);
    k.tone("sine", 1480, 1480, 0.045, 0.1, 0.035);
  },
  /** A piece released: the latch lets go and the blip falls. */
  remove(k) {
    k.tone("square", 170, 70, 0.09, 0.22);
    k.noise(0.08, 0.26, 1400);
    k.tone("sine", 1100, 740, 0.06, 0.08, 0.03);
  },
  /** A quick servo zip when an edit is confirmed. */
  edit(k) {
    k.tone("sawtooth", 420, 1300, 0.06, 0.08);
    k.noise(0.04, 0.16, 4000);
  },
  undo(k) {
    k.tone("triangle", 620, 440, 0.07, 0.24);
  },
  redo(k) {
    k.tone("triangle", 440, 620, 0.07, 0.24);
  },
  select(k) {
    k.tone("square", 880, 880, 0.03, 0.06);
  },
  /** Someone said something: a radio's click and a short high note. */
  chat(k) {
    k.noise(0.02, 0.1, 5000);
    k.tone("sine", 1240, 1240, 0.05, 0.09, 0.015);
  },
  /** A spot was pinged: two clean sonar notes. */
  ping(k) {
    k.tone("sine", 1175, 1175, 0.08, 0.14);
    k.tone("sine", 1760, 1760, 0.12, 0.11, 0.09);
  },
  rotate(k) {
    k.tone("triangle", 520, 700, 0.05, 0.16);
  },
  /** A flat low buzz: no. */
  deny(k) {
    k.tone("square", 140, 140, 0.07, 0.1);
    k.tone("square", 140, 110, 0.09, 0.1, 0.09);
  },
  /** Something beating on a piece: a hard dry rap. */
  knock(k) {
    k.tone("square", 150 + Math.random() * 60, 80, 0.045, 0.14);
    k.noise(0.03, 0.16, 2200);
  },
  /** Pieces breaking or falling: a crack, then rubble sliding on hard ground. */
  crumble(k) {
    k.noise(0.05, 0.4, 3800);
    k.tone("triangle", 110, 42, 0.22, 0.4);
    k.noise(0.32, 0.3, 800);
  },
  /** A two-tone klaxon, twice: a new wave is coming. */
  horn(k) {
    for (const start of [0, 0.42]) {
      k.tone("sawtooth", 370, 370, 0.18, 0.13, start);
      k.tone("sawtooth", 277, 277, 0.2, 0.13, start + 0.18);
    }
  },
  /** Three falling flat notes: caught. */
  caught(k) {
    k.tone("square", 440, 440, 0.14, 0.14);
    k.tone("square", 330, 330, 0.14, 0.14, 0.17);
    k.tone("square", 220, 196, 0.45, 0.14, 0.34);
  },
};
