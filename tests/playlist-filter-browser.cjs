// Choosing a playlist shows only its songs; "Meus arquivos" shows only the imported files (here, the demo).
const { chromium } = require('playwright'); const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await context.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => {
      localStorage.setItem('spotify_access_token', 'test'); localStorage.setItem('spotify_refresh_token', 'test');
      localStorage.setItem('spotify_expires_at', String(Date.now() + 3600e3));
      localStorage.setItem('spotify_scope', 'user-library-read playlist-read-private user-read-currently-playing');
    });
    const song = (id, name) => ({ item: { id, name, artists: [{ name: 'Teste' }], album: { images: [] } } });
    await p.route('https://api.spotify.com/**', route => {
      const url = route.request().url();
      if (url.includes('/me/playlists')) return route.fulfill({ json: { items: [{ id: 'noite', name: 'Noite', images: [], tracks: { total: 2 } }] } });
      if (url.includes('/me/tracks')) return route.fulfill({ json: { items: [song('l1', 'Curtida Um'), song('l2', 'Curtida Dois'), song('l3', 'Curtida Três')] } });
      if (url.includes('/playlists/noite/')) return route.fulfill({ json: { items: [song('n1', 'Cool'), song('n2', 'Lovely')] } });
      return route.fulfill({ json: { items: [] } });
    });
    await p.goto(process.env.AUDIO_TEST_URL || 'http://127.0.0.1:5176');
    await p.getByRole('button', { name: 'Testar som 3D' }).click(); // adds the demo, standing in for an imported file
    const queue = p.locator('aside ol').first();
    const names = async () => (await queue.locator('li').allInnerTexts()).map(t => t.split('\n').map(x => x.trim()).filter(x => x && !/^\d+$/.test(x))[0]);
    await p.getByRole('button', { name: 'Noite', exact: true }).click();
    await queue.getByText('Lovely').waitFor();
    assert.deepEqual(await names(), ['Cool', 'Lovely'], 'only the playlist songs');
    await p.getByRole('button', { name: 'Meus arquivos', exact: true }).click();
    await queue.getByText('Aether · Demonstração').waitFor();
    assert.deepEqual(await names(), ['Aether · Demonstração'], 'only the files');
    assert.equal(await p.getByRole('button', { name: 'Meus arquivos', exact: true }).getAttribute('aria-pressed'), 'true');
    await p.getByRole('button', { name: 'Músicas Curtidas', exact: true }).click();
    await queue.getByText('Curtida Três').waitFor();
    assert.deepEqual(await names(), ['Curtida Um', 'Curtida Dois', 'Curtida Três']);
    for (const width of [390, 1440]) { await p.setViewportSize({ width, height: 900 }); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); }
    assert.deepEqual(errors, []);
    console.log('Playlist filter: a playlist shows only its songs, "Meus arquivos" only the files: OK');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
