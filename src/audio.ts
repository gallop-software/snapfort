/** Sound effects made with the Web Audio API, so the game ships no audio files. */
export class Sfx {
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

  /** Thrown into the air: a wobbling "whoaaa". */
  yelp(): void {
    this.tone("sine", 420, 980, 0.35, 0.3);
    this.tone("triangle", 980, 520, 0.6, 0.22, 0.32);
    this.tone("sine", 700, 1100, 0.2, 0.12, 0.1);
  }

  /** The arm swings: a creak and a whoosh. */
  launch(): void {
    this.tone("sawtooth", 90, 60, 0.25, 0.12);
    this.noise(0.45, 0.22, 900);
    this.tone("triangle", 260, 120, 0.3, 0.25, 0.08);
  }

  /** A stone lands: a deep thud and a spray of rubble. Quieter further away (`near` 0..1). */
  boom(near = 1): void {
    const v = 0.25 + 0.75 * near;
    this.tone("sine", 110, 38, 0.6, 0.9 * v);
    this.noise(0.5, 0.55 * v, 1200);
    this.tone("triangle", 70, 40, 0.4, 0.5 * v, 0.05);
  }

  /** A woody knock with a bright click on top. */
  place(): void {
    this.tone("triangle", 190, 95, 0.11, 0.5);
    this.tone("square", 900, 520, 0.035, 0.12);
    this.noise(0.05, 0.25, 1800);
  }

  remove(): void {
    this.tone("triangle", 150, 60, 0.16, 0.45);
    this.noise(0.12, 0.3, 700);
  }

  /** A quick zip when an edit is confirmed. */
  edit(): void {
    this.tone("square", 300, 900, 0.07, 0.1);
    this.noise(0.06, 0.18, 2500);
  }

  undo(): void {
    this.tone("sine", 520, 390, 0.08, 0.25);
  }

  redo(): void {
    this.tone("sine", 390, 520, 0.08, 0.25);
  }

  select(): void {
    this.tone("sine", 660, 700, 0.04, 0.14);
  }

  rotate(): void {
    this.tone("sine", 440, 587, 0.06, 0.16);
  }

  deny(): void {
    this.tone("sawtooth", 120, 95, 0.12, 0.16);
  }

  /** A soldier thumping on a piece. */
  knock(): void {
    this.tone("triangle", 120 + Math.random() * 50, 70, 0.07, 0.22);
    this.noise(0.04, 0.12, 900);
  }

  /** Pieces breaking or falling. */
  crumble(): void {
    this.tone("triangle", 90, 40, 0.3, 0.4);
    this.noise(0.3, 0.4, 500);
  }

  /** Two rising notes: a new wave is coming. */
  horn(): void {
    this.tone("sawtooth", 196, 196, 0.35, 0.16);
    this.tone("sawtooth", 294, 294, 0.6, 0.16, 0.36);
  }

  /** A falling three-note phrase: caught. */
  caught(): void {
    this.tone("triangle", 392, 392, 0.2, 0.3);
    this.tone("triangle", 311, 311, 0.2, 0.3, 0.22);
    this.tone("triangle", 196, 180, 0.6, 0.3, 0.44);
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
