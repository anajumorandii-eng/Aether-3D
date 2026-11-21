import { AutoMixer, walkPlan, type MixOffsets, type SongAdjust, type WalkPlan } from './autoMix';

export interface SurroundAnalysis {
  status: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';
  /** Share of the input energy sent to the center (voice) speaker, 0–1. */
  center: number;
  /** Share of the input energy sent to the side and rear speakers, 0–1. */
  ambience: number;
  /** Share of the input energy below ~120 Hz, 0–1. */
  bass?: number;
  /** Input loudness of the last 250 ms, dBFS. */
  level?: number;
  /** Live DJ adjustment for the current song, as fractions added to each setting. */
  offsets?: MixOffsets;
  /** Measured tempo and how sure the measure is, 0–1. */
  bpm?: number;
  beatConfidence?: number;
  /** Per-song EQ, reverb and 8D adjustments, when per-song mixing is on. */
  adjust?: SongAdjust;
  /** How the 8D walk is moving for this song, when it is on. */
  walk?: WalkPlan;
  frames: number;
}

/** Virtual speaker layout (degrees; 0 is straight ahead, positive is to the right), as in a 7.1 room. */
export const SPEAKERS = [
  { id: 'FL', azimuth: -30 }, { id: 'FR', azimuth: 30 }, { id: 'C', azimuth: 0 },
  { id: 'SL', azimuth: -100 }, { id: 'SR', azimuth: 100 }, { id: 'BL', azimuth: -145 }, { id: 'BR', azimuth: 145 },
] as const;

