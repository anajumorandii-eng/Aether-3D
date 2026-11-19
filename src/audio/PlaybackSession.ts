type AudioNavigator = Navigator & { audioSession?: EventTarget & { type: string; state: string } };

/** Coordinates audible playback with the OS without restarting user-paused media. */
export class PlaybackSession {
  private recovering = false;
  private cleanups: (() => void)[] = [];
  constructor(private audio: HTMLAudioElement, private context: () => AudioContext | null) {
    const listen = (target: EventTarget, name: string, callback: () => void) => {
      target.addEventListener(name, callback); this.cleanups.push(() => target.removeEventListener(name, callback));
    };
    listen(audio, 'play', () => { this.configure(); this.updateState(); void this.recover(); });
    for (const event of ['pause', 'ended', 'timeupdate', 'loadedmetadata', 'seeked', 'ratechange']) listen(audio, event, () => this.updateState());
    listen(document, 'visibilitychange', () => { void this.recover(); });
    listen(window, 'pageshow', () => { void this.recover(); });
    const session = (navigator as AudioNavigator).audioSession;
    if (session) listen(session, 'statechange', () => { void this.recover(); });
  }
  configure() {
    try {
      const session = (navigator as AudioNavigator).audioSession;
      if (session) session.type = 'playback';
    } catch { /* Experimental API: ordinary media playback remains available. */ }
  }
  watchContext(ctx: AudioContext) {
    const change = () => { void this.recover(); };
    ctx.addEventListener('statechange', change);
    this.cleanups.push(() => ctx.removeEventListener('statechange', change));
  }
  private async recover() {
    const ctx = this.context();
    if (this.recovering || !ctx || this.audio.paused || this.audio.ended || ctx.state === 'closed' || ctx.state === 'running') return;
    if ((navigator as AudioNavigator).audioSession?.state === 'interrupted') return;
    // The OS can still require another user gesture; never start paused media here.
    this.recovering = true;
    try { await ctx.resume(); } catch { /* A lock-screen play action can retry. */ } finally { this.recovering = false; }
  }
  private setAction(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
    try { navigator.mediaSession?.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
  }
  updateState() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = this.audio.paused || this.audio.ended ? 'paused' : 'playing';
    const duration = this.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !navigator.mediaSession.setPositionState) return;
    try { navigator.mediaSession.setPositionState({ duration, position: Math.max(0, Math.min(duration, this.audio.currentTime)), playbackRate: this.audio.playbackRate }); } catch { /* Older Media Session implementations. */ }
  }
  setMetadata(title: string, artist: string, artwork: string | undefined, play: () => void, next: () => void, prev: () => void) {
    if (!('mediaSession' in navigator)) return;
    if (typeof MediaMetadata !== 'undefined') navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: 'Aether 3D', artwork: artwork ? [{ src: artwork, sizes: '512x512' }] : undefined });
    this.setAction('play', play);
    this.setAction('pause', () => this.audio.pause());
    this.setAction('nexttrack', next);
    this.setAction('previoustrack', prev);
    const seek = (time: number) => { if (Number.isFinite(this.audio.duration)) this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, time)); this.updateState(); };
    this.setAction('seekto', event => { if (event.seekTime !== undefined) seek(event.seekTime); });
    this.setAction('seekbackward', event => seek(this.audio.currentTime - (event.seekOffset ?? 10)));
    this.setAction('seekforward', event => seek(this.audio.currentTime + (event.seekOffset ?? 10)));
    this.updateState();
  }
  dispose() {
    this.cleanups.forEach(cleanup => cleanup());
    for (const action of ['play','pause','nexttrack','previoustrack','seekto','seekbackward','seekforward'] as const) this.setAction(action, null);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  }
}
