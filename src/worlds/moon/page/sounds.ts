import type { SoundTable } from "../../pageDoors";

/** The Moon's sounds (for now the same as where they were copied from). */
export const sounds: SoundTable = {
  /** Thrown into the air: a wobbling "whoaaa". */
  yelp(k) {
    k.tone("sine", 420, 980, 0.35, 0.3);
    k.tone("triangle", 980, 520, 0.6, 0.22, 0.32);
    k.tone("sine", 700, 1100, 0.2, 0.12, 0.1);
  },
  /** The arm swings: a creak and a whoosh. */
  launch(k) {
    k.tone("sawtooth", 90, 60, 0.25, 0.12);
    k.noise(0.45, 0.22, 900);
    k.tone("triangle", 260, 120, 0.3, 0.25, 0.08);
  },
  /** A stone lands: a deep thud and a spray of rubble. Quieter further away. */
  boom(k, near) {
    const v = 0.25 + 0.75 * near;
    k.tone("sine", 110, 38, 0.6, 0.9 * v);
    k.noise(0.5, 0.55 * v, 1200);
    k.tone("triangle", 70, 40, 0.4, 0.5 * v, 0.05);
  },
  /** A woody knock with a bright click on top. */
  place(k) {
    k.tone("triangle", 190, 95, 0.11, 0.5);
    k.tone("square", 900, 520, 0.035, 0.12);
    k.noise(0.05, 0.25, 1800);
  },
  remove(k) {
    k.tone("triangle", 150, 60, 0.16, 0.45);
    k.noise(0.12, 0.3, 700);
  },
  /** A quick zip when an edit is confirmed. */
  edit(k) {
    k.tone("square", 300, 900, 0.07, 0.1);
    k.noise(0.06, 0.18, 2500);
  },
  undo(k) {
    k.tone("sine", 520, 390, 0.08, 0.25);
  },
  redo(k) {
    k.tone("sine", 390, 520, 0.08, 0.25);
  },
  select(k) {
    k.tone("sine", 660, 700, 0.04, 0.14);
  },
  /** Someone said something: a soft pop. */
  chat(k) {
    k.tone("sine", 820, 980, 0.06, 0.1);
  },
  /** A spot was pinged: two bright notes. */
  ping(k) {
    k.tone("sine", 990, 990, 0.07, 0.14);
    k.tone("sine", 1320, 1320, 0.09, 0.12, 0.08);
  },
  rotate(k) {
    k.tone("sine", 440, 587, 0.06, 0.16);
  },
  deny(k) {
    k.tone("sawtooth", 120, 95, 0.12, 0.16);
  },
  /** A soldier thumping on a piece. */
  knock(k) {
    k.tone("triangle", 120 + Math.random() * 50, 70, 0.07, 0.22);
    k.noise(0.04, 0.12, 900);
  },
  /** Pieces breaking or falling. */
  crumble(k) {
    k.tone("triangle", 90, 40, 0.3, 0.4);
    k.noise(0.3, 0.4, 500);
  },
  /** Two rising notes: a new wave is coming. */
  horn(k) {
    k.tone("sawtooth", 196, 196, 0.35, 0.16);
    k.tone("sawtooth", 294, 294, 0.6, 0.16, 0.36);
  },
  /** A falling three-note phrase: caught. */
  caught(k) {
    k.tone("triangle", 392, 392, 0.2, 0.3);
    k.tone("triangle", 311, 311, 0.2, 0.3, 0.22);
    k.tone("triangle", 196, 180, 0.6, 0.3, 0.44);
  },
};
