/* Runs on the audio render thread; adaptation does not depend on UI timers. */
class AdaptiveImmersionProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'amount', defaultValue: 0.65, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'ambience', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.delay = new Float32Array(Math.ceil(sampleRate * 0.07));
    this.taps = [0.011, 0.017, 0.029, 0.041, 0.057].map(t => Math.round(t * sampleRate));
    this.lowCoefficient = 1 - Math.exp(-2 * Math.PI * 160 / sampleRate);
    this.highCoefficient = 1 - Math.exp(-2 * Math.PI * 6500 / sampleRate);
    this.energyCoefficient = 1 - Math.exp(-1 / (0.25 * sampleRate));
    this.controlCoefficient = 1 - Math.exp(-1 / (0.5 * sampleRate));
    this.generation = 0;
    this.weights = [0.55, -0.4, 0.25, -0.15, 0.1];
    this.reset();
    this.port.onmessage = event => { if (event.data?.type === 'reset') { this.generation = event.data.generation ?? 0; this.reset(); } };
  }
  reset() {
    this.delay.fill(0); this.index = 0; this.frames = 0; this.postFrames = 0;
    this.eL = this.eR = this.cross = this.eMid = this.eSide = this.eBass = 0;
    this.lowMid = this.lowSide = this.reflectionBand = 0;
    this.width = 1; this.depth = 0; this.compensation = 1; this.peak = 0;
  }
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    const left = inputs[0]?.[0]; const right = inputs[0]?.[1] ?? left;
    const control = outputs[1]?.[0];
    const outL = output[0]; const outR = output[1] ?? output[0];
    const amount = parameters.amount[0]; const ambience = parameters.ambience[0];
    for (let i = 0; i < outL.length; i++) {
      const l = left?.[i] ?? 0; const r = right?.[i] ?? 0;
      const mid = (l + r) * 0.5; const side = (l - r) * 0.5;
      this.lowMid += this.lowCoefficient * (mid - this.lowMid);
      this.lowSide += this.lowCoefficient * (side - this.lowSide);
      const e = this.energyCoefficient;
      this.eL += e * (l*l - this.eL); this.eR += e * (r*r - this.eR);
      this.cross += e * (l*r - this.cross);
      this.eMid += e * (mid*mid - this.eMid); this.eSide += e * (side*side - this.eSide);
      this.eBass += e * (this.lowMid*this.lowMid - this.eBass);
      this.peak = Math.max(Math.abs(l), Math.abs(r), this.peak * 0.9995);
      const energy = this.eMid + this.eSide;
      const sideRatio = this.eSide / (energy + 1e-12);
      const bassRatio = Math.min(1, this.eBass / (energy + 1e-12));
      const correlation = Math.max(-1, Math.min(1, this.cross / Math.sqrt(this.eL*this.eR + 1e-24)));
      const transient = Math.max(0, Math.min(1, (this.peak / Math.sqrt(energy + 1e-12) - 3) / 6));
      // Already-wide or anti-correlated mixes are not widened further. Low end stays intact.
      const roomForWidth = Math.max(0, 1 - sideRatio / 0.42) * Math.max(0, correlation);
      const targetWidth = 1 + 0.5 * amount * roomForWidth * (1 - bassRatio * 0.65) * (1 - transient * 0.4);
      const targetDepth = energy < 1e-9 ? 0 : amount * ambience * 0.3 * Math.max(0, Math.min(1, (correlation + 0.2) / 1.2)) * (1 - bassRatio * 0.75) * (1 - transient * 0.65);
      this.width += this.controlCoefficient * (targetWidth - this.width);
      this.depth += this.controlCoefficient * (targetDepth - this.depth);
      const normalizer = Math.sqrt((energy + 1e-12) / (this.eMid + this.eSide*this.width*this.width + 1e-12));
      this.compensation += this.controlCoefficient * (Math.max(0.8, Math.min(1, normalizer)) - this.compensation);
      // Short, band-limited reflections feed the SIDE only: they cancel on mono fold-down.
      this.reflectionBand += this.highCoefficient * ((mid - this.lowMid) - this.reflectionBand);
      this.delay[this.index] = this.reflectionBand;
      let reflected = 0;
      for (let tap = 0; tap < this.taps.length; tap++) reflected += this.weights[tap] * this.delay[(this.index - this.taps[tap] + this.delay.length) % this.delay.length];
      this.index = (this.index + 1) % this.delay.length;
      const adaptiveSide = this.lowSide + (side - this.lowSide) * this.width + reflected * this.depth;
      // Zero amount is a sample-exact bypass, including after previously enabled processing.
      outL[i] = amount === 0 ? l : (mid + adaptiveSide) * this.compensation;
      outR[i] = amount === 0 ? r : (mid - adaptiveSide) * this.compensation;
      if (control) control[i] = amount === 0 ? 0 : this.depth;
      this.frames++; this.postFrames++;
    }
    if (this.postFrames >= sampleRate / 4) {
      this.postFrames = 0;
      this.port.postMessage({ generation: this.generation, width: amount === 0 ? 1 : this.width, depth: amount === 0 ? 0 : this.depth,
        correlation: this.cross / Math.sqrt(this.eL*this.eR + 1e-24),
        bassRatio: this.eBass / (this.eMid + this.eSide + 1e-12), frames: this.frames });
    }
    return true;
  }
}
registerProcessor('adaptive-immersion', AdaptiveImmersionProcessor);
