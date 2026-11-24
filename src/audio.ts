import type { SoundKit, SoundTable } from "./worlds/pageDoors";

/**
 * Sound effects made with the Web Audio API, so the game ships no audio files.
 * What each sound is belongs to the world (its SoundTable); this plays them.
 */
export class Sfx {
  private readonly kit: SoundKit = { tone: (...a) => this.tone(...a), noise: (...a) => this.noise(...a) };

  constructor(private readonly table: SoundTable) {}

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 0.5;
  /** No sound at all while true. */
  muted = false;

  /** Browsers only allow sound after a click or key press; call this from one. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  yelp(): void {
    this.table.yelp(this.kit);
  }

  launch(): void {
    this.table.launch(this.kit);
  }

  place(): void {
    this.table.place(this.kit);
  }

  remove(): void {
    this.table.remove(this.kit);
  }

  edit(): void {
    this.table.edit(this.kit);
  }

  undo(): void {
    this.table.undo(this.kit);
  }

  redo(): void {
    this.table.redo(this.kit);
  }

  select(): void {
    this.table.select(this.kit);
  }

  chat(): void {
    this.table.chat(this.kit);
  }

  ping(): void {
    this.table.ping(this.kit);
  }

  rotate(): void {
    this.table.rotate(this.kit);
  }

  deny(): void {
    this.table.deny(this.kit);
  }

  knock(): void {
    this.table.knock(this.kit);
  }

  crumble(): void {
    this.table.crumble(this.kit);
  }

  horn(): void {
    this.table.horn(this.kit);
  }

  caught(): void {
    this.table.caught(this.kit);
  }

  /** A builder's way back from a throw starts, lasting `seconds` (worlds that have one). */
  glide(seconds: number): void {
    this.table.glide?.(this.kit, seconds);
  }

  /** A stone lands. Quieter further away (`near` 0..1). */
  boom(near = 1): void {
    this.table.boom(this.kit, near);
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(amp).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noise(duration: number, gain: number, cutoff: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const length = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    source.connect(filter).connect(amp).connect(this.master);
    source.start();
  }
}
