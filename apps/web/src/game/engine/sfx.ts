// Tiny synthesized sound effects. No audio files; WebAudio oscillators and noise.
let ctx: AudioContext | null = null;
let muted = false;

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
  }
  void ctx.resume();
}

export function setMuted(value: boolean) {
  muted = value;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(start: number, dur: number, gain: number, freq: number) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + start;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t);
}

export const sfx = {
  hit() {
    noise(0, 0.08, 0.5, 2400);
    tone(1800 + Math.random() * 400, 0, 0.12, 'triangle', 0.08, 900);
  },
  coin() {
    tone(988, 0, 0.09, 'square', 0.05);
    tone(1319, 0.08, 0.22, 'square', 0.05);
  },
  trade() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.2, 'triangle', 0.08));
  },
  eat() {
    noise(0, 0.06, 0.3, 700);
    noise(0.12, 0.06, 0.3, 600);
    tone(660, 0.22, 0.18, 'sine', 0.06, 990);
  },
  error() {
    tone(220, 0, 0.18, 'sawtooth', 0.05, 160);
  },
  click() {
    tone(1200, 0, 0.04, 'triangle', 0.04);
  },
  open() {
    tone(440, 0, 0.12, 'triangle', 0.05, 660);
  },
};
