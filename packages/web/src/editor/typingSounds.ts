import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * "Typing sounds": a sound at every keystroke, synthesised with Web Audio, no files and no
 * network. Two voices, like the page's typeface:
 * - the keyboard: a puff of filtered noise (the key) and a short, low thud (bottoming out); the
 *   space duller, Enter fuller;
 * - with "Handwriting", the fountain pen: the nib landing and scratching on paper, a high grainy
 *   rustle that lasts as long as a stroke; space is the nib lifting, Enter the hand sliding to
 *   the next line. Typing quickly the strokes overlap and the rustle is continuous, as in writing.
 * Every sound varies slightly.
 */

type Kind = "key" | "space" | "return";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
/** Noise with the grain of paper: the fibres vary the friction millisecond by millisecond. */
let paper: AudioBuffer | null = null;
let out: GainNode | null = null;

/** The audio context is created on the first keystroke: browsers only let it start after a gesture. */
function audio(): AudioContext | null {
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    out = ctx.createGain();
    out.gain.value = 0.35;
    out.connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.12), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    paper = ctx.createBuffer(1, Math.round(ctx.sampleRate * 2), ctx.sampleRate);
    const fiber = paper.getChannelData(0);
    let grain = 0.5;
    let target = 0.5;
    let next = 0;
    for (let i = 0; i < fiber.length; i++) {
      if (i >= next) {
        // Every 1–4 ms another fibre; now and then the nib catches.
        target = Math.random() < 0.06 ? 1 : 0.15 + Math.random() * 0.6;
        next = i + Math.round(ctx.sampleRate * (0.001 + Math.random() * 0.003));
      }
      grain += (target - grain) * 0.02;
      fiber[i] = (Math.random() * 2 - 1) * grain;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

const VOICE: Record<Kind, { band: number; decay: number; body: number; level: number }> = {
  key: { band: 3200, decay: 0.035, body: 170, level: 0.9 },
  space: { band: 1700, decay: 0.05, body: 120, level: 0.8 },
  return: { band: 1200, decay: 0.09, body: 85, level: 1 },
};

function click(kind: Kind) {
  const ac = audio();
  if (!ac || !noise || !out) return;
  const v = VOICE[kind];
  const t = ac.currentTime;
  const jitter = 1 + (Math.random() - 0.5) * 0.18;

  const src = ac.createBufferSource();
  src.buffer = noise;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = v.band * jitter;
  band.Q.value = 1.4;
  const env = ac.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v.level, t + 0.002);
  env.gain.exponentialRampToValueAtTime(0.001, t + v.decay);
  src.connect(band).connect(env).connect(out);
  src.start(t);
  src.stop(t + v.decay + 0.01);

  const body = ac.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(v.body * jitter, t);
  body.frequency.exponentialRampToValueAtTime(v.body * 0.6, t + 0.03);
  const thud = ac.createGain();
  thud.gain.setValueAtTime(0, t);
  thud.gain.linearRampToValueAtTime(v.level * 0.5, t + 0.003);
  thud.gain.exponentialRampToValueAtTime(0.001, t + v.decay * 0.8);
  body.connect(thud).connect(out);
  body.start(t);
  body.stop(t + v.decay);
}

const PEN: Record<Kind, { band: number; length: number; level: number; sweep: number }> = {
  key: { band: 5200, length: 0.11, level: 0.55, sweep: 1.18 },
  space: { band: 6500, length: 0.025, level: 0.18, sweep: 1 },
  return: { band: 2400, length: 0.26, level: 0.16, sweep: 0.7 },
};

/** A nib stroke: a tap when it lands, then the rustle, which changes with the stroke's direction. */
function stroke(kind: Kind) {
  const ac = audio();
  if (!ac || !paper || !out) return;
  const v = PEN[kind];
  const t = ac.currentTime;
  const jitter = 1 + (Math.random() - 0.5) * 0.25;
  const length = v.length * (kind === "key" ? 0.7 + Math.random() * 0.6 : 1);

  const src = ac.createBufferSource();
  src.buffer = paper;
  const high = ac.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = kind === "return" ? 900 : 2200;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.8;
  band.frequency.setValueAtTime(v.band * jitter, t);
  band.frequency.linearRampToValueAtTime(
    v.band * jitter * (Math.random() < 0.5 ? v.sweep : 1 / v.sweep),
    t + length,
  );
  const env = ac.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v.level * 1.6, t + 0.0015);
  env.gain.linearRampToValueAtTime(v.level * 0.7, t + 0.008);
  env.gain.linearRampToValueAtTime(v.level, t + length * 0.4);
  env.gain.exponentialRampToValueAtTime(0.001, t + length);
  src.connect(high).connect(band).connect(env).connect(out);
  const offset = Math.random() * (paper.duration - length - 0.01);
  src.start(t, offset, length + 0.01);
}

function kindOf(e: KeyboardEvent): Kind | null {
  if (e.metaKey || e.ctrlKey || e.isComposing) return null;
  if (e.key === "Enter") return "return";
  if (e.key === " ") return "space";
  if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") return "key";
  return null;
}

/** `pen`: with "Handwriting" the fountain pen, otherwise the keyboard. */
export function typingSounds(enabled: boolean, pen = false): Extension {
  if (!enabled) return [];
  const play = pen ? stroke : click;
  // An observer, not a handler: the keymap takes Enter and Backspace first.
  return EditorView.domEventObservers({
    keydown(e) {
      const kind = kindOf(e);
      if (kind) play(kind);
    },
  });
}
