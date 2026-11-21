const fs = require('node:fs'); const vm = require('node:vm'); const assert = require('node:assert/strict');
let Processor; const SR = 48000; const LATENCY = 2048;
const context = vm.createContext({ sampleRate: SR, Float32Array, Uint32Array, Math, Array, Boolean,
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage: x => this.port.messages.push(x), messages: [] }; } },
  registerProcessor: (name, type) => { assert.equal(name, 'surround-upmix'); Processor = type; } });
vm.runInContext(fs.readFileSync('src/audio/surround-processor.js', 'utf8'), context);

const names = ['FL', 'FR', 'C', 'AL', 'AR', 'BL', 'BR'];
function render(signal, { amount = 1, focus = 1, seconds = 2, processor } = {}) {
  const p = processor ?? new Processor(); const out = names.map(() => []); const input = [[], []];
  for (let at = 0; at < SR * seconds; at += 128) {
    const l = new Float32Array(128), r = new Float32Array(128);
    for (let i = 0; i < 128; i++) [l[i], r[i]] = signal(at + i);
    const o = names.map(() => new Float32Array(128));
    p.process([[l, r]], [o], { amount: new Float32Array([amount]), focus: new Float32Array([focus]) });
    o.forEach((ch, c) => { for (const v of ch) { assert(Number.isFinite(v)); out[c].push(v); } });
    input[0].push(...l); input[1].push(...r);
  }
  // Energy over the last second, after the analysis has settled.
  const from = out[0].length - SR;
  const energy = Object.fromEntries(names.map((n, c) => [n, out[c].slice(from).reduce((s, v) => s + v * v, 0) / SR]));
  return { p, out, input, energy };
}
const wave = (f, n) => Math.sin(2 * Math.PI * f * n / SR);
let seed = 7; const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 31 - 1; };
const share = (e, key) => e[key] / Object.values(e).reduce((s, v) => s + v, 0);

// A centered voice-band tone lands in the center channel.
const center = render(n => { const v = 0.3 * wave(1000, n); return [v, v]; });
assert(share(center.energy, 'C') > 0.9, `centered content should go to C, got ${share(center.energy, 'C')}`);

// A hard-left tone stays front left: nothing in the center, nothing on the right.
const left = render(n => [0.3 * wave(1000, n), 0]);
assert(share(left.energy, 'FL') > 0.95, 'hard-left content should stay in FL');
assert(left.energy.C < 1e-6 && left.energy.FR < 1e-6);

// Uncorrelated content (room, reverb) is sent to the ambience channels.
const diffuse = render(() => [0.2 * noise(), 0.2 * noise()]);
assert(share(diffuse.energy, 'AL') + share(diffuse.energy, 'AR') > 0.6, 'diffuse content should feed the surrounds');
assert(share(diffuse.energy, 'C') < 0.08, 'diffuse content should not be pulled to the center');

// Bass is split off before the HRTF stage.
const bass = render(n => { const v = 0.3 * wave(50, n); return [v, v]; });
assert(share(bass.energy, 'BL') + share(bass.energy, 'BR') > 0.97, 'bass should go to the bass channels');

// Ambience amount 0: nothing goes to the surrounds, and FL+FR+C+bass rebuilds the input after the fixed latency.
const exact = render(n => [0.25 * wave(330, n) + 0.1 * noise(), 0.2 * wave(523, n) + 0.1 * noise()], { amount: 0 });
assert(exact.energy.AL < 1e-9 && exact.energy.AR < 1e-9);
let error = 0;
for (let i = LATENCY + 4096; i < exact.out[0].length; i++) {
  const l = exact.out[0][i] + exact.out[2][i] + exact.out[5][i];
  const r = exact.out[1][i] + exact.out[2][i] + exact.out[6][i];
  error = Math.max(error, Math.abs(l - exact.input[0][i - LATENCY]), Math.abs(r - exact.input[1][i - LATENCY]));
}
assert(error < 1e-4, `reconstruction error ${error}`);

// Less voice focus extracts less center.
const soft = render(n => { const v = 0.3 * wave(1000, n); return [v, v]; }, { focus: 0 });
assert(share(soft.energy, 'C') < share(center.energy, 'C') - 0.1);

// Silence stays silent; inactive outputs zeros; metrics and reset work.
const silent = render(() => [0, 0], { seconds: 0.5 });
assert(Object.values(silent.energy).every(e => e === 0));
const p = center.p;
const metrics = p.port.messages.at(-1); assert(metrics.center > 0.8 && metrics.frames > 0);
p.port.onmessage({ data: { type: 'active', value: false } });
const off = render(n => { const v = 0.3 * wave(1000, n); return [v, v]; }, { processor: p, seconds: 0.2 });
assert(Object.values(off.energy).every(e => e === 0));
p.port.onmessage({ data: { type: 'reset', generation: 3 } });
assert.equal(p.frames, 0); assert(p.accum.every(a => a.every(v => v === 0)));
console.log('Surround DSP: voice to center, panned content to fronts, diffuse to surrounds, bass split, exact reconstruction, focus control, silence, inactive bypass and reset: OK');

// Tempo: a kick-and-hat pattern at known tempos is measured within 2 BPM.
for (const bpm of [128, 92, 150]) {
  const beat = Math.round(SR * 60 / bpm);
  let s2 = 3; const rnd = () => { s2 = (s2 * 1664525 + 1013904223) >>> 0; return s2 / 2 ** 31 - 1; };
  const tempo = render(n => {
    const t = n % beat; const kick = t < 2400 ? Math.sin(2 * Math.PI * 60 * t / SR) * Math.exp(-t / 600) * 0.6 : 0;
    const h = (n + beat / 2) % beat; const hat = h < 600 ? rnd() * Math.exp(-h / 120) * 0.2 : 0;
    const pad = 0.05 * wave(330, n);
    return [kick + hat + pad, kick + hat + pad];
  }, { seconds: 12 });
  const last = tempo.p.port.messages.at(-1);
  assert(Math.abs(last.bpm - bpm) < 2, `tempo ${bpm} measured as ${last.bpm}`);
  assert(last.beatConfidence > 0.2, `confident beat at ${bpm}: ${last.beatConfidence}`);
}
const noBeat = render(() => [0.2 * noise(), 0.2 * noise()], { seconds: 8 });
assert(noBeat.p.port.messages.at(-1).beatConfidence < 0.2, 'steady noise has no beat');
console.log('Tempo tracking: 128, 92 and 150 BPM measured within 2 BPM; no beat in steady noise: OK');
