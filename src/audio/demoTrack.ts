// Gera uma faixa de demonstração (pad + arpejo) em WAV, para testar o motor 3D sem arquivos.
export async function createDemoTrackUrl(): Promise<string> {
  const sampleRate = 44100;
  const seconds = 16;
  const ctx = new OfflineAudioContext(2, sampleRate * seconds, sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const chords = [
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [196, 246.94, 293.66],
    [164.81, 207.65, 246.94],
  ];

  chords.forEach((chord, ci) => {
    const start = ci * 4;
    // Pad
    chord.forEach((f) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.value = f / 2;
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.06, start + 0.8);
      g.gain.linearRampToValueAtTime(0, start + 4);
      osc.connect(lp).connect(g).connect(master);
      osc.start(start);
      osc.stop(start + 4);
    });
    // Arpejo
    for (let s = 0; s < 16; s++) {
      const t = start + s * 0.25;
      const f = chord[s % 3] * (s % 6 < 3 ? 2 : 4);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.25);
    }
    // Kick
    for (let b = 0; b < 4; b++) {
      const t = start + b;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      g.gain.setValueAtTime(0.7, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  });

  const buffer = await ctx.startRendering();
  return URL.createObjectURL(encodeWav(buffer));
}

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const length = buffer.length * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + length));
  const write = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));

  write(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, length, true);

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
