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
      engine.setDjTransitions(false); engine.djOutro(2); await wait(300);
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

    for (const width of [320, 390, 768, 1440]) { await p.setViewportSize({ width, height: 900 }); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no horizontal scroll at ${width}`); }
    await p.setViewportSize({ width: 390, height: 844 });
    if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/mobile.png`, fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
