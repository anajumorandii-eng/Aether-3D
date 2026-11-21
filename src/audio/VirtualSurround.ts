export interface SurroundAnalysis {
  status: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';
  /** Share of the input energy sent to the center (voice) speaker, 0–1. */
  center: number;
  /** Share of the input energy sent to the side and rear speakers, 0–1. */
  ambience: number;
  frames: number;
}

/** Virtual speaker layout (degrees; 0 is straight ahead, positive is to the right), as in a 7.1 room. */
export const SPEAKERS = [
  { id: 'FL', azimuth: -30 }, { id: 'FR', azimuth: 30 }, { id: 'C', azimuth: 0 },
  { id: 'SL', azimuth: -100 }, { id: 'SR', azimuth: 100 }, { id: 'BL', azimuth: -145 }, { id: 'BR', azimuth: 145 },
] as const;

const OUTPUT_TRIM = 0.72;

/**
 * Stereo -> virtual 7.1 -> binaural. An AudioWorklet splits the mix into front, center, ambience and
 * bass; each channel then plays from its own virtual speaker through the browser's measured HRTF set.
 * Bass bypasses the HRTF stage. Short early reflections help the sound leave the head.
 */
export class VirtualSurround {
  node: AudioWorkletNode | null = null;
  analysis: SurroundAnalysis = { status: 'idle', center: 0, ambience: 0, frames: 0 };
  private ctx: AudioContext | null = null;
  private generation = 0;
  private amount = 0.7;
  private focus = 0.7;
  private active = false;
  private centerGain: GainNode | null = null;
  private frontGains: GainNode[] = [];
  private sideGains: GainNode[] = [];
  private backGains: GainNode[] = [];
  private reflectionGain: GainNode | null = null;

  constructor(private onFailure: () => void = () => {}) {}

  async init(ctx: AudioContext, source: AudioNode, room: AudioNode, output: AudioNode) {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') { this.analysis.status = 'unsupported'; return; }
    this.analysis.status = 'loading';
    try {
      await ctx.audioWorklet.addModule(new URL('./surround-processor.js', import.meta.url));
      if (ctx.state === 'closed') return;
      this.ctx = ctx;
      const node = new AudioWorkletNode(ctx, 'surround-upmix', {
        numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit',
        channelInterpretation: 'speakers', outputChannelCount: [7],
      });
      this.node = node;
      node.port.onmessage = event => {
        const { generation, ...metrics } = event.data;
        if (generation === this.generation) this.analysis = { status: 'ready', ...metrics };
      };
      node.onprocessorerror = () => { this.analysis.status = 'error'; this.onFailure(); };
      node.port.postMessage({ type: 'reset', generation: this.generation });
      node.port.postMessage({ type: 'active', value: this.active });

      const trim = ctx.createGain(); trim.gain.value = OUTPUT_TRIM; trim.connect(output);
      const split = ctx.createChannelSplitter(7);
      source.connect(node); node.connect(split);

      const speaker = (azimuth: number) => {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'linear';
        panner.rolloffFactor = 0; // Fixed speakers: direction only, no distance attenuation.
        const rad = (azimuth * Math.PI) / 180;
        if (panner.positionX) { panner.positionX.value = Math.sin(rad); panner.positionY.value = 0; panner.positionZ.value = -Math.cos(rad); }
        else panner.setPosition(Math.sin(rad), 0, -Math.cos(rad));
        const gain = ctx.createGain(); gain.connect(panner); panner.connect(trim);
        return gain;
      };
      const [fl, fr, c, sl, sr, bl, br] = SPEAKERS.map(s => speaker(s.azimuth));
      this.frontGains = [fl, fr]; this.centerGain = c; this.sideGains = [sl, sr]; this.backGains = [bl, br];
      split.connect(fl, 0); split.connect(fr, 1); split.connect(c, 2);
      split.connect(sl, 3); split.connect(sr, 4);
      // Rear speakers: the same ambience, delayed and darker, so sides and rears do not fuse.
      [[3, bl, 0.013], [4, br, 0.019]].forEach(([channel, target, delay]) => {
        const d = ctx.createDelay(0.05); d.delayTime.value = delay as number;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500; lp.Q.value = 0.5;
        split.connect(d, channel as number); d.connect(lp); lp.connect(target as GainNode);
      });
      // Bass straight to both ears, outside the HRTF stage.
      const bass = ctx.createChannelMerger(2);
      split.connect(bass, 5, 0); split.connect(bass, 6, 1); bass.connect(trim);
      // The chosen room's reverb arrives from the sides and rear.
      const roomSplit = ctx.createChannelSplitter(2); room.connect(roomSplit);
      const roomL = ctx.createGain(); const roomR = ctx.createGain(); roomL.gain.value = roomR.gain.value = 0.6;
      roomSplit.connect(roomL, 0); roomSplit.connect(roomR, 1);
      roomL.connect(sl); roomL.connect(bl); roomR.connect(sr); roomR.connect(br);
      // Early reflections of the front stage: cues the brain uses to place sound outside the head.
      const reflections = ctx.createConvolver(); reflections.normalize = false; reflections.buffer = earlyReflections(ctx);
      this.reflectionGain = ctx.createGain();
      split.connect(reflections, 0); split.connect(reflections, 1); split.connect(reflections, 2);
      reflections.connect(this.reflectionGain); this.reflectionGain.connect(trim);

      this.applyLevels(true);
      this.analysis.status = 'ready';
    } catch {
      this.analysis.status = 'error';
    }
  }

