const assert = require('node:assert/strict');
(async () => {
  const { AutoMixer, targetOffsets } = await import('../src/audio/autoMix.ts');
  // A reverberant ballad: less added space, voice pulled forward.
  const ballad = targetOffsets({ center: 0.3, ambience: 0.35, bass: 0.2 });
  assert(ballad.amount < -0.2 && ballad.focus > 0, JSON.stringify(ballad));
  // A dry, bass-heavy club track with vocals: more space, less sub boost, voice forward.
  const club = targetOffsets({ center: 0.2, ambience: 0.05, bass: 0.6 });
  assert(club.amount > 0.1 && club.punch < -0.2 && club.focus > 0.1, JSON.stringify(club));
  // A thin acoustic song: more bass impact.
  assert(targetOffsets({ center: 0.3, ambience: 0.15, bass: 0.1 }).punch > 0.2);
  // An instrumental: the voice control steps back.
  assert(targetOffsets({ center: 0.02, ambience: 0.2, bass: 0.3 }).focus < 0);

  const m = new AutoMixer();
  for (let i = 0; i < 80; i++) assert.equal(m.update({ center: 0.3, ambience: 0.35, bass: 0.2, level: -18 }), false);
  assert(Math.abs(m.offsets.amount - ballad.amount) < 0.02, 'settles on the song’s mix');
  // A gap between songs, then a new one: noticed once, and the mix moves toward the new song.
  for (let i = 0; i < 3; i++) assert.equal(m.update({ center: 0, ambience: 0, bass: 0, level: -80 }), false);
  assert.equal(m.update({ center: 0.2, ambience: 0.05, bass: 0.6, level: -15 }), true);
  for (let i = 0; i < 40; i++) assert.equal(m.update({ center: 0.2, ambience: 0.05, bass: 0.6, level: -15 }), false);
  assert(m.offsets.amount > 0.05 && m.offsets.punch < -0.15, JSON.stringify(m.offsets));
  // A short dip (a quiet moment in a song) is not a new song.
  m.update({ center: 0.2, ambience: 0.05, bass: 0.6, level: -80 });
  assert.equal(m.update({ center: 0.2, ambience: 0.05, bass: 0.6, level: -15 }), false);
  m.reset(); assert.deepEqual(m.offsets, { focus: 0, amount: 0, punch: 0 });
  console.log('Live DJ auto-mix: per-song targets, smoothing, gap detection, short dips ignored, reset: OK');
})().catch(e => { console.error(e); process.exit(1); });
