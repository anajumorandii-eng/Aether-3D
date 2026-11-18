import { Music2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { PlayableTrack } from './Library';
import { Range } from './ui';

const fmt = (sec: number) => {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

interface Props {
  track?: PlayableTrack;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  canPlay: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (t: number) => void;
  onVolume: (v: number) => void;
}

export function PlayerBar(p: Props) {
  return (
    <footer className="fixed bottom-0 inset-x-0 z-30 border-t border-line bg-canvas/85 backdrop-blur-xl safe-bottom">
      <div className="mx-auto max-w-[1440px] px-4 xl:px-6 pt-3 xl:pt-3 grid grid-cols-[1fr_auto] xl:grid-cols-[1fr_minmax(360px,560px)_1fr] items-center gap-x-4 gap-y-2">
        {/* Faixa */}
        <div className="flex items-center gap-3 min-w-0">
          {p.track?.albumArt ? (
            <img src={p.track.albumArt} alt="" className="w-11 h-11 rounded-md object-cover shrink-0" />
          ) : (
            <div className="w-11 h-11 rounded-md bg-raised grid place-items-center shrink-0 border border-line">
              <Music2 className="w-4 h-4 text-accent-soft" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{p.track?.name ?? 'Nada tocando'}</p>
            <p className="truncate text-xs text-ink-muted">{p.track?.artist ?? 'Importe arquivos ou conecte o Spotify'}</p>
          </div>
        </div>

        {/* Controles */}
        <div className="flex flex-col items-center gap-1 xl:order-none">
          <div className="flex items-center gap-2 xl:gap-4">
            <button onClick={p.onPrev} disabled={!p.canPlay} aria-label="Faixa anterior" className="p-2 text-ink-muted hover:text-ink disabled:opacity-40 transition">
              <SkipBack className="w-5 h-5" fill="currentColor" />
            </button>
            <button
              onClick={p.onToggle}
              disabled={!p.canPlay}
              aria-label={p.isPlaying ? 'Pausar' : 'Tocar'}
              className="w-11 h-11 rounded-full bg-white text-canvas grid place-items-center shadow-sm hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 transition"
            >
              {p.isPlaying ? <Pause className="w-5 h-5" fill="currentColor" /> : <Play className="w-5 h-5 ml-0.5" fill="currentColor" />}
            </button>
            <button onClick={p.onNext} disabled={!p.canPlay} aria-label="Próxima faixa" className="p-2 text-ink-muted hover:text-ink disabled:opacity-40 transition">
              <SkipForward className="w-5 h-5" fill="currentColor" />
            </button>
          </div>
          <div className="hidden xl:flex items-center gap-3 w-full">
            <span className="font-mono text-[11px] text-ink-faint tnum w-10 text-right">{fmt(p.currentTime)}</span>
            <Range label="Posição da faixa" min={0} max={p.duration || 100} step={0.1} value={p.currentTime} onChange={p.onSeek} disabled={!p.track} />
            <span className="font-mono text-[11px] text-ink-faint tnum w-10">{fmt(p.duration)}</span>
          </div>
        </div>

        {/* Volume (desktop) */}
        <div className="hidden xl:flex items-center justify-end gap-2">
          <button onClick={() => p.onVolume(p.volume > 0 ? 0 : 0.8)} aria-label="Silenciar" className="p-1.5 text-ink-muted hover:text-ink transition">
            {p.volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <div className="w-28">
            <Range label="Volume" min={0} max={1} step={0.01} value={p.volume} onChange={p.onVolume} />
          </div>
        </div>

        {/* Progresso (mobile) */}
        <div className="col-span-2 xl:hidden flex items-center gap-2 -mt-1">
          <span className="font-mono text-[10px] text-ink-faint tnum w-8">{fmt(p.currentTime)}</span>
          <Range label="Posição da faixa" min={0} max={p.duration || 100} step={0.1} value={p.currentTime} onChange={p.onSeek} disabled={!p.track} />
          <span className="font-mono text-[10px] text-ink-faint tnum w-8 text-right">{fmt(p.duration)}</span>
        </div>
      </div>
    </footer>
  );
}
