import type { SpotifyNowPlaying } from './SpotifySync';

export type HandoffPhase = 'idle' | 'waiting' | 'missing' | 'starting' | 'active' | 'blocked' | 'unavailable' | 'error';
export interface HandoffStatus { phase: HandoffPhase; message: string; trackId?: string; }
export interface HandoffFile { url: string; }
export interface StartResult { started: boolean; mismatch?: boolean; }
export interface HandoffDependencies {
  findFile: (track: SpotifyNowPlaying) => HandoffFile | undefined;
  isPlaying: (file: HandoffFile) => boolean;
  start: (track: SpotifyNowPlaying, file: HandoffFile, position: number) => Promise<StartResult>;
  stop: (file: HandoffFile) => void;
  readSpotify: (token: string) => Promise<SpotifyNowPlaying | null>;
  pauseSpotify: (token: string) => Promise<boolean>;
  requestFile: (track: SpotifyNowPlaying) => void;
  report: (status: HandoffStatus) => void;
  now?: () => number;
}

/** Coordinates playback ownership; it never pauses Spotify before local playback succeeds. */
export class SpotifyHandoff {
  private dependencies: HandoffDependencies;
  private generation = 0;
  private enabled = true;
  private inFlight = false;
  private handledId: string | null = null;
  private blockedId: string | null = null;
  private blockedFile: string | null = null;
  private requestedId: string | null = null;
  private lastSeen = 0;
  private handledAt = 0;
  private observedPaused = false;
  private clock: () => number;
  private lastTrack: SpotifyNowPlaying | null = null;
  constructor(dependencies: HandoffDependencies) { this.dependencies = dependencies; this.clock = dependencies.now ?? Date.now; }
  reset() { this.enabled = true; this.generation++; this.handledId = this.blockedId = this.requestedId = null; this.lastTrack = null; this.blockedFile = null; }
  cancel() { this.enabled = false; this.generation++; }
  retry(token: string) { const track = this.lastTrack ? { ...this.lastTrack, progressMs: this.lastTrack.progressMs + (this.lastTrack.isPlaying ? Math.max(0, this.clock() - this.lastSeen) : 0) } : null; return this.handle(track, token, true); }
  async handle(track: SpotifyNowPlaying | null, token: string, force = false): Promise<void> {
    if (!this.enabled) return;
    if (track) { this.lastTrack = track; this.lastSeen = this.clock(); if (!track.isPlaying && track.id === this.handledId) this.observedPaused = true; }
    // Importing a matching local track may already have transferred OS audio focus.
    if (track && !track.isPlaying && !force && !this.handledId && !this.blockedId) {
      const file = this.dependencies.findFile(track);
      if (file && this.dependencies.isPlaying(file)) return this.handle(track, token, true);
    }
    if (!track || (!track.isPlaying && !force)) {
      if (track && this.blockedId === track.id) {
        const file = this.dependencies.findFile(track);
        if (file && this.dependencies.isPlaying(file)) {
          this.handledId = track.id; this.blockedId = null; this.observedPaused = true;
          this.dependencies.report({ phase: 'active', trackId: track.id, message: 'Reprodução transferida para o Aether na posição da música.' });
        }
      }
      if (!this.handledId && !this.blockedId) this.dependencies.report({ phase: 'waiting', message: 'Escolha uma música no Spotify. O Aether procura o arquivo correspondente.' });
      return;
    }
    if (this.inFlight) return;
    const file = this.dependencies.findFile(track);
    if (!file) {
      if (this.requestedId !== track.id) { this.requestedId = track.id; this.dependencies.requestFile(track); }
      this.dependencies.report({ phase: 'missing', trackId: track.id, message: 'Arquivo correspondente não encontrado. Importe a música ou conecte sua biblioteca na nuvem.' });
      return;
    }
    if (!force && this.blockedId === track.id && this.blockedFile === file.url) return;
    if (!force && this.handledId === track.id) {
      if (this.dependencies.isPlaying(file)) return;
      // Give Spotify's pause acknowledgement time to reach its polling endpoint.
      if (!this.observedPaused && this.clock() - this.handledAt < 8000) return;
    }
    const generation = this.generation;
    const valid = () => this.enabled && generation === this.generation;
    const report = (phase: HandoffPhase, message: string) => { if (valid()) this.dependencies.report({ phase, trackId: track.id, message }); };
    this.inFlight = true;
    report('starting', 'Iniciando a mesma música no Aether…');
    try {
      const result = await this.dependencies.start(track, file, Math.max(0, track.progressMs / 1000));
      if (!valid()) return;
      if (!result.started) {
        this.blockedId = track.id; this.blockedFile = file.url;
        report(result.mismatch ? 'unavailable' : 'blocked', result.mismatch
          ? 'O arquivo tem duração diferente da faixa do Spotify. Use a mesma versão da música.'
          : 'O navegador não iniciou o áudio. Toque em Continuar no Aether para tentar novamente.');
        return;
      }
      // Re-read after loading: the OS may already have paused Spotify, or the song changed.
      let current = await this.dependencies.readSpotify(token);
      if (!valid()) return;
      if (!this.dependencies.isPlaying(file)) { this.blockedId = track.id; this.blockedFile = file.url; report('blocked', 'A reprodução foi interrompida antes da transferência. Toque em Continuar no Aether para tentar novamente.'); return; }
      if (current && current.id !== track.id) {
        this.dependencies.stop(file);
        this.handledId = null;
        report('waiting', 'A faixa do Spotify mudou durante a transferência. Aguardando a nova faixa…');
        return;
      }
      if (current?.isPlaying) {
        const paused = await this.dependencies.pauseSpotify(token);
        if (!valid()) return;
        if (!paused) {
          current = await this.dependencies.readSpotify(token);
          if (!valid()) return;
          if (current?.isPlaying) {
            this.dependencies.stop(file);
            this.blockedId = track.id; this.blockedFile = file.url;
            report('error', 'O Spotify não autorizou a pausa automática. O controle remoto pode exigir Premium. Toque para tentar novamente.');
            return;
          }
        }
      }
      this.handledId = track.id; this.handledAt = this.clock(); this.observedPaused = false; this.blockedId = null;
      report('active', 'Reprodução transferida para o Aether na posição da música.');
    } catch {
      if (valid()) {
        this.dependencies.stop(file);
        this.blockedId = track.id; this.blockedFile = file.url;
        report('error', 'Não foi possível concluir a transferência. Verifique a conexão e tente novamente.');
      }
    } finally { this.inFlight = false; }
  }
}
