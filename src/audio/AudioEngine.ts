import { AdaptiveImmersion } from './AdaptiveImmersion';
import { PlaybackSession } from './PlaybackSession';

export interface EQPreset {
  name: string;
  gains: number[]; // 10 bandas: 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k
}

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: EQPreset[] = [
  { name: 'Neutro', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Palco Amplo', gains: [3, 2, 0, -1, -1, 1, 2, 4, 5, 4] },
  { name: 'Graves Profundos', gains: [7, 6, 4, 1, -1, 0, 0, 1, 2, 2] },
  { name: 'Clareza Vocal', gains: [-2, -1, 0, 1, 3, 4, 4, 3, 1, 0] },
  { name: 'Cinema 360', gains: [6, 5, 2, -2, -1, 1, 3, 4, 5, 3] },
];

export type RoomType = 'off' | 'studio' | 'hall' | 'cathedral';

export class SpatialAudioEngine {
  private ctx: AudioContext | null = null;
  private audioEl: HTMLAudioElement;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private pannerNode: PannerNode | null = null;
  private convolverNode: ConvolverNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private spatialGain: GainNode | null = null;
  private stereoGain: GainNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private isInitialized = false;
  private playback: PlaybackSession;
  private adaptive = new AdaptiveImmersion(() => this.routeSpatial());
  private adaptiveGain: GainNode | null = null;
  private adaptiveReady: Promise<void> | null = null;
  private spatialOn = true;
  private adaptiveOn = true;
  private impulseRoom: RoomType | null = null;

  constructor() {
    this.audioEl = new Audio();
    this.audioEl.crossOrigin = 'anonymous';
    this.audioEl.preload = 'auto';
    this.audioEl.setAttribute('playsinline', 'true');
    this.playback = new PlaybackSession(this.audioEl, () => this.ctx);
  }

  public init() {
    this.playback.configure();
    if (this.isInitialized) {
      if (this.ctx?.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx({ latencyHint: 'playback' });
    this.playback.watchContext(this.ctx);

    // 1. Fonte de áudio
    this.sourceNode = this.ctx.createMediaElementSource(this.audioEl);

    // 2. Equalizador paramétrico de 10 bandas
    this.filters = EQ_FREQUENCIES.map((freq, index) => {
      const filter = this.ctx!.createBiquadFilter();
      if (index === 0) filter.type = 'lowshelf';
      else if (index === EQ_FREQUENCIES.length - 1) filter.type = 'highshelf';
      else {
        filter.type = 'peaking';
        filter.Q.value = 1.4;
      }
      filter.frequency.value = freq;
      filter.gain.value = 0;
      return filter;
    });
    for (let i = 0; i < this.filters.length - 1; i++) {
      this.filters[i].connect(this.filters[i + 1]);
    }

    // 3. Reverb convolucional (dry/wet)
    this.convolverNode = this.ctx.createConvolver();
    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();
    this.dryGain.gain.value = 1;
    this.wetGain.gain.value = 0;
    this.setRoomType('studio');

    // 4. Motor espacial 3D (HRTF binaural)
    this.pannerNode = this.ctx.createPanner();
    this.pannerNode.panningModel = 'HRTF';
    this.pannerNode.distanceModel = 'inverse';
    this.pannerNode.refDistance = 1;
    this.pannerNode.maxDistance = 10000;
    this.pannerNode.rolloffFactor = 1;
    this.pannerNode.coneInnerAngle = 360;
    this.pannerNode.coneOuterAngle = 360;
    this.setPosition(0, 0, -1);

    // 5. Limitador dinâmico
    this.compressorNode = this.ctx.createDynamicsCompressor();
    this.compressorNode.threshold.value = -6;
    this.compressorNode.knee.value = 12;
    this.compressorNode.ratio.value = 4;
    this.compressorNode.attack.value = 0.005;
    this.compressorNode.release.value = 0.15;

    // Crossfade between the binaural path and the original stereo path.
    this.spatialGain = this.ctx.createGain();
    this.stereoGain = this.ctx.createGain();
    this.spatialGain.gain.value = 0;
    this.stereoGain.gain.value = 1;
    this.adaptiveGain = this.ctx.createGain();
    this.adaptiveGain.gain.value = 0;

    // 6. Analisador de espectro FFT
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.82;

    // Cadeia DSP: Source -> EQ -> (Dry + Reverb) -> Panner3D -> Compressor -> Analyser -> Saída
    const lastFilter = this.filters[this.filters.length - 1];
    this.sourceNode.connect(this.filters[0]);
    lastFilter.connect(this.dryGain);
    lastFilter.connect(this.convolverNode);
    this.convolverNode.connect(this.wetGain);
    this.dryGain.connect(this.pannerNode);
    this.wetGain.connect(this.pannerNode);
    this.pannerNode.connect(this.spatialGain);
    this.spatialGain.connect(this.compressorNode);
    this.dryGain.connect(this.stereoGain);
    this.wetGain.connect(this.stereoGain);
    this.stereoGain.connect(this.compressorNode);
    this.adaptiveGain.connect(this.compressorNode);
    this.compressorNode.connect(this.analyserNode);
    this.analyserNode.connect(this.ctx.destination);

    this.isInitialized = true;
    this.routeSpatial();
    this.adaptiveReady = this.adaptive.init(this.ctx, lastFilter, this.adaptiveGain).then(() => this.routeSpatial());
  }

  public async play() {
    this.init();
    // Start both operations within the user gesture, before awaiting either one.
    const playing = this.audioEl.play();
    const resuming = this.ctx?.resume();
    try { await Promise.all([playing, resuming, this.adaptiveReady]); } catch (error) { this.audioEl.pause(); throw error; }
  }

  public dispose() {
    this.audioEl.pause();
    this.playback.dispose();
    this.audioEl.removeAttribute('src');
    this.audioEl.load();
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close().catch(() => undefined);
  }

  private routeSpatial() {
    if (!this.ctx || !this.spatialGain || !this.stereoGain || !this.adaptiveGain) return;
    const adaptive = this.spatialOn && this.adaptiveOn && this.adaptive.analysis.status === 'ready';
    const manual = this.spatialOn && !this.adaptiveOn;
    const t = this.ctx.currentTime;
    this.adaptiveGain.gain.setTargetAtTime(adaptive ? 1 : 0, t, 0.03);
    this.spatialGain.gain.setTargetAtTime(manual ? 1 : 0, t, 0.03);
    this.stereoGain.gain.setTargetAtTime(adaptive || manual ? 0 : 1, t, 0.03);
  }

  public setSpatialEnabled(enabled: boolean) { this.spatialOn = enabled; this.routeSpatial(); }
  public setAdaptiveEnabled(enabled: boolean) { this.adaptiveOn = enabled; this.routeSpatial(); }
  public setAdaptiveIntensity(intensity: number) { this.adaptive.setAmount(intensity / 100); }
  public getAdaptiveAnalysis() { return { ...this.adaptive.analysis }; }
  public resetAdaptiveAnalysis() { this.adaptive.reset(); }

  public setNightMode(enabled: boolean) {
    if (!this.ctx || !this.compressorNode) return;
    const t = this.ctx.currentTime;
    this.compressorNode.threshold.setTargetAtTime(enabled ? -26 : -6, t, 0.03);
    this.compressorNode.knee.setTargetAtTime(enabled ? 24 : 12, t, 0.03);
    this.compressorNode.ratio.setTargetAtTime(enabled ? 6 : 4, t, 0.03);
    this.compressorNode.attack.setTargetAtTime(enabled ? 0.003 : 0.005, t, 0.03);
    this.compressorNode.release.setTargetAtTime(enabled ? 0.3 : 0.15, t, 0.03);
  }

  public get ready() {
    return this.isInitialized;
  }

  public getFrequencyData(targetArray: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyserNode) return false;
    this.analyserNode.getByteFrequencyData(targetArray);
    return true;
  }

  public getAudioElement(): HTMLAudioElement {
    return this.audioEl;
  }

  public setBandGain(index: number, gainDb: number) {
    if (this.filters[index] && this.ctx) {
      this.filters[index].gain.setTargetAtTime(gainDb, this.ctx.currentTime, 0.02);
    }
  }

  public applyPreset(gains: number[]) {
    gains.forEach((gain, i) => this.setBandGain(i, gain));
  }

  public setPosition(x: number, y: number, z: number) {
    if (!this.pannerNode || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.pannerNode.positionX) {
      this.pannerNode.positionX.setTargetAtTime(x, t, 0.03);
      this.pannerNode.positionY.setTargetAtTime(y, t, 0.03);
      this.pannerNode.positionZ.setTargetAtTime(z, t, 0.03);
    } else {
      this.pannerNode.setPosition(x, y, z);
    }
  }

  public setReverbMix(wetAmount: number) {
    this.adaptive.setAmbience(wetAmount);
    if (!this.dryGain || !this.wetGain || !this.ctx) return;
    const clamped = Math.max(0, Math.min(1, wetAmount));
    this.wetGain.gain.setTargetAtTime(clamped * 0.65, this.ctx.currentTime, 0.03);
    this.dryGain.gain.setTargetAtTime(1 - clamped * 0.25, this.ctx.currentTime, 0.03);
  }

  public setRoomType(type: RoomType) {
    if (!this.ctx || !this.convolverNode) return;
    if (type === 'off') {
      this.setReverbMix(0);
      return;
    }

    if (this.impulseRoom === type) { this.adaptive.setRoom(this.convolverNode.buffer); return; }

    const configs: Record<Exclude<RoomType, 'off'>, { duration: number; decay: number }> = {
      studio: { duration: 0.8, decay: 3.5 },
      hall: { duration: 2.1, decay: 2.4 },
      cathedral: { duration: 3.6, decay: 1.8 },
    };

    const { duration, decay } = configs[type];
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = this.ctx.createBuffer(2, length, rate);

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const envelope = Math.pow(1 - i / length, decay);
        data[i] = (Math.random() * 2 - 1) * envelope;
      }
    }

    this.convolverNode.buffer = impulse;
    this.adaptive.setRoom(impulse);
    this.impulseRoom = type;
  }

  public updateMediaSession(
    title: string,
    artist: string,
    artwork: string | undefined,
    onNext: () => void,
    onPrev: () => void,
  ) {
    this.playback.setMetadata(title, artist, artwork, () => { void this.play().catch(() => this.audioEl.pause()); }, onNext, onPrev);
  }
}
