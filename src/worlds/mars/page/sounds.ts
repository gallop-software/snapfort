import type { SoundKit, SoundTable } from "../../pageDoors";
import { sky } from "./air";

/**
 * Mars's sounds. The air is real but under a hundredth as thick as the
 * Earth's, and it swallows high notes: everything arrives quiet, dull and
 * low, as the rovers' microphones recorded it. The suit's own radio and servos
 * add the only clean notes.
 *
 * Thicken the air (see ./air.ts) and sound comes back: every sound here is
 * made through `inAir`, which lets it grow louder and brighter with the air.
 *
 * Copied from the Moon's, which were already soft.
 */

/** A sound kit as heard through the air as it is now: up to half as loud again, and noise up to two and a half times as bright. */
function inAir(k: SoundKit): SoundKit {
  const a = sky.air;
  if (a <= 0) return k;
  return {
    ...k,
    tone: (type, from, to, seconds, volume, delay) => k.tone(type, from, to, seconds, volume * (1 + 0.5 * a), delay),
    noise: (seconds, volume, cutoff) => k.noise(seconds, volume * (1 + 0.5 * a), cutoff * (1 + 1.5 * a)),
  };
}

/** Every sound in a table, made through the air. */
function through(table: SoundTable): SoundTable {
  const made: Record<string, unknown> = {};
  for (const [name, play] of Object.entries(table)) made[name] = (k: SoundKit, ...rest: unknown[]) => (play as (k: SoundKit, ...rest: unknown[]) => void)(inAir(k), ...rest);
  return made as unknown as SoundTable;
}

const dry: SoundTable = {
  /** Thrown: a rising whoop over the radio. */
  yelp(k) {
    k.tone("sine", 360, 1100, 0.5, 0.26);
    k.tone("sine", 1100, 640, 0.7, 0.16, 0.45);
    k.noise(0.25, 0.06, 2600);
  },
  /** The launcher fires: a hard electric crack, and the kick through the ground. */
  launch(k) {
    k.tone("sawtooth", 1400, 160, 0.12, 0.16);
    k.noise(0.1, 0.3, 3200);
    k.tone("sine", 95, 30, 0.45, 0.6, 0.02);
  },
  /** A chunk of rock lands: a dull thump. Quieter further away. */
  boom(k, near) {
    const v = 0.25 + 0.75 * near;
    k.tone("sine", 82, 26, 0.9, 1.0 * v);
    k.tone("sine", 48, 30, 0.6, 0.5 * v, 0.06);
    k.noise(0.4, 0.3 * v, 300);
  },
  /** A soft thud through the boots, and the suit's click that it is locked on. */
  place(k) {
    k.tone("sine", 130, 62, 0.14, 0.55);
    k.tone("sine", 1250, 1500, 0.035, 0.1, 0.02);
    k.noise(0.05, 0.12, 500);
  },
  remove(k) {
    k.tone("sine", 110, 44, 0.2, 0.5);
    k.tone("sine", 900, 600, 0.05, 0.08);
    k.noise(0.1, 0.14, 320);
  },
  /** A cutter: a short rising buzz. */
  edit(k) {
    k.tone("sawtooth", 420, 1300, 0.09, 0.07);
    k.tone("sine", 1300, 1300, 0.04, 0.08, 0.09);
  },
  undo(k) {
    k.tone("sine", 620, 440, 0.09, 0.22);
  },
  redo(k) {
    k.tone("sine", 440, 620, 0.09, 0.22);
  },
  select(k) {
    k.tone("sine", 880, 940, 0.04, 0.12);
  },
  /** Someone said something: the radio opens with a blip. */
  chat(k) {
    k.tone("sine", 1040, 1040, 0.05, 0.09);
    k.noise(0.05, 0.03, 3200);
  },
  /** A spot was pinged: two clean notes. */
  ping(k) {
    k.tone("sine", 1100, 1100, 0.07, 0.13);
    k.tone("sine", 1650, 1650, 0.1, 0.11, 0.08);
  },
  rotate(k) {
    k.tone("sine", 520, 700, 0.06, 0.14);
  },
  deny(k) {
    k.tone("square", 150, 150, 0.07, 0.07);
    k.tone("square", 150, 150, 0.07, 0.07, 0.1);
  },
  /** A soldier thumping on a piece. */
  knock(k) {
    k.tone("sine", 100 + Math.random() * 40, 55, 0.08, 0.24);
    k.noise(0.04, 0.06, 400);
  },
  /** Pieces breaking or falling: slow, low, and nearly silent. */
  crumble(k) {
    k.tone("sine", 70, 30, 0.5, 0.4);
    k.noise(0.4, 0.18, 260);
  },
  /** Two rising notes: a new wave is coming. */
  horn(k) {
    k.tone("sine", 392, 392, 0.3, 0.16);
    k.tone("sine", 587, 587, 0.5, 0.16, 0.32);
  },
  /** A falling three-note phrase: caught. */
  caught(k) {
    k.tone("sine", 523, 523, 0.2, 0.26);
    k.tone("sine", 415, 415, 0.2, 0.26, 0.22);
    k.tone("sine", 262, 240, 0.6, 0.26, 0.44);
  },
};

export const sounds: SoundTable = through(dry);
