/*
 * Virtual 7.1 upmix, on the audio render thread.
 *
 * Splits a stereo mix, per frequency bin, into the channels a surround renderer needs:
 *   0 FL, 1 FR   front left/right (what is panned to one side)
 *   2 C          center (what is equal and in phase in both channels: usually the lead vocal)
 *   3 AL, 4 AR   ambience (what is uncorrelated between channels: reverb, room, wide pads)
 *   5 BL, 6 BR   bass below ~120 Hz, kept out of the HRTF stage so it stays tight
 *
 * The split is an STFT (2048 points, 75% overlap, Hann analysis and synthesis) using
 * inter-channel coherence and level similarity. It is the same family of technique that
 * stereo-to-surround upmixers use; it is not, and does not contain, any Dolby algorithm.
 * Center, front and bass are amplitude-complementary, so FL+FR+C+bass rebuilds the input.
 */
const N = 2048;
const HOP = 512;
const BINS = N / 2 + 1;
const CHANNELS = 7;
const OLA_SCALE = 1 / 1.5; // Hann x Hann at 75% overlap sums to 1.5.

class SurroundUpmixProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'focus', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.window = new Float32Array(N);
    for (let n = 0; n < N; n++) this.window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N);
    this.bitReverse = new Uint32Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.bitReverse[i] = r;
    }
    this.cos = new Float32Array(N / 2);
    this.sin = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / N); this.sin[i] = -Math.sin((2 * Math.PI * i) / N); }

    // Per-bin frequency weights: bass crossover and the band where a lead vocal lives.
    this.bass = new Float32Array(BINS);
    this.voiceBand = new Float32Array(BINS);
    for (let k = 0; k < BINS; k++) {
      const f = (k * sampleRate) / N;
      this.bass[k] = f <= 80 ? 1 : f >= 160 ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (f - 80)) / 80);
      const rise = f <= 120 ? 0 : f >= 220 ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * (f - 120)) / 100);
      const fall = f <= 9000 ? 1 : f >= 14000 ? 0.35 : 0.35 + 0.65 * (0.5 + 0.5 * Math.cos((Math.PI * (f - 9000)) / 5000));
      this.voiceBand[k] = rise * fall;
    }

    this.inL = new Float32Array(N); this.inR = new Float32Array(N);
    this.pendingL = new Float32Array(HOP); this.pendingR = new Float32Array(HOP);
    this.re = new Float32Array(N); this.im = new Float32Array(N);
    this.spec = Array.from({ length: CHANNELS }, () => ({ re: new Float32Array(BINS), im: new Float32Array(BINS) }));
    this.accum = Array.from({ length: CHANNELS }, () => new Float32Array(N));
    this.ready = Array.from({ length: CHANNELS }, () => new Float32Array(HOP));
    this.pLL = new Float32Array(BINS); this.pRR = new Float32Array(BINS);
    this.pLRr = new Float32Array(BINS); this.pLRi = new Float32Array(BINS);
    this.centerMask = new Float32Array(BINS); this.ambienceMask = new Float32Array(BINS);
    this.generation = 0;
    this.active = true;
    this.reset();
    this.port.onmessage = event => {
      const data = event.data;
      if (data?.type === 'reset') { this.generation = data.generation ?? 0; this.reset(); }
      else if (data?.type === 'active') { const next = Boolean(data.value); if (next && !this.active) this.reset(); this.active = next; }
    };
  }

  reset() {
    this.inL.fill(0); this.inR.fill(0); this.pendingL.fill(0); this.pendingR.fill(0);
    for (const a of this.accum) a.fill(0);
    for (const r of this.ready) r.fill(0);
    this.pLL.fill(0); this.pRR.fill(0); this.pLRr.fill(0); this.pLRi.fill(0);
    this.centerMask.fill(0); this.ambienceMask.fill(0);
    this.position = 0; this.frames = 0; this.postFrames = 0;
    this.energyIn = 0; this.energyCenter = 0; this.energyAmbience = 0;
  }

  fft(re, im) {
    const rev = this.bitReverse;
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1; const step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]; const wi = this.sin[k * step];
          const a = start + k; const b = a + half;
          const tr = re[b] * wr - im[b] * wi; const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  }

  /** Inverse-transforms two Hermitian half spectra at once and overlap-adds them. */
  synthesize(a, b) {
    const A = this.spec[a]; const B = this.spec[b]; const re = this.re; const im = this.im;
    for (let k = 0; k < BINS; k++) {
      // Z = A + iB; conjugated so the forward FFT computes the inverse.
      re[k] = A.re[k] - B.im[k]; im[k] = -(A.im[k] + B.re[k]);
      if (k > 0 && k < N / 2) { re[N - k] = A.re[k] + B.im[k]; im[N - k] = -(B.re[k] - A.im[k]); }
    }
    this.fft(re, im);
    const outA = this.accum[a]; const outB = this.accum[b]; const w = this.window; const scale = OLA_SCALE / N;
    for (let n = 0; n < N; n++) { outA[n] += re[n] * w[n] * scale; outB[n] -= im[n] * w[n] * scale; }
  }

  frame(amount, focus) {
    const re = this.re; const im = this.im; const w = this.window;
    for (let n = 0; n < N; n++) { re[n] = this.inL[n] * w[n]; im[n] = this.inR[n] * w[n]; }
    this.fft(re, im);
    const [FL, FR, C, AL, AR, BL, BR] = this.spec;
    const smooth = 0.7; const strength = 0.45 + 0.55 * focus;
    for (let k = 0; k < BINS; k++) {
      const nk = (N - k) % N;
      // Two real spectra from one complex FFT.
      const lr = (re[k] + re[nk]) * 0.5; const li = (im[k] - im[nk]) * 0.5;
      const rr = (im[k] + im[nk]) * 0.5; const ri = (re[nk] - re[k]) * 0.5;
      const ll = lr * lr + li * li; const rrE = rr * rr + ri * ri;
      this.pLL[k] = smooth * this.pLL[k] + (1 - smooth) * ll;
      this.pRR[k] = smooth * this.pRR[k] + (1 - smooth) * rrE;
      this.pLRr[k] = smooth * this.pLRr[k] + (1 - smooth) * (lr * rr + li * ri);
      this.pLRi[k] = smooth * this.pLRi[k] + (1 - smooth) * (li * rr - lr * ri);
      const cross = Math.hypot(this.pLRr[k], this.pLRi[k]);
      const sum = this.pLL[k] + this.pRR[k];
      const coherence = cross / Math.sqrt(this.pLL[k] * this.pRR[k] + 1e-20);
      const similarity = (2 * cross) / (sum + 1e-20);
      const inPhase = Math.max(0, this.pLRr[k]) / (cross + 1e-20);
      // A source panned to one side is direct sound, not ambience, even though it is "incoherent".
      const balance = (2 * Math.sqrt(this.pLL[k] * this.pRR[k])) / (sum + 1e-20);
      const bass = this.bass[k]; const rest = 1 - bass;
      let mc = Math.max(0, Math.min(1, (similarity * inPhase - 0.5) / 0.42)) * this.voiceBand[k] * strength;
      let ma = Math.max(0, Math.min(1, (1 - coherence) * balance * 1.25)) * amount;
      if (sum < 1e-14) { mc = 0; ma = 0; }
      this.centerMask[k] = 0.5 * this.centerMask[k] + 0.5 * mc;
      this.ambienceMask[k] = 0.6 * this.ambienceMask[k] + 0.4 * ma;
      mc = this.centerMask[k] * rest; ma = this.ambienceMask[k];
      const cr = mc * (lr + rr) * 0.5; const ci = mc * (li + ri) * 0.5;
      const l1r = lr * rest - cr; const l1i = li * rest - ci;
      const r1r = rr * rest - cr; const r1i = ri * rest - ci;
      const front = Math.sqrt(1 - ma); const amb = Math.sqrt(ma);
      FL.re[k] = l1r * front; FL.im[k] = l1i * front; FR.re[k] = r1r * front; FR.im[k] = r1i * front;
      AL.re[k] = l1r * amb; AL.im[k] = l1i * amb; AR.re[k] = r1r * amb; AR.im[k] = r1i * amb;
      C.re[k] = cr; C.im[k] = ci;
      BL.re[k] = lr * bass; BL.im[k] = li * bass; BR.re[k] = rr * bass; BR.im[k] = ri * bass;
      if (k === 0 || k === N / 2) for (const s of this.spec) s.im[k] = 0;
      this.energyIn += ll + rrE;
      this.energyCenter += 2 * (cr * cr + ci * ci);
      this.energyAmbience += ma * (l1r * l1r + l1i * l1i + r1r * r1r + r1i * r1i);
    }
    this.synthesize(0, 1); this.synthesize(2, 3); this.synthesize(4, 5);
    this.synthesizeSingle(6); // Seven channels: the last one has no partner.
    for (let c = 0; c < CHANNELS; c++) {
      const acc = this.accum[c];
      this.ready[c].set(acc.subarray(0, HOP));
      acc.copyWithin(0, HOP); acc.fill(0, N - HOP);
    }
    this.frames++;
  }

  synthesizeSingle(a) {
    const A = this.spec[a]; const re = this.re; const im = this.im;
    for (let k = 0; k < BINS; k++) {
      re[k] = A.re[k]; im[k] = -A.im[k];
      if (k > 0 && k < N / 2) { re[N - k] = A.re[k]; im[N - k] = A.im[k]; }
    }
    this.fft(re, im);
    const out = this.accum[a]; const w = this.window; const scale = OLA_SCALE / N;
    for (let n = 0; n < N; n++) out[n] += re[n] * w[n] * scale;
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out?.[0]) return true;
    const frames = out[0].length;
    if (!this.active) { for (const ch of out) ch.fill(0); return true; }
    const left = inputs[0]?.[0]; const right = inputs[0]?.[1] ?? left;
    const amount = parameters.amount[0]; const focus = parameters.focus[0];
    for (let i = 0; i < frames; i++) {
      const at = this.position;
      for (let c = 0; c < out.length && c < CHANNELS; c++) out[c][i] = this.ready[c][at];
      this.pendingL[at] = left?.[i] ?? 0; this.pendingR[at] = right?.[i] ?? 0;
      this.position++;
      if (this.position === HOP) {
        this.position = 0;
        this.inL.copyWithin(0, HOP); this.inR.copyWithin(0, HOP);
        this.inL.set(this.pendingL, N - HOP); this.inR.set(this.pendingR, N - HOP);
        this.frame(amount, focus);
      }
    }
    this.postFrames += frames;
    if (this.postFrames >= sampleRate / 4) {
      this.postFrames = 0;
      const total = this.energyIn + 1e-20;
      this.port.postMessage({ generation: this.generation, center: this.energyCenter / total, ambience: this.energyAmbience / total, frames: this.frames * HOP });
      this.energyIn *= 0.5; this.energyCenter *= 0.5; this.energyAmbience *= 0.5;
    }
    return true;
  }
}

registerProcessor('surround-upmix', SurroundUpmixProcessor);
