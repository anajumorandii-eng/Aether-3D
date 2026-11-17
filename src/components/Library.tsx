import { AudioLines, FolderOpen, HardDrive, ListMusic, LogOut, Music2, Radio, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SpotifyNowPlaying, SpotifyPlaylist } from '../spotify/SpotifySync';
import { PanelHeader, Toggle } from './ui';

export interface PlayableTrack {
  id: string;
  name: string;
  artist: string;
  albumArt?: string;
  url?: string;
  source: 'local' | 'demo' | 'spotify-matched' | 'spotify-unmatched';
}

function SpotifyGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.21c3.81-.87 7.08-.5 9.72 1.11.3.18.39.57.2.86Zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.37.22.48.7.26 1.07Zm.1-2.83C14.7 8.94 9.38 8.77 6.3 9.7a.94.94 0 1 1-.54-1.8c3.53-1.07 9.4-.86 13.1 1.34a.94.94 0 0 1-.95 1.61Z" />
    </svg>
  );
}

interface Props {
  connected: boolean;
  syncing: boolean;
  playlists: SpotifyPlaylist[];
  selectedPlaylist: string;
  tracks: PlayableTrack[];
  currentIndex: number;
  isPlaying: boolean;
  onConnect: () => void;
  onSync: () => void;
  following: boolean;
  onFollow: (on: boolean) => void;
  spotifyNow: SpotifyNowPlaying | null;
  spotifyNowMatched: boolean;
  onLogout: () => void;
  onImport: () => void;
  onDemo: () => void;
  onSelectPlaylist: (id: string) => void;
  onPlayTrack: (index: number) => void;
  onRemoveTrack: (url: string) => void;
  cloud?: ReactNode;
}

