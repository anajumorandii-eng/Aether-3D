const { chromium } = require('playwright'); const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await context.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto(process.env.AUDIO_TEST_URL || 'http://127.0.0.1:5176');

    // Real AudioWorklet + HRTF speakers: a centered voice-band tone with diffuse noise.
    await p.evaluate(async () => {
      const { SpatialAudioEngine } = await import('/src/audio/AudioEngine.ts');
      window.engine = new SpatialAudioEngine(); engine.init(); engine.setSpatialEnabled(true); engine.setSurroundEnabled(true);
      engine.setRoomType('off'); await engine.surroundReady;
      const count = 48000 * 4, data = new ArrayBuffer(44 + count * 4), v = new DataView(data);
      const str = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
      str(0, 'RIFF'); v.setUint32(4, 36 + count * 4, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
      v.setUint32(24, 48000, true); v.setUint32(28, 192000, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, count * 4, true);
      for (let i = 0; i < count; i++) { const voice = 0.3 * Math.sin(2 * Math.PI * 900 * i / 48000); v.setInt16(44 + i * 4, (voice + 0.08 * (Math.random() * 2 - 1)) * 32767, true); v.setInt16(46 + i * 4, (voice + 0.08 * (Math.random() * 2 - 1)) * 32767, true); }
      engine.getAudioElement().src = URL.createObjectURL(new Blob([data], { type: 'audio/wav' })); await engine.play();
    });
    await p.waitForFunction(() => engine.getSurroundAnalysis().frames > 48000);
    const a = await p.evaluate(() => engine.getSurroundAnalysis());
    assert.equal(a.status, 'ready'); assert(a.center > 0.5, `voice should be in the center, got ${a.center}`); assert(a.ambience > 0.01);
    const gains = await p.evaluate(() => ({ surround: engine.surroundGain.gain.value, adaptive: engine.adaptiveGain.gain.value, manual: engine.spatialGain.gain.value, stereo: engine.stereoGain.gain.value }));
    assert(gains.surround > 0.99 && gains.adaptive < 0.01 && gains.manual < 0.01 && gains.stereo < 0.01, JSON.stringify(gains));
    const loud = await p.evaluate(() => { const d = new Uint8Array(128); engine.getFrequencyData(d); return Math.max(...d); });
    assert(loud > 100, 'surround output should be audible');
    // Everything at maximum (voice, bass impact, envelopment, DJ EQ, theatre reverb): the output must not clip.
    const peak = await p.evaluate(async () => {
      engine.setVoiceFocus(100); engine.setBassPunch(100); engine.setSurroundAmount(100);
      engine.applyPreset([5, 4, 2, -1, -1, 0, 1, 2, 2, 1]); engine.setRoomType('hall'); engine.setReverbMix(0.4);
      engine.getAudioElement().volume = 1;
      const buf = new Float32Array(engine.analyserNode.fftSize); let max = 0;
      for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 25)); engine.analyserNode.getFloatTimeDomainData(buf); for (const v of buf) max = Math.max(max, Math.abs(v)); }
      engine.setRoomType('off'); engine.setReverbMix(0); engine.applyPreset([0,0,0,0,0,0,0,0,0,0]);
      return max;
    });
    assert(peak < 1, `output must stay below full scale, peak ${peak}`);
    await p.evaluate(() => engine.setSurroundEnabled(false));
    await p.waitForTimeout(300);
    const back = await p.evaluate(() => ({ surround: engine.surroundGain.gain.value, adaptive: engine.adaptiveGain.gain.value }));
    assert(back.surround < 0.01 && back.adaptive > 0.99, 'turning Cinema off returns to adaptive stereo');
    console.log('Real AudioWorklet: voice to center, surround routing, audible output, and return to adaptive: OK');

    // Passeio 8D: a sound only in the left channel must travel to the right ear and back.
    const walkRange = await p.evaluate(async () => {
      const ctx = engine.ctx; const other = new AudioContext(); const osc = other.createOscillator(); osc.frequency.value = 500;
      const merger = other.createChannelMerger(2); osc.connect(merger, 0, 0); const dest = other.createMediaStreamDestination(); merger.connect(dest); osc.start();
      engine.setSurroundEnabled(true); engine.setAutoMix(false); await engine.attachStream(dest.stream);
      const split = ctx.createChannelSplitter(2); engine.limiterNode.connect(split);
      const aL = ctx.createAnalyser(), aR = ctx.createAnalyser(); split.connect(aL, 0); split.connect(aR, 1);
      const rms = a => { const b = new Float32Array(a.fftSize); a.getFloatTimeDomainData(b); return Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length); };
      const sample = async seconds => { const r = []; for (let i = 0; i < seconds * 10; i++) { await new Promise(x => setTimeout(x, 100)); r.push(rms(aL) / (rms(aR) + 1e-9)); } return r; };
      await new Promise(x => setTimeout(x, 800));
      const fixed = await sample(2);
      engine.setWalkSpeed(100); engine.setWalk(true);
      const walking = await sample(7);
      engine.setWalk(false); engine.setAutoMix(true); engine.detachStream(); other.close();
      return { fixedMin: Math.min(...fixed), walkMin: Math.min(...walking), walkMax: Math.max(...walking) };
    });
    assert(walkRange.fixedMin > 1.2, `without 8D the left sound stays left ${JSON.stringify(walkRange)}`);
    // Locked to the beat: tempo reports from the processor (accuracy is covered in surround-dsp.cjs) make the
    // real walk oscillators turn on whole beats.
    const locked = await p.evaluate(async () => {
      engine.setSurroundEnabled(true); engine.setAutoMix(true); engine.setWalkSpeed(92); engine.setWalk(true); // about 8 s per turn
      const s = engine.surround; s.generation += 1; // the live processor's own reports are now ignored
      const report = { generation: s.generation, center: 0.3, ambience: 0.1, bass: 0.3, level: -18, bpm: 120, beatConfidence: 0.9, frames: 48000 };
      for (let i = 0; i < 16; i++) { s.node.port.onmessage({ data: report }); await new Promise(r => setTimeout(r, 300)); } // the turn rate glides (0.8 s)
      const result = { walk: engine.getSurroundAnalysis().walk, rate: s.walkOscillators[0].frequency.value };
      engine.setWalk(false);
      return result;
    });
    assert(locked.walk?.beats === 16 && Math.abs(locked.walk.period - 8) < 0.01 && Math.abs(locked.rate - 0.125) < 0.005, `walk locks to 120 BPM: ${JSON.stringify(locked)}`);
    console.log('Passeio 8D locks to the song tempo (120 BPM, 16 beats per turn): OK');
    assert(walkRange.walkMin < 0.85 && walkRange.walkMax > 1.2, `with 8D it crosses to the right and back ${JSON.stringify(walkRange)}`);
    console.log('Passeio 8D: a left-only sound circles to the right ear and back: OK');
    // Imersão do 8D: at 100 even a centered sound (like the voice) travels ear to ear; at 0 it stays centered.
    const depth = await p.evaluate(async () => {
      const ctx = engine.ctx; const other = new AudioContext(); const osc = other.createOscillator(); osc.frequency.value = 900;
      const dest = other.createMediaStreamDestination(); osc.connect(dest); osc.start();
      engine.setSurroundEnabled(true); engine.setAutoMix(false); await engine.attachStream(dest.stream);
      const split = ctx.createChannelSplitter(2); engine.limiterNode.connect(split);
      const aL = ctx.createAnalyser(), aR = ctx.createAnalyser(); split.connect(aL, 0); split.connect(aR, 1);
      const rms = a => { const b = new Float32Array(a.fftSize); a.getFloatTimeDomainData(b); return Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length); };
      const sample = async seconds => { const r = []; for (let i = 0; i < seconds * 10; i++) { await new Promise(x => setTimeout(x, 100)); r.push(rms(aL) / (rms(aR) + 1e-9)); } return r; };
      engine.setWalkSpeed(100); engine.setWalkDepth(0); engine.setWalk(true); await new Promise(x => setTimeout(x, 800));
      const still = await sample(6);
      engine.setWalkDepth(100); await new Promise(x => setTimeout(x, 500));
      const moving = await sample(7);
      engine.setWalk(false); engine.setAutoMix(true); engine.detachStream(); other.close();
      return { stillMin: Math.min(...still), stillMax: Math.max(...still), min: Math.min(...moving), max: Math.max(...moving) };
    });
    assert(depth.stillMax / depth.stillMin < 2.5, `depth 0 keeps a centered voice near the middle ${JSON.stringify(depth)}`);
    assert(depth.min < 0.5 && depth.max > 2, `depth 100 sends a centered sound ear to ear ${JSON.stringify(depth)}`);
    console.log('Imersão do 8D: centered sound stays put at 0 and travels ear to ear at 100: OK');

    // Live stream through the same chain (stands in for a captured tab or a virtual cable).
    await p.evaluate(async () => {
      engine.setSurroundEnabled(true);
      const other = new AudioContext(); const osc = other.createOscillator(); osc.frequency.value = 700;
      const dest = other.createMediaStreamDestination(); osc.connect(dest); osc.start(); window.liveStream = dest.stream;
      engine.resetSurroundAnalysis(); await engine.attachStream(dest.stream);
    });
    await p.waitForFunction(() => engine.getSurroundAnalysis().frames > 24000);
    const live = await p.evaluate(() => ({ streaming: engine.streaming, paused: engine.getAudioElement().paused, center: engine.getSurroundAnalysis().center }));
    assert(live.streaming && live.paused && live.center > 0.5, JSON.stringify(live));
    // Live DJ: per-song offsets appear, the outro filters and echoes, a new song sweeps back open.
    await p.waitForFunction(() => Boolean(engine.getSurroundAnalysis().offsets));
    const dj = await p.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      engine.djOutro(1); await wait(2200); // shortest outro is 2 s
      const outro = { filter: engine.djFilter.frequency.value, echo: engine.echoSend.gain.value };
      engine.djTrackChange(); await wait(3000);
      const after = { filter: engine.djFilter.frequency.value, echo: engine.echoSend.gain.value };
      engine.djTrackChange(); // within 8 s: ignored
      const repeat = engine.djFilter.frequency.value;
      engine.setDjTransitions(false); engine.djOutro(2); await wait(900); // the filter glides back (0.1 s)
      return { outro, after, repeat, off: { filter: engine.djFilter.frequency.value, echo: engine.echoSend.gain.value } };
    });
    assert(dj.outro.filter > 500 && dj.outro.echo > 0.4, JSON.stringify(dj));
    assert(dj.after.filter < 25 && dj.after.echo < 0.01, JSON.stringify(dj));
    assert(dj.repeat < 25 && dj.off.filter < 25 && dj.off.echo < 0.01, JSON.stringify(dj));
    console.log('Live DJ: per-song offsets, echo-out outro, filter sweep on a new song, debounce and off switch: OK');
    await p.evaluate(() => engine.play());
    assert.equal(await p.evaluate(() => engine.streaming), false, 'playing a file detaches the live stream');
    await p.evaluate(() => engine.dispose());
    console.log('Live stream processed by the engine, file playback detaches it: OK');

    // UI: Cinema 7.1 mode, its stage, saved custom mode, live panel on the computer.
    await p.reload();
    await p.getByRole('button', { name: 'Cinema 7.1', exact: true }).click();
    await p.getByText('Inicie uma música para separar voz e ambiência.', { exact: true }).waitFor();
    assert.equal(await p.getByRole('switch', { name: 'Cinema 7.1 virtual' }).getAttribute('aria-checked'), 'true');
    assert.equal(await p.getByRole('switch', { name: 'Adaptar à música' }).count(), 0);
    await p.getByRole('slider', { name: 'Voz à frente', exact: true }).fill('85');
    await p.getByRole('button', { name: 'Personalizar', exact: true }).click();
    const dialog = p.getByRole('dialog'); await dialog.getByLabel('Salvar como meu modo').fill('Cinema Ana');
    await dialog.getByRole('button', { name: 'Salvar modo', exact: true }).click();
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('aether_custom_modes_v1')));
    assert.equal(saved[0].surround, true); assert.equal(saved[0].voiceFocus, 85); assert.equal(saved[0].surroundAmount, 70);
    await p.getByRole('button', { name: 'Testar som 3D' }).click();
    await p.getByText('Voz perto, à frente. Ambiência nas laterais e atrás.', { exact: true }).waitFor({ timeout: 15000 });
    await p.getByRole('heading', { name: 'Ao vivo · Computador' }).waitFor();
    assert.equal(await p.getByRole('button', { name: 'Capturar aba do Spotify' }).count(), 1);
    if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/desktop.png` });
    console.log('Cinema 7.1 UI, saved custom mode with voice focus, live panel on desktop: OK');
    await p.getByRole('button', { name: 'DJ 3D', exact: true }).click();
    assert.equal(await p.getByRole('switch', { name: 'Cinema 7.1 virtual' }).getAttribute('aria-checked'), 'true', 'DJ 3D uses the full surround renderer');
    assert.equal(await p.getByRole('slider', { name: 'Impacto dos graves', exact: true }).inputValue(), '65');
    assert.equal(await p.getByRole('switch', { name: 'DJ ao vivo: mixar cada música' }).getAttribute('aria-checked'), 'true');
    await p.getByRole('switch', { name: 'Transições de DJ' }).click();
    assert.equal(await p.getByRole('switch', { name: 'Transições de DJ' }).getAttribute('aria-checked'), 'false');
    await p.getByText(/^Nesta música: Voz/).waitFor({ timeout: 15000 });
    console.log('DJ 3D: full immersion with voice focus and bass impact: OK');
    await p.getByRole('button', { name: 'Íntimo', exact: true }).click();
    assert.equal(await p.getByRole('slider', { name: 'Voz à frente', exact: true }).inputValue(), '100');
    assert.equal(await p.getByRole('slider', { name: 'Imersão do 8D', exact: true }).inputValue(), '25');
    assert.equal(await p.getByRole('switch', { name: 'Transições de DJ' }).getAttribute('aria-checked'), 'false', 'no DJ effects in the intimate mode');
    console.log('Íntimo: close voice, gentle slow movement, no DJ effects: OK');

    for (const width of [320, 390, 768, 1440]) { await p.setViewportSize({ width, height: 900 }); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no horizontal scroll at ${width}`); }
    await p.setViewportSize({ width: 390, height: 844 });
    if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/mobile.png`, fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
