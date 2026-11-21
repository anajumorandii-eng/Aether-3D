const assert = require('node:assert/strict');
(async () => {
  const { AutoMixer, targetOffsets, walkPlan, songAdjust } = await import('../src/audio/autoMix.ts');
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
  // Songs crossfaded with no silence: a sustained change of character counts, after 40 s of a song.
  const n = new AutoMixer(); let noticed = 0;
  for (let i = 0; i < 60 * 4; i++) noticed += n.update({ center: 0.35, ambience: 0.3, bass: 0.15, level: -20 });
  assert.equal(noticed, 0, 'a steady song is one song');
  for (let i = 0; i < 6 * 4; i++) noticed += n.update({ center: 0.05, ambience: 0.05, bass: 0.6, level: -12 });
  assert.equal(noticed, 1, 'a different song without a gap is noticed once');
  const off = new AutoMixer(); off.detectNovelty = false; let offCount = 0;
  for (let i = 0; i < 60 * 4; i++) offCount += off.update({ center: 0.35, ambience: 0.3, bass: 0.15, level: -20 });
  for (let i = 0; i < 6 * 4; i++) offCount += off.update({ center: 0.05, ambience: 0.05, bass: 0.6, level: -12 });
  assert.equal(offCount, 0, 'with Spotify timing, only gaps count');
  // 8D walk: locked to whole beats per turn, nearest the chosen speed; free when there is no clear beat.
  const locked = walkPlan(8, 120, 0.8, 0.1);
  assert.equal(locked.beats, 16); assert(Math.abs(locked.period - 8) < 1e-9);
  assert.equal(walkPlan(18, 120, 0.8, 0.1).beats, 32);
  assert.equal(walkPlan(8, 75, 0.8, 0.1).beats, 8);
  const free = walkPlan(12, 120, 0.1, 0.1); assert.equal(free.beats, null); assert.equal(free.period, 12);
  assert(walkPlan(12, 120, 0.8, 0.4).elevation > walkPlan(12, 120, 0.8, 0.05).elevation, 'airy songs move more up and down');
  // Everything else per song: tone, reverb, 8D strength, and what the song is.
  const thin = songAdjust({ center: 0.2, ambience: 0.1, bass: 0.2, tone: [0.1, 0.5, 0.25, 0.15] });
  assert(thin.eq[3] > 1 && thin.eq[9] < 0, `thin and bright: more body, less air ${JSON.stringify(thin.eq)}`);
  const dull = songAdjust({ center: 0.2, ambience: 0.1, bass: 0.2, tone: [0.4, 0.45, 0.13, 0.02] });
  assert(dull.eq[8] > 1.5 && dull.eq[7] > 0.5, `dull song: more air and presence ${JSON.stringify(dull.eq)}`);
  assert(thin.eq.every(v => Math.abs(v) <= 2.5), 'corrections stay gentle');
  assert(songAdjust({ center: 0.2, ambience: 0.35, bass: 0.2 }).reverb < 0.6, 'reverberant songs get less added room');
  assert(songAdjust({ center: 0.2, ambience: 0.03, bass: 0.2 }).reverb > 1.1, 'dry songs get more');
  const danceSong = songAdjust({ center: 0.15, ambience: 0.1, bass: 0.5, bpm: 124, beatConfidence: 0.8 });
  const balladSong = songAdjust({ center: 0.35, ambience: 0.2, bass: 0.15, bpm: 72, beatConfidence: 0.6 });
  assert(danceSong.depth > 0.15 && danceSong.character === "dançante" && balladSong.depth < 0 && balladSong.character === "balada de voz");
  const mixer = new AutoMixer();
  for (let i = 0; i < 60; i++) mixer.update({ center: 0.35, ambience: 0.2, bass: 0.15, level: -18, tone: [0.4, 0.45, 0.13, 0.02], bpm: 72, beatConfidence: 0.6 });
  assert(mixer.adjust.eq[8] > 1 && mixer.adjust.depth < -0.1 && mixer.adjust.character === 'balada de voz', JSON.stringify(mixer.adjust));
  mixer.reset(); assert(mixer.adjust.eq.every(v => v === 0) && mixer.adjust.reverb === 1);
  console.log('Live DJ auto-mix: per-song targets, smoothing, gap detection, short dips ignored, reset: OK');
})().catch(e => { console.error(e); process.exit(1); });