export function Library(p: Props) {
  const playableCount = p.tracks.filter((t) => t.url).length;

  return (
    <div className="flex flex-col gap-4 min-h-0 h-full">
      <section className="panel p-5">
        <PanelHeader icon={<AudioLines className="w-4 h-4" />} title="Fontes de áudio" />
        <div className="grid grid-cols-2 gap-2">
          {p.connected ? (
            <div className="col-span-2 flex items-center gap-3 rounded-xl border border-spotify/25 bg-spotify/[0.06] px-3 py-2.5">
              <SpotifyGlyph className="w-5 h-5 text-spotify shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink">Spotify conectado</p>
                <p className="text-[11px] text-ink-muted">{p.playlists.length} playlists sincronizadas</p>
              </div>
              <button onClick={p.onSync} aria-label="Sincronizar playlists" className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-raised transition">
                <RefreshCw className={`w-4 h-4 ${p.syncing ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={p.onLogout} aria-label="Desconectar Spotify" className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-raised transition">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={p.onConnect}
              className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-spotify text-[#04130a] font-semibold text-sm py-2.5 hover:brightness-110 transition"
            >
              <SpotifyGlyph className="w-4 h-4" /> Conectar Spotify
            </button>
          )}
          <button
            onClick={p.onImport}
            className="flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-raised/60 text-xs font-medium py-2.5 text-ink hover:bg-raised transition"
          >
            <FolderOpen className="w-4 h-4 text-accent" /> Arquivos
          </button>
          <button
            onClick={p.onDemo}
            className="flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-raised/60 text-xs font-medium py-2.5 text-ink hover:bg-raised transition"
          >
            <Sparkles className="w-4 h-4 text-accent" /> Demonstração
          </button>
        </div>

        {p.connected && (
          <div className="mt-4 rounded-xl border border-line bg-sunken/70 p-3">
            <div className="flex items-center gap-3">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-spotify/10 text-spotify shrink-0">
                <Radio className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink">Seguir o Spotify</p>
                <p className="text-[11px] text-ink-muted leading-snug">Toca em 3D o que você ouvir no Spotify</p>
              </div>
              <Toggle checked={p.following} onChange={p.onFollow} label="Seguir o Spotify" />
            </div>

            {p.following && (
              <div className="mt-3 pt-3 border-t border-line flex items-center gap-3 animate-fade-up">
                {p.spotifyNow ? (
                  <>
                    {p.spotifyNow.albumArt ? (
                      <img src={p.spotifyNow.albumArt} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-raised grid place-items-center shrink-0">
                        <Music2 className="w-4 h-4 text-ink-muted" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink">{p.spotifyNow.name}</p>
                      <p className="truncate text-[11px] text-ink-muted">{p.spotifyNow.artist}</p>
                    </div>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0 ${
                        p.spotifyNowMatched ? 'text-ok bg-ok/10' : 'text-ink-faint bg-raised'
                      }`}
                    >
                      {p.spotifyNowMatched ? 'Em 3D' : 'Sem arquivo'}
                    </span>
                  </>
                ) : (
                  <p className="text-[11px] text-ink-muted flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-spotify animate-pulse" />
                    Aguardando uma música tocar no Spotify…
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {p.connected && p.playlists.length > 0 && (
          <div className="mt-4">
            <p className="eyebrow mb-2">Playlists</p>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-5 px-5">
              {p.playlists.map((pl) => {
                const active = p.selectedPlaylist === pl.id;
                return (
                  <button
                    key={pl.id}
                    onClick={() => p.onSelectPlaylist(pl.id)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition ${
                      active ? 'bg-spotify text-[#04130a] font-semibold border-spotify' : 'bg-sunken border-line text-ink-muted hover:text-ink'
                    }`}
                  >
                    {pl.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {p.cloud}

      <section className="panel p-5 flex flex-col min-h-0 flex-1">
        <PanelHeader
          icon={<ListMusic className="w-4 h-4" />}
          title="Fila"
          aside={
            p.tracks.length > 0 && (
              <span className="text-[11px] text-ink-muted tnum">
                <span className="text-ink">{playableCount}</span>/{p.tracks.length} prontas em 3D
              </span>
            )
          }
        />

        {p.tracks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-10 px-4 rounded-2xl border border-dashed border-line-strong">
            <div className="w-12 h-12 rounded-2xl bg-accent-wash grid place-items-center text-accent mb-3">
              <Music2 className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-ink">Sua fila está vazia</p>
            <p className="text-xs text-ink-muted mt-1 max-w-[240px]">
              Importe MP3/FLAC, conecte o Spotify ou ouça a faixa de demonstração.
            </p>
          </div>
        ) : (
          <>
            {p.connected && playableCount < p.tracks.length && (
              <p className="text-[11px] text-ink-muted mb-3 rounded-lg bg-warn/[0.07] border border-warn/20 px-3 py-2">
                Toque em <b className="text-ink">Arquivos</b> para vincular os MP3/FLAC às faixas sem áudio.
              </p>
            )}
            {p.tracks.some((t) => t.source === 'local' || t.source === 'spotify-matched') && (
              <p className="flex items-center gap-1.5 text-[11px] text-ink-faint mb-2">
                <HardDrive className="w-3 h-3" /> Músicas importadas ficam salvas neste aparelho
              </p>
            )}
            <ol className="space-y-1 overflow-y-auto thin-scrollbar -mx-2 px-2 max-h-[340px] lg:max-h-[480px] min-h-0">
              {p.tracks.map((track, idx) => {
                const playable = Boolean(track.url);
                const current = idx === p.currentIndex && playable;
                return (
                  <li key={track.id} className="group/row relative">
                    <button
                      onClick={() => playable && p.onPlayTrack(idx)}
                      disabled={!playable}
                      aria-current={current ? 'true' : undefined}
                      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition ${
                        current
                          ? 'bg-accent-wash ring-1 ring-accent/40'
                          : playable
                            ? 'hover:bg-raised/80'
                            : 'opacity-45'
                      }`}
                    >
                      <span className="w-5 text-center font-mono text-[11px] text-ink-faint tnum shrink-0">
                        {current && p.isPlaying ? <Equalizing /> : idx + 1}
                      </span>
                      {track.albumArt ? (
                        <img src={track.albumArt} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-strong/40 to-raised grid place-items-center shrink-0">
                          <Music2 className="w-4 h-4 text-accent-soft" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-[13px] font-medium ${current ? 'text-accent-soft' : 'text-ink'}`}>{track.name}</p>
                        <p className="truncate text-[11px] text-ink-muted">{track.artist}</p>
                      </div>
                      <SourceBadge track={track} />
                      {track.source === 'local' && <span className="w-7 shrink-0" aria-hidden="true" />}
                    </button>
                    {track.source === 'local' && track.url && (
                      <button
                        onClick={() => p.onRemoveTrack(track.url!)}
                        aria-label={`Remover ${track.name} da biblioteca`}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-ink-faint hover:text-red-300 hover:bg-raised transition lg:opacity-0 lg:group-hover/row:opacity-100 focus-visible:opacity-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}

function SourceBadge({ track }: { track: PlayableTrack }) {
  const map = {
    local: ['Local', 'text-accent-soft bg-accent-wash'],
    demo: ['Demo', 'text-accent-soft bg-accent-wash'],
    'spotify-matched': ['3D', 'text-ok bg-ok/10'],
    'spotify-unmatched': ['Sem arquivo', 'text-ink-faint bg-raised'],
  } as const;
  const [label, cls] = map[track.source];
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0 ${cls}`}>{label}</span>;
}

function Equalizing() {
  return (
    <span className="inline-flex items-end gap-[2px] h-3" aria-label="Tocando">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] bg-accent rounded-sm animate-pulse"
          style={{ height: `${[60, 100, 40][i]}%`, animationDelay: `${i * 0.15}s`, animationDuration: '0.8s' }}
        />
      ))}
    </span>
  );
}
