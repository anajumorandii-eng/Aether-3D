/**
 * Live DJ, per-track mixing. Listens to the surround analysis of whatever is playing (a file, a tab or a
 * virtual cable) and nudges voice focus, envelopment and bass impact for each song, on top of the
 * listener's own settings. It also notices the gap between songs when there is no Spotify metadata.
 */
export interface TrackMetrics { center: number; ambience: number; bass: number; level: number }
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
    this.novelty = d > 0.35 ? this.novelty + dt : 0;
    if (!changed && this.detectNovelty && this.novelty >= 2 && this.sinceChange >= 40) { this.newTrack(); changed = true; this.slow = { ...this.fast }; }
    // Learn the new song quickly for the first seconds, then follow it slowly.
    const tau = this.sinceTrack < 5 ? 1 : 4;
    const k = 1 - Math.exp(-dt / tau);
    const p = this.profile ?? { center: m.center, ambience: m.ambience, bass: m.bass };
    this.profile = { center: p.center + k * (m.center - p.center), ambience: p.ambience + k * (m.ambience - p.ambience), bass: p.bass + k * (m.bass - p.bass) };
    const target = targetOffsets(this.profile);
    const o = this.offsets; const ko = 1 - Math.exp(-dt / (tau * 0.75));
    this.offsets = { focus: o.focus + ko * (target.focus - o.focus), amount: o.amount + ko * (target.amount - o.amount), punch: o.punch + ko * (target.punch - o.punch) };
    return changed;
  }

  /** A new song: relearn it, starting from the previous song's mix so nothing jumps. */
  newTrack() { this.profile = null; this.sinceTrack = 0; this.sinceChange = 0; this.novelty = 0; }
  reset() { this.offsets = { focus: 0, amount: 0, punch: 0 }; this.newTrack(); this.silence = 0; this.slow = this.fast = null; }
}
