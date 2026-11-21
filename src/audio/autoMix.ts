/**
 * Live DJ, per-track mixing. Listens to the surround analysis of whatever is playing (a file, a tab or a
 * virtual cable) and nudges voice focus, envelopment and bass impact for each song, on top of the
 * listener's own settings. It also notices the gap between songs when there is no Spotify metadata.
 */
export interface TrackMetrics {
  center: number; ambience: number; bass: number; level: number;
  /** Shares of the energy above the bass: body (120–400 Hz), mids, presence (2–6 kHz), air (6 kHz+). */
  tone?: number[];
  bpm?: number;
  beatConfidence?: number;
}

/** Everything else a song gets, beyond voice, envelopment and bass. */
export interface SongAdjust {
  /** dB added to each of the 10 EQ bands (32 Hz … 16 kHz), on top of the listener's EQ. */
  eq: number[];
  /** Multiplies the room reverb: less for songs that already carry their own, more for dry ones. */
  reverb: number;
  /** Added to the 8D immersion (fraction): stronger in danceable songs, gentler in vocal ballads. */
  depth: number;
  /** What the song seems to be, in a few words, for the screen. */
  character: string;
}

const NEUTRAL_ADJUST: SongAdjust = { eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], reverb: 1, depth: 0, character: '' };
// A balanced mix above the bass, and how each tone band maps onto the 10 EQ bands.
const TONE_TARGET = [0.33, 0.4, 0.19, 0.08];
const TONE_TO_EQ: [number, number, number][] = [[0, 2, 0.5], [0, 3, 1], [1, 4, 0.6], [1, 5, 0.6], [2, 6, 0.7], [2, 7, 1], [3, 8, 1], [3, 9, 0.8]];

/** Gentle per-song corrections (±2.5 dB at most): a thin song gets body, a dull one air, a harsh one less presence. */
export function songAdjust(p: { center: number; ambience: number; bass: number; tone?: number[]; bpm?: number; beatConfidence?: number }): SongAdjust {
  const eq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  if (p.tone && p.tone.length === 4 && p.tone.every(v => v > 0)) {
    const db = p.tone.map((share, b) => clamp(0.5 * 10 * Math.log10(TONE_TARGET[b] / share), -2.5, 2.5));
    for (const [band, index, weight] of TONE_TO_EQ) eq[index] += db[band] * weight;
  }
  const reverb = clamp(1 - 2.5 * (p.ambience - 0.12), 0.35, 1.4);
  const beat = (p.beatConfidence ?? 0) >= 0.4 && (p.bpm ?? 0) > 0;
  const dance = beat && (p.bpm ?? 0) >= 100;
  const ballad = p.center > 0.22 && (!beat || (p.bpm ?? 0) < 95);
  const airy = p.ambience > 0.25;
  const depth = dance ? 0.15 + 0.1 * clamp(p.bass * 2, 0, 1) : ballad ? -0.2 : 0;
  const character = dance ? 'dançante' : ballad ? 'balada de voz' : airy ? 'atmosférica' : 'equilibrada';
  return { eq: eq.map(v => Math.round(v * 10) / 10), reverb, depth, character };
}
/** Offsets added to the listener's settings, as fractions of the 0–1 range. */
export interface MixOffsets { focus: number; amount: number; punch: number }

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** What a song needs, from what it already has. */
export function targetOffsets({ center, ambience, bass }: Omit<TrackMetrics, 'level'>): MixOffsets {
  const vocal = center > 0.08;
  // A voice under heavy bass or lots of reverb gets pulled forward; instrumentals open the stage instead.
  const focus = vocal ? clamp(0.25 * ((bass - 0.3) / 0.3) + 0.2 * ((ambience - 0.15) / 0.2), -0.1, 0.25) : center < 0.05 ? -0.15 : 0;
  // Already reverberant mixes (dream pop, ballads) get less added space, so they do not echo; dry mixes get more.
  const amount = clamp(-0.25 * ((ambience - 0.15) / 0.2), -0.3, 0.25);
  // Bass-heavy songs get less sub boost (no boom); thin songs get more impact.
  const punch = clamp(-0.3 * ((bass - 0.35) / 0.25), -0.35, 0.3);
  return { focus, amount, punch };
}

const SILENCE_DB = -50;
const RETURN_DB = -38;

export class AutoMixer {
  offsets: MixOffsets = { focus: 0, amount: 0, punch: 0 };
  adjust: SongAdjust = { ...NEUTRAL_ADJUST, eq: [...NEUTRAL_ADJUST.eq] };
  private tone: number[] | null = null;
  private profile: Omit<TrackMetrics, 'level'> | null = null;
  private sinceTrack = 0;
  private silence = 0;
  // Slow and fast views of the sound, to notice a different song when there is no silence between them.
  private slow: TrackMetrics | null = null;
  private fast: TrackMetrics | null = null;
  private novelty = 0;
  private sinceChange = 0;
  /** Off when Spotify tells the song changes: then only a clear gap counts. */
  detectNovelty = true;