// Seven speakers plus the voice and bass boosts add up: keep headroom so the limiter rarely works.
const OUTPUT_TRIM = 0.6;
/** Fixed delay of the upmix processor (its FFT size), in samples. */
const UPMIX_LATENCY = 2048;

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
  private punch = 0.3;
  private autoMixer = new AutoMixer();
  // Passeio 8D: two oscillators (cos, sin of the rotation angle) steer the speaker positions on the
  // audio thread, so the sound keeps circling even when the page is in the background.
  private walk = false;
  private walkSpeed = 0.4;
  private walkMix: GainNode[] = [];
  private walkOscillators: OscillatorNode[] = [];
  private walkStatic: { panner: PannerNode; x: number; z: number }[] = [];
  private elevationOsc: OscillatorNode | null = null;
  private elevationMix: GainNode | null = null;
  private swayOsc: OscillatorNode | null = null;
  private swayMix: GainNode | null = null;
  private plan: WalkPlan = walkPlan(18, 0, 0, 0);
  /** 0–1: how much of the song joins the classic 8D layer (the whole mix circling, strongly panned). */
  private walkDepth = 0.7;
  private classicGain: GainNode | null = null;
  private autoMix = true;
  private surgeStart = 0;
  private surgeLength = 0;
  /** Called when the audio shows a gap between songs and a new one starts. */
  onTrackGap: (() => void) | null = null;
  /** Receives the per-song EQ and reverb adjustment (neutral when per-song mixing stops applying). */
  onSongAdjust: ((adjust: SongAdjust | null) => void) | null = null;
  private adjustApplied = false;
  private centerClose: GainNode | null = null;
  private presence: BiquadFilterNode | null = null;
  private bassShelf: BiquadFilterNode | null = null;
  private bassGain: GainNode | null = null;
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
        if (generation !== this.generation) return;
        let gap = false;
        // Song changes are watched whenever this route plays, even with per-song mixing off.
        if (this.active) { gap = this.autoMixer.update(metrics); if (this.autoMix) this.applyLevels(); }
        this.analysis = { status: 'ready', ...metrics, offsets: this.autoMix ? { ...this.autoMixer.offsets } : undefined, adjust: this.autoMix ? { ...this.autoMixer.adjust } : undefined };
        this.pushAdjust();
        if (this.active && this.walk) this.applyWalk();
        this.analysis.walk = this.walk ? { ...this.plan } : undefined;
        if (gap) this.onTrackGap?.();
      };
      node.onprocessorerror = () => { this.analysis.status = 'error'; this.onFailure(); };
      node.port.postMessage({ type: 'reset', generation: this.generation });
      node.port.postMessage({ type: 'active', value: this.active });

      const trim = ctx.createGain(); trim.gain.value = OUTPUT_TRIM; trim.connect(output);
      const split = ctx.createChannelSplitter(7);
      source.connect(node); node.connect(split);

      const cos = ctx.createOscillator(); cos.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
      const sin = ctx.createOscillator(); sin.type = 'sine';
      const walkCos = ctx.createGain(); const walkSin = ctx.createGain(); walkCos.gain.value = walkSin.gain.value = 0;
      cos.connect(walkCos); sin.connect(walkSin);
      this.walkOscillators = [cos, sin]; this.walkMix = [walkCos, walkSin];
      // Up and down (half the turn rate), and a gentle left-right sway of the close voice (twice per turn).
      this.elevationOsc = ctx.createOscillator(); this.elevationMix = ctx.createGain(); this.elevationMix.gain.value = 0;
      this.elevationOsc.connect(this.elevationMix);
      this.swayOsc = ctx.createOscillator(); this.swayMix = ctx.createGain(); this.swayMix.gain.value = 0;
      this.swayOsc.connect(this.swayMix);
      const start = ctx.currentTime + 0.05; cos.start(start); sin.start(start); this.elevationOsc.start(start); this.swayOsc.start(start);
      const speaker = (azimuth: number, rotates = true) => {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'linear';
        panner.rolloffFactor = 0; // Fixed speakers: direction only, no distance attenuation.
        const rad = (azimuth * Math.PI) / 180;
        if (panner.positionX) { panner.positionX.value = Math.sin(rad); panner.positionY.value = 0; panner.positionZ.value = -Math.cos(rad); }
        else panner.setPosition(Math.sin(rad), 0, -Math.cos(rad));
        if (rotates && panner.positionX) {
          // Rotated by θ: x = sin(a)cosθ + cos(a)sinθ, z = -cos(a)cosθ + sin(a)sinθ.
          const sa = Math.sin(rad); const ca = Math.cos(rad);
          ([[walkCos, panner.positionX, sa], [walkSin, panner.positionX, ca], [walkCos, panner.positionZ, -ca], [walkSin, panner.positionZ, sa]] as const)
            .forEach(([source, target, k]) => { const g = ctx.createGain(); g.gain.value = k; source.connect(g); g.connect(target); });
          this.walkStatic.push({ panner, x: sa, z: -ca });
          this.elevationMix?.connect(panner.positionY);
        }
        const gain = ctx.createGain(); gain.connect(panner); panner.connect(trim);
        return gain;
      };
      // The voice stays in front; instruments and ambience walk around the head.
      const [fl, fr, c, sl, sr, bl, br] = SPEAKERS.map(s => speaker(s.azimuth, s.id !== 'C'));
      this.frontGains = [fl, fr]; this.centerGain = c; this.sideGains = [sl, sr]; this.backGains = [bl, br];
      split.connect(fl, 0); split.connect(fr, 1);
      // The voice: a presence lift, then two paths. A frontal HRTF speaker tends to sound distant and
      // dull with generic HRTFs, so with more focus the voice moves to a direct path, equal in both
      // ears: close, "in your face", the way a DJ or club mix presents it.
      this.presence = ctx.createBiquadFilter(); this.presence.type = 'peaking';
      this.presence.frequency.value = 3200; this.presence.Q.value = 0.9;
      this.centerClose = ctx.createGain();
      const sway = ctx.createStereoPanner(); this.swayMix?.connect(sway.pan);
      this.centerClose.connect(sway); sway.connect(trim);
      // A gentle cut of the "s" sounds, so the presence lift does not turn into hiss on the close voice.
      const deEss = ctx.createBiquadFilter(); deEss.type = 'highshelf'; deEss.frequency.value = 7500; deEss.gain.value = -2.5;
      split.connect(this.presence, 2); this.presence.connect(deEss); deEss.connect(c); deEss.connect(this.centerClose);
      split.connect(sl, 3); split.connect(sr, 4);
      // Rear speakers: the same ambience, delayed and darker, so sides and rears do not fuse.
      [[3, bl, 0.013], [4, br, 0.019]].forEach(([channel, target, delay]) => {
        const d = ctx.createDelay(0.05); d.delayTime.value = delay as number;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500; lp.Q.value = 0.5;
        split.connect(d, channel as number); d.connect(lp); lp.connect(target as GainNode);
      });
      // Bass straight to both ears, outside the HRTF stage.
      const bass = ctx.createChannelMerger(2);
      this.bassShelf = ctx.createBiquadFilter(); this.bassShelf.type = 'lowshelf'; this.bassShelf.frequency.value = 70;
      this.bassGain = ctx.createGain();
      split.connect(bass, 5, 0); split.connect(bass, 6, 1); bass.connect(this.bassShelf); this.bassShelf.connect(this.bassGain); this.bassGain.connect(trim);
      // The chosen room's reverb arrives from the sides and rear.
      const roomSplit = ctx.createChannelSplitter(2); room.connect(roomSplit);
      const roomL = ctx.createGain(); const roomR = ctx.createGain(); roomL.gain.value = roomR.gain.value = 0.6;
      roomSplit.connect(roomL, 0); roomSplit.connect(roomR, 1);
      roomL.connect(sl); roomL.connect(bl); roomR.connect(sr); roomR.connect(br);
      // Early reflections of the front stage: cues the brain uses to place sound outside the head.
      const reflections = ctx.createConvolver(); reflections.normalize = false; reflections.buffer = earlyReflections(ctx);
      this.reflectionGain = ctx.createGain();
      // Fronts only: reflections on the voice would push it away.
      split.connect(reflections, 0); split.connect(reflections, 1);
      reflections.connect(this.reflectionGain); this.reflectionGain.connect(trim);

      // Classic 8D layer: the whole mix (bass kept out) is panned around by the same rotation, darker and
      // a little quieter behind the head. Generic HRTFs lateralise gently; this gives the strong
      // ear-to-ear movement people know as 8D. Delayed by the upmix latency so the layers stay aligned.
      const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
      const align = ctx.createDelay(0.2); align.delayTime.value = UPMIX_LATENCY / ctx.sampleRate;
      const lowCut = ctx.createBiquadFilter(); lowCut.type = 'highpass'; lowCut.frequency.value = 150; lowCut.Q.value = 0.6;
      const behind = ctx.createBiquadFilter(); behind.type = 'lowpass'; behind.frequency.value = 7000; behind.Q.value = 0.5;
      const distance = ctx.createGain(); distance.gain.value = 0.85;
      const pan = ctx.createStereoPanner(); pan.pan.value = 0;
      this.classicGain = ctx.createGain(); this.classicGain.gain.value = 0;
      source.connect(mono); mono.connect(align); align.connect(lowCut); lowCut.connect(behind); behind.connect(distance);
      distance.connect(pan); pan.connect(this.classicGain); this.classicGain.connect(trim);
      // sin θ → left/right; cos θ → in front (bright, full) or behind (darker, quieter).
      const panDepth = ctx.createGain(); panDepth.gain.value = 0.95; walkSin.connect(panDepth); panDepth.connect(pan.pan);
      const darkDepth = ctx.createGain(); darkDepth.gain.value = 3500; walkCos.connect(darkDepth); darkDepth.connect(behind.frequency);
      const levelDepth = ctx.createGain(); levelDepth.gain.value = 0.15; walkCos.connect(levelDepth); levelDepth.connect(distance.gain);

      this.applyLevels(true);
      this.applyWalk(true);
      this.analysis.status = 'ready';
    } catch {
      this.analysis.status = 'error';
    }
  }

  private applyLevels(immediate = false) {
    const ctx = this.ctx;
    if (!ctx || !this.centerGain || !this.reflectionGain || !this.centerClose || !this.presence || !this.bassShelf || !this.bassGain) return;
    const set = (g: GainNode, v: number) => immediate ? (g.gain.value = v) : g.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    const param = (p: AudioParam, v: number) => immediate ? (p.value = v) : p.setTargetAtTime(v, ctx.currentTime, 0.05);
    const o = this.autoMix ? this.autoMixer.offsets : { focus: 0, amount: 0, punch: 0 };
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    // A DJ transition opens the room for a few seconds, then settles back.
    const surge = this.surgeLength > 0 ? 0.3 * Math.max(0, 1 - (ctx.currentTime - this.surgeStart) / this.surgeLength) : 0;
    const focus = clamp01(this.focus + o.focus); const amount = clamp01(this.amount + o.amount + surge); const punch = clamp01(this.punch + o.punch);
    // Voice focus: up to about +5.5 dB overall, mostly on the close path, with presence at 3.2 kHz.
    // While the classic 8D layer plays, the still parts step back so the movement is what you hear.
    const classic = this.walk ? Math.max(0, Math.min(1, this.walkDepth + (this.autoMix ? this.autoMixer.adjust.depth : 0))) : 0;
    const still = 1 - 0.65 * classic;
    if (this.classicGain) set(this.classicGain, 1.1 * classic);
    const voice = (1 + 0.9 * focus) * still; const close = 0.2 + 0.8 * focus;
    set(this.centerClose, voice * close);
    set(this.centerGain, voice * (1 - close) * 1.1);
    param(this.presence.gain, 3 * focus);
    this.frontGains.forEach(g => set(g, (1 - 0.3 * focus) * (1 - 0.4 * classic)));
    this.sideGains.forEach(g => set(g, 0.55 + 0.75 * amount));
    this.backGains.forEach(g => set(g, 0.45 + 0.7 * amount));
    // Bass impact: a sub shelf up to +7 dB and a little more level, outside the HRTF stage.
    param(this.bassShelf.gain, 7 * punch);
    set(this.bassGain, 1 + 0.25 * punch);
    set(this.reflectionGain, 0.08 + 0.1 * amount);
    const now = ctx.currentTime;
    this.node?.parameters.get('amount')?.setTargetAtTime(amount, now, 0.08);
    this.node?.parameters.get('focus')?.setTargetAtTime(focus, now, 0.08);
  }

  setAmount(amount: number) { this.amount = Math.max(0, Math.min(1, amount)); this.applyLevels(); }
  setFocus(focus: number) { this.focus = Math.max(0, Math.min(1, focus)); this.applyLevels(); }
  setPunch(punch: number) { this.punch = Math.max(0, Math.min(1, punch)); this.applyLevels(); }
  /** Passeio 8D: instruments and ambience circle the head; the voice stays in front. */
  setWalk(enabled: boolean) { this.walk = enabled; this.applyWalk(); this.applyLevels(); }
  /** 0–1: one turn every 30 s (slow) to every 6 s (fast). */
  setWalkSpeed(speed: number) { this.walkSpeed = Math.max(0, Math.min(1, speed)); this.applyWalk(); }
  /** 0–1: from instruments circling (0) to the whole song circling ear to ear (1). */
  setWalkDepth(depth: number) { this.walkDepth = Math.max(0, Math.min(1, depth)); this.applyLevels(); }
  private applyWalk(immediate = false) {
    const ctx = this.ctx; if (!ctx || this.walkMix.length < 2) return;
    const t = ctx.currentTime; const m = this.walk ? 1 : 0; const tau = immediate ? 0.001 : 0.5;
    // Per song (with "mixar cada música" on): locked to the tempo, more vertical movement in airy songs.
    const a = this.analysis;
    const next = this.autoMix ? walkPlan(30 - 24 * this.walkSpeed, a.bpm ?? 0, a.beatConfidence ?? 0, a.ambience ?? 0) : walkPlan(30 - 24 * this.walkSpeed, 0, 0, 0);
    const changed = immediate || Math.abs(next.rate - this.plan.rate) / this.plan.rate > 0.01 || Math.abs(next.elevation - this.plan.elevation) > 0.05;
    if (!changed && this.walkMix[0].gain.value === m) return;
    this.plan = next;
    this.walkOscillators.forEach(o => o.frequency.setTargetAtTime(next.rate, t, immediate ? 0.001 : 0.8));
    this.elevationOsc?.frequency.setTargetAtTime(next.rate / 2, t, immediate ? 0.001 : 0.8);
    this.swayOsc?.frequency.setTargetAtTime(next.rate * 2, t, immediate ? 0.001 : 0.8);
    this.elevationMix?.gain.setTargetAtTime(m * next.elevation, t, tau);
    this.swayMix?.gain.setTargetAtTime(m * 0.2, t, tau);
    this.walkMix.forEach(g => g.gain.setTargetAtTime(m, t, tau));
    // The fixed position fades out as the rotating one fades in.
    for (const { panner, x, z } of this.walkStatic) { panner.positionX.setTargetAtTime(x * (1 - m), t, tau); panner.positionZ.setTargetAtTime(z * (1 - m), t, tau); }
  }

  /** When Spotify reports song changes, the audio only counts a clear gap, not a change of character. */
  setNoveltyDetection(enabled: boolean) { this.autoMixer.detectNovelty = enabled; }
  setAutoMix(enabled: boolean) { this.autoMix = enabled; if (!enabled) this.autoMixer.reset(); this.applyLevels(); this.pushAdjust(); }
  /** Sends the per-song EQ/reverb while it applies, and a single neutral one when it stops. */
  private pushAdjust() {
    const on = this.active && this.autoMix;
    if (on) { this.onSongAdjust?.(this.autoMixer.adjust); this.adjustApplied = true; }
    else if (this.adjustApplied) { this.onSongAdjust?.(null); this.adjustApplied = false; }
  }
  /** A new song is starting: relearn it and open the room for a moment. */
  newTrack(surgeSeconds = 0) {
    this.autoMixer.newTrack();
    if (surgeSeconds > 0 && this.ctx) { this.surgeStart = this.ctx.currentTime; this.surgeLength = surgeSeconds; this.applyLevels(); }
  }
  /** The worklet skips its FFTs while another route is playing, to save battery. */
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.node?.port.postMessage({ type: 'active', value: active });
    this.pushAdjust();
  }
  reset() {
    this.generation++;
    this.node?.port.postMessage({ type: 'reset', generation: this.generation });
    this.autoMixer.reset();
    this.analysis = { ...this.analysis, center: 0, ambience: 0, frames: 0, offsets: undefined };
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
      data[i] += low * 0.03 * Math.pow(1 - i / length, 2);
    }
  }
  return buffer;
}
