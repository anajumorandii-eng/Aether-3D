// End to end: a captured Spotify tab (simulated) plays through the engine while the Spotify API reports
// one song ending and the next starting. The DJ must echo out the first and sweep into the second.
const { chromium } = require('playwright'); const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await context.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => {
      localStorage.setItem('spotify_access_token', 'test'); localStorage.setItem('spotify_refresh_token', 'test');
      localStorage.setItem('spotify_expires_at', String(Date.now() + 3600e3));
      localStorage.setItem('spotify_scope', 'user-library-read playlist-read-private user-read-currently-playing user-read-playback-state user-modify-playback-state');
      // A "tab" whose audio is a tone, standing in for open.spotify.com.
      navigator.mediaDevices.getDisplayMedia = async () => {
        const ctx = new AudioContext(); const osc = ctx.createOscillator(); osc.frequency.value = 600;
        const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start();
        const canvas = document.createElement('canvas'); const video = canvas.captureStream(1).getVideoTracks()[0];
        return new MediaStream([dest.stream.getAudioTracks()[0], video]);
      };
    });
    // Spotify Web API: song A in its last seconds, then song B.
    let phase = 'A'; const started = Date.now();
    await p.route('https://api.spotify.com/**', route => {
      const url = route.request().url();
      if (url.includes('/me/player/currently-playing')) {
        const elapsed = Date.now() - started;
        const a = { id: 'A', name: 'Cool', duration: 200000, progress: 193000 + elapsed };
        const song = phase === 'A' ? a : { id: 'B', name: 'Lovely', duration: 180000, progress: 1000 };
        return route.fulfill({ json: { currently_playing_type: 'track', is_playing: true, progress_ms: song.progress, item: { id: song.id, name: song.name, artists: [{ name: 'Teste' }], album: { images: [] }, duration_ms: song.duration } } });
      }
      if (url.includes('/me/playlists')) return route.fulfill({ json: { items: [], next: null } });
      return route.fulfill({ json: { items: [], next: null } });
    });
    await p.goto(process.env.AUDIO_TEST_URL || 'http://127.0.0.1:5176');
    await p.getByRole('button', { name: 'DJ 3D', exact: true }).click();
    await p.getByRole('button', { name: 'Capturar aba do Spotify' }).click();
    await p.getByText(/^Tocando ao vivo/).waitFor();
    // The player shows the Spotify song, and the DJ reports that it is timing from Spotify.
    await p.getByText('Cool', { exact: true }).first().waitFor({ timeout: 10000 });
    await p.getByText(/Transições pelo Spotify/).waitFor({ timeout: 10000 });
    // Outro: the toast announces it.
    await p.getByText(/^Saída de DJ/).waitFor({ timeout: 10000 });
    phase = 'B';
    await p.getByText(/^Transição de DJ: Lovely/).waitFor({ timeout: 10000 });
    console.log('Live DJ end to end: Spotify song shown, outro before the end, transition into the next song: OK');
    assert.deepEqual(errors, []);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