  private applyLevels(immediate = false) {
    const ctx = this.ctx; if (!ctx || !this.centerGain || !this.reflectionGain) return;
    const set = (g: GainNode, v: number) => immediate ? (g.gain.value = v) : g.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    // Voice focus raises the center speaker up to about +3.5 dB and brings the fronts in slightly.
    set(this.centerGain, 0.9 + 0.6 * this.focus);
    this.frontGains.forEach(g => set(g, 1 - 0.15 * this.focus));
    this.sideGains.forEach(g => set(g, 0.55 + 0.6 * this.amount));
    this.backGains.forEach(g => set(g, 0.4 + 0.55 * this.amount));
    set(this.reflectionGain, 0.08 + 0.1 * this.amount);
    const now = ctx.currentTime;
    this.node?.parameters.get('amount')?.setTargetAtTime(this.amount, now, 0.08);
    this.node?.parameters.get('focus')?.setTargetAtTime(this.focus, now, 0.08);
  }

  setAmount(amount: number) { this.amount = Math.max(0, Math.min(1, amount)); this.applyLevels(); }
  setFocus(focus: number) { this.focus = Math.max(0, Math.min(1, focus)); this.applyLevels(); }
  /** The worklet skips its FFTs while another route is playing, to save battery. */
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.node?.port.postMessage({ type: 'active', value: active });
  }
  reset() {
    this.generation++;
    this.node?.port.postMessage({ type: 'reset', generation: this.generation });
    this.analysis = { ...this.analysis, center: 0, ambience: 0, frames: 0 };
  }
}

/** Sparse, decaying reflections that differ between ears, plus a short diffuse tail (about 90 ms). */
function earlyReflections(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate; const length = Math.floor(rate * 0.09);
  const buffer = ctx.createBuffer(2, length, rate);
  const taps = [[0.0031, 0.42, 0.0047, 0.3], [0.0058, 0.3, 0.0069, 0.36], [0.0094, 0.24, 0.0112, 0.2],
    [0.0137, 0.18, 0.0151, 0.2], [0.0193, 0.13, 0.0176, 0.14], [0.0247, 0.1, 0.0268, 0.09], [0.0311, 0.07, 0.0334, 0.08]];
  let seed = 0x2f6b;
  const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (const tap of taps) {
      const at = Math.floor(tap[channel * 2] * rate); const gain = tap[channel * 2 + 1];
      if (at < length) data[at] += channel === 0 ? gain : -gain * 0.9;
    }
    let low = 0;
    for (let i = Math.floor(rate * 0.012); i < length; i++) {
      low += 0.35 * (random() - low);
      data[i] += low * 0.05 * Math.pow(1 - i / length, 2);
    }
  }
  return buffer;
}
