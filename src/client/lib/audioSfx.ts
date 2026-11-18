/**
 * ReactBits Sound Lab-inspired procedural Web Audio SFX synthesizer (0 KB download).
 * Generates broadcast-grade transition whooshes, bass impacts, shutter slides, and
 * golden chimes directly inside AudioContext and routes them to the target GainNode.
 */

function createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function triggerWhoosh(
  ctx: AudioContext,
  dest: AudioNode,
  atTime: number,
  duration: number,
  fromFreq: number,
  toFreq: number,
  gainPeak = 0.24
) {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx, duration);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.setValueAtTime(1.8, atTime);
  filter.frequency.setValueAtTime(fromFreq, atTime);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(80, toFreq),
    atTime + duration * 0.6
  );

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, atTime);
  gain.gain.linearRampToValueAtTime(gainPeak, atTime + duration * 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  src.start(atTime);
  src.stop(atTime + duration + 0.02);
}

function triggerBassImpact(
  ctx: AudioContext,
  dest: AudioNode,
  atTime: number,
  startHz = 115,
  endHz = 38,
  duration = 0.45,
  gainPeak = 0.38
) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startHz, atTime);
  osc.frequency.exponentialRampToValueAtTime(endHz, atTime + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, atTime);
  gain.gain.linearRampToValueAtTime(gainPeak, atTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + duration);

  osc.connect(gain);
  gain.connect(dest);

  osc.start(atTime);
  osc.stop(atTime + duration + 0.02);
}

function triggerChime(
  ctx: AudioContext,
  dest: AudioNode,
  atTime: number,
  freqs: number[],
  duration = 0.6,
  gainPeak = 0.14
) {
  freqs.forEach((hz, idx) => {
    const osc = ctx.createOscillator();
    osc.type = idx % 2 === 0 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(hz, atTime);

    const gain = ctx.createGain();
    const start = atTime + idx * 0.035;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(gainPeak / Math.max(1, freqs.length * 0.6), start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(start);
    osc.stop(start + duration + 0.02);
  });
}

export interface BroadcastSfxScheduleOptions {
  includeOutro: boolean;
  outroStartSec?: number;
  slideTriggerSecs?: number[];
}

/**
 * Schedules synchronized transition SFX across the adaptive MediaStudio timeline:
 * - 2.55s: Ribbon Sweep Whoosh (Intro -> Stinger)
 * - 4.40s: Diagonal Split Impact + VS Medallion Chime
 * - 7.65s: Shutter-Door Slide Whoosh (Team VS -> Match Moment)
 * - 8.20s: Scoreboard Reveal Chime
 * - Optional multi-photo slide transition whooshes inside Scene 4
 * - Dynamic outroStartSec (default 13.45s): Outro Golden Wipe Whoosh
 */
export function scheduleBroadcastSfx(
  ctx: AudioContext,
  dest: AudioNode,
  startCtxTime: number,
  options: boolean | BroadcastSfxScheduleOptions
) {
  const opts: BroadcastSfxScheduleOptions =
    typeof options === 'boolean' ? { includeOutro: options } : options;
  const outroStart = opts.outroStartSec ?? 13.45;

  // 1. 2.55s Ribbon Sweep Whoosh
  triggerWhoosh(ctx, dest, startCtxTime + 2.55, 0.55, 240, 2200, 0.24);
  triggerBassImpact(ctx, dest, startCtxTime + 2.65, 95, 42, 0.35, 0.28);

  // 2. 4.40s Diagonal Split Impact + VS Chime
  triggerWhoosh(ctx, dest, startCtxTime + 4.35, 0.45, 1600, 320, 0.22);
  triggerBassImpact(ctx, dest, startCtxTime + 4.4, 125, 36, 0.5, 0.42);
  triggerChime(ctx, dest, startCtxTime + 4.5, [523.25, 659.25, 783.99], 0.55, 0.16);

  // 3. 7.65s Shutter-Door Slide + 8.20s Scoreboard Reveal Sting
  triggerWhoosh(ctx, dest, startCtxTime + 7.65, 0.62, 300, 1900, 0.22);
  triggerBassImpact(ctx, dest, startCtxTime + 8.18, 105, 40, 0.38, 0.3);
  triggerChime(ctx, dest, startCtxTime + 8.2, [587.33, 880, 1174.66], 0.65, 0.18);

  // 4. Optional soft slide-wipe whooshes between Photo #1 -> #2 -> #3
  if (opts.slideTriggerSecs && opts.slideTriggerSecs.length > 0) {
    for (const sec of opts.slideTriggerSecs) {
      triggerWhoosh(ctx, dest, startCtxTime + sec, 0.48, 380, 1750, 0.15);
    }
  }

  // 5. Dynamic Outro Golden Wipe Whoosh
  if (opts.includeOutro) {
    triggerWhoosh(ctx, dest, startCtxTime + outroStart, 0.65, 260, 2400, 0.22);
    triggerChime(ctx, dest, startCtxTime + outroStart + 0.3, [440, 554.37, 659.25], 0.7, 0.14);
  }
}