  /** Feeds one analysis report; returns true when a new song seems to start after a gap. */
  update(m: TrackMetrics, dt = 0.25): boolean {
    let changed = false;
    if (m.level < SILENCE_DB) { this.silence += dt; return false; }
    if (this.silence >= 0.4 && m.level > RETURN_DB) { this.newTrack(); changed = true; }
    this.silence = 0;
    this.sinceTrack += dt; this.sinceChange += dt;
    const follow = (prev: TrackMetrics | null, tau: number): TrackMetrics => {
      if (!prev) return { ...m };
      const k = 1 - Math.exp(-dt / tau);
      return { center: prev.center + k * (m.center - prev.center), ambience: prev.ambience + k * (m.ambience - prev.ambience), bass: prev.bass + k * (m.bass - prev.bass), level: prev.level + k * (m.level - prev.level) };
    };
    this.slow = follow(this.slow, 12); this.fast = follow(this.fast, 1.2);
    const d = Math.abs(this.fast.center - this.slow.center) * 2 + Math.abs(this.fast.ambience - this.slow.ambience) * 2 +
      Math.abs(this.fast.bass - this.slow.bass) * 1.5 + Math.abs(this.fast.level - this.slow.level) / 12;
    this.novelty = d > 0.25 ? this.novelty + dt : 0;
    if (!changed && this.detectNovelty && this.novelty >= 1.5 && this.sinceChange >= 30) { this.newTrack(); changed = true; this.slow = { ...this.fast }; }
    // Learn the new song quickly for the first seconds, then follow it slowly.
    const tau = this.sinceTrack < 5 ? 1 : 4;
    const k = 1 - Math.exp(-dt / tau);
    const p = this.profile ?? { center: m.center, ambience: m.ambience, bass: m.bass };
    this.profile = { center: p.center + k * (m.center - p.center), ambience: p.ambience + k * (m.ambience - p.ambience), bass: p.bass + k * (m.bass - p.bass) };
    const target = targetOffsets(this.profile);
    if (m.tone && m.tone.length === 4) this.tone = this.tone ? this.tone.map((v, i) => v + k * (m.tone![i] - v)) : [...m.tone];
    const next = songAdjust({ ...this.profile, tone: this.tone ?? undefined, bpm: m.bpm, beatConfidence: m.beatConfidence });
    const ka = 1 - Math.exp(-dt / (tau * 0.75)); const a = this.adjust;
    this.adjust = { eq: a.eq.map((v, i) => v + ka * (next.eq[i] - v)), reverb: a.reverb + ka * (next.reverb - a.reverb), depth: a.depth + ka * (next.depth - a.depth), character: next.character };
    const o = this.offsets; const ko = 1 - Math.exp(-dt / (tau * 0.75));
    this.offsets = { focus: o.focus + ko * (target.focus - o.focus), amount: o.amount + ko * (target.amount - o.amount), punch: o.punch + ko * (target.punch - o.punch) };
    return changed;
  }

  /** A new song: relearn it, starting from the previous song's mix so nothing jumps. */
  newTrack() { this.profile = null; this.tone = null; this.sinceTrack = 0; this.sinceChange = 0; this.novelty = 0; }
  reset() { this.offsets = { focus: 0, amount: 0, punch: 0 }; this.adjust = { ...NEUTRAL_ADJUST, eq: [...NEUTRAL_ADJUST.eq] }; this.tone = null; this.newTrack(); this.silence = 0; this.slow = this.fast = null; }
}

/** How the 8D walk moves for this song. */
export interface WalkPlan {
  /** Turns per second. */
  rate: number;
  /** Seconds per turn. */
  period: number;
  /** Beats per turn when locked to the song's tempo; null when the song has no clear beat. */
  beats: number | null;
  /** Up-and-down movement, 0–1 (about ±30° at 1). */
  elevation: number;
}

/**
 * Locks the 8D turn to the song: a whole number of beats per turn (4 to 64, a power of two, so it lands
 * on bars and phrases), the one closest to the speed the listener chose. Songs with more ambience
 * (reverberant, dreamy) also move more up and down.
 */
export function walkPlan(basePeriod: number, bpm: number, confidence: number, ambience: number): WalkPlan {
  const elevation = clamp(0.35 + 1.5 * ambience, 0.35, 0.8);
  if (!(bpm >= 60 && bpm <= 200) || confidence < 0.3) return { rate: 1 / basePeriod, period: basePeriod, beats: null, elevation };
  let beats = 4;
  for (const b of [4, 8, 16, 32, 64]) {
    if (Math.abs(Math.log((b * 60) / bpm / basePeriod)) < Math.abs(Math.log((beats * 60) / bpm / basePeriod))) beats = b;
  }
  const period = (beats * 60) / bpm;
  return { rate: 1 / period, period, beats, elevation };
}
