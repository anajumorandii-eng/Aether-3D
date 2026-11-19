export interface ImmersionAnalysis {
  status: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';
  width: number;
  depth: number;
  correlation: number;
  bassRatio: number;
  frames: number;
}
export class AdaptiveImmersion {
  node: AudioWorkletNode | null = null;
  constructor(private onFailure: () => void = () => {}) {}
  analysis: ImmersionAnalysis = { status: 'idle', width: 1, depth: 0, correlation: 0, bassRatio: 0, frames: 0 };
  private room: AudioBuffer | null = null;
  private convolver: ConvolverNode | null = null;
  private generation = 0;
  private amount = 0.65;
  private ambience = 0.2;
  async init(ctx: AudioContext, source: AudioNode, output: AudioNode) {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') { this.analysis.status = 'unsupported'; return; }
    this.analysis.status = 'loading';
    try {
      await ctx.audioWorklet.addModule(new URL('./adaptive-processor.js', import.meta.url));
      if (ctx.state === 'closed') return;
      this.node = new AudioWorkletNode(ctx, 'adaptive-immersion', { numberOfInputs: 1, numberOfOutputs: 2, channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2, 1] });
      this.node.port.onmessage = event => { const { generation, ...metrics } = event.data; if (generation === this.generation) this.analysis = { status: 'ready', ...metrics }; };
      this.node.onprocessorerror = () => { this.analysis.status = 'error'; this.onFailure(); };
      this.node.port.postMessage({ type: 'reset', generation: this.generation });
      this.setAmount(this.amount); this.setAmbience(this.ambience);
      this.convolver = ctx.createConvolver();
      this.convolver.buffer = this.room;
      const wet = ctx.createGain(); wet.gain.value = 0;
      source.connect(this.node); this.node.connect(output, 0);
      this.node.connect(this.convolver, 0); this.convolver.connect(wet); wet.connect(output);
      // The render-thread envelope drives room depth, even while the page is hidden.
      this.node.connect(wet.gain, 1);
      this.analysis.status = 'ready';
    } catch { this.analysis.status = 'error'; }
  }
  setAmount(amount: number) { this.amount = Math.max(0, Math.min(1, amount)); const parameter = this.node?.parameters.get('amount'); if (parameter && this.node) { const now = this.node.context.currentTime; parameter.cancelScheduledValues(now); parameter.setValueAtTime(parameter.value, now); parameter.linearRampToValueAtTime(this.amount, now + 0.08); } }
  setAmbience(ambience: number) { this.ambience = Math.max(0, Math.min(1, ambience)); this.node?.parameters.get('ambience')?.setTargetAtTime(this.ambience, this.node.context.currentTime, 0.08); }
  setRoom(room: AudioBuffer | null) { this.room = room; if (this.convolver) this.convolver.buffer = room; }
  reset() { this.generation++; this.node?.port.postMessage({ type: 'reset', generation: this.generation }); if (this.convolver) { this.convolver.buffer = null; this.convolver.buffer = this.room; } this.analysis = { ...this.analysis, width: 1, depth: 0, frames: 0 }; }
}
