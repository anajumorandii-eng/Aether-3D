import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { FolderOpen, Library as LibraryIcon, Orbit, Sliders, Sparkles, X } from 'lucide-react';
import { EQ_PRESETS, SpatialAudioEngine, type RoomType } from './audio/AudioEngine';
import { createDemoTrackUrl } from './audio/demoTrack';
import {
  fetchPlaylistTracks,
  fetchUserPlaylists,
  handleSpotifyCallback,
  isSpotifyConfigured,
  loginWithSpotify,
  logoutSpotify,
  normalizeText,
  type SpotifyPlaylist,
  type SpotifyTrackItem,
} from './spotify/SpotifySync';
import { SpatialStage, type StagePos } from './components/SpatialStage';
import { Equalizer } from './components/Equalizer';
import { RoomPanel } from './components/RoomPanel';
import { Library, type PlayableTrack } from './components/Library';
import { PlayerBar } from './components/PlayerBar';
import { Field, Logo, PanelHeader, Range, Stat, Toggle } from './components/ui';

interface LocalFile {
  key: string;
  name: string;
  url: string;
}

type MobileTab = 'library' | 'eq' | 'room';

export default function App() {
  const engineRef = useRef<SpatialAudioEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fontes
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [demoUrl, setDemoUrl] = useState<string | null>(null);
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState('');
  const [spotifyTracks, setSpotifyTracks] = useState<SpotifyTrackItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Reprodução
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);

  // Espaço 3D
  const [pos, setPos] = useState<StagePos>({ x: 0, z: -0.7 });
  const [elevation, setElevation] = useState(0);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [orbitSpeed, setOrbitSpeed] = useState(0.6);

  // Som
  const [activePreset, setActivePreset] = useState('Palco Amplo');
  const [eqGains, setEqGains] = useState<number[]>(EQ_PRESETS[1].gains);
  const [roomType, setRoomType] = useState<RoomType>('studio');
  const [reverbMix, setReverbMix] = useState(0.2);

  const [tab, setTab] = useState<MobileTab>('library');
  const [toast, setToast] = useState<string | null>(null);

  // Fila mesclada: Spotify (vinculado aos arquivos) + arquivos soltos + demo
  const tracks = useMemo<PlayableTrack[]>(() => {
    const used = new Set<string>();
    const merged: PlayableTrack[] = spotifyTracks.map((sp) => {
      const cleanTrack = normalizeText(sp.name);
      const cleanFull = normalizeText(`${sp.artist} ${sp.name}`);
      const match = localFiles.find((f) => f.key.includes(cleanTrack) || cleanFull.includes(f.key));
      if (match) used.add(match.url);
      const url = match?.url || sp.previewUrl || undefined;
      return { ...sp, url, source: url ? 'spotify-matched' : 'spotify-unmatched' };
    });
    const locals: PlayableTrack[] = localFiles
      .filter((f) => !used.has(f.url))
      .map((f) => ({ id: f.url, name: f.name, artist: 'Arquivo local', url: f.url, source: 'local' }));
    const demo: PlayableTrack[] = demoUrl
      ? [{ id: 'demo', name: 'Aether Demo — Órbita', artist: 'Faixa de demonstração', url: demoUrl, source: 'demo' }]
      : [];
    return [...merged, ...locals, ...demo];
  }, [spotifyTracks, localFiles, demoUrl]);

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  const currentIndex = tracks.findIndex((t) => t.id === currentId);
  const currentTrack = currentIndex >= 0 ? tracks[currentIndex] : undefined;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4200);
  }, []);

  // ---------- Reprodução ----------
  const settingsRef = useRef({ eqGains, roomType, reverbMix, pos, elevation, volume });
  settingsRef.current = { eqGains, roomType, reverbMix, pos, elevation, volume };

  const loadTrack = useCallback((track: PlayableTrack) => {
    const engine = engineRef.current;
    if (!engine || !track.url) return;
    const s = settingsRef.current;
    engine.init();
    engine.applyPreset(s.eqGains);
    engine.setRoomType(s.roomType);
    engine.setReverbMix(s.roomType === 'off' ? 0 : s.reverbMix);
    engine.setPosition(s.pos.x * 3, s.elevation * 2, s.pos.z * 3);

    const audio = engine.getAudioElement();
    audio.src = track.url;
    audio.volume = s.volume;
    audio.play().catch(() => undefined);
    setCurrentId(track.id);
    engine.updateMediaSession(track.name, track.artist, track.albumArt, () => stepRef.current(1), () => stepRef.current(-1));
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      const list = tracksRef.current;
      if (list.length === 0) return;
      const idx = list.findIndex((t) => t.id === currentIdRef.current);
      for (let i = 1; i <= list.length; i++) {
        const next = list[(((idx + dir * i) % list.length) + list.length) % list.length];
        if (next.url) {
          loadTrack(next);
          return;
        }
      }
    },
    [loadTrack],
  );
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    const engine = new SpatialAudioEngine();
    engineRef.current = engine;
    const audio = engine.getAudioElement();

    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnded = () => stepRef.current(1);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  const togglePlay = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const audio = engine.getAudioElement();
    if (audio.paused) {
      if (!audio.src || !currentTrack) {
        const first = tracks.find((t) => t.url);
        if (first) loadTrack(first);
      } else {
        engine.init();
        audio.play().catch(() => undefined);
      }
    } else {
      audio.pause();
    }
  };

  const seek = (t: number) => {
    setCurrentTime(t);
    if (engineRef.current) engineRef.current.getAudioElement().currentTime = t;
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    if (engineRef.current) engineRef.current.getAudioElement().volume = v;
  };

  const getFrequencyData = useCallback(
    (arr: Uint8Array<ArrayBuffer>) => Boolean(engineRef.current?.ready && engineRef.current.getFrequencyData(arr)),
    [],
  );

  // ---------- Espaço 3D ----------
  useEffect(() => {
    engineRef.current?.setPosition(pos.x * 3, elevation * 2, pos.z * 3);
  }, [pos, elevation]);

  useEffect(() => {
    if (!autoOrbit || !isPlaying) return;
    let frame = 0;
    let angle = Math.atan2(settingsRef.current.pos.z, settingsRef.current.pos.x);
    const radius = Math.max(0.35, Math.min(0.9, Math.hypot(settingsRef.current.pos.x, settingsRef.current.pos.z)));
    const animate = () => {
      angle += 0.015 * orbitSpeed;
      setPos({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [autoOrbit, isPlaying, orbitSpeed]);

  const azimuth = Math.round((Math.atan2(pos.x, -pos.z) * 180) / Math.PI);
  const distance = Math.hypot(pos.x, pos.z) * 3;

  // ---------- Som ----------
  const selectPreset = (name: string, gains: number[]) => {
    setActivePreset(name);
    setEqGains(gains);
    engineRef.current?.applyPreset(gains);
  };

  const changeBand = (index: number, value: number) => {
    const updated = [...eqGains];
    updated[index] = value;
    setEqGains(updated);
    const preset = EQ_PRESETS.find((p) => p.gains.every((g, i) => g === updated[i]));
    setActivePreset(preset ? preset.name : 'Personalizado');
    engineRef.current?.setBandGain(index, value);
  };

  const changeRoom = (type: RoomType) => {
    setRoomType(type);
    engineRef.current?.setRoomType(type);
    const mix = type === 'off' ? 0 : reverbMix === 0 ? 0.25 : reverbMix;
    setReverbMix(mix);
    engineRef.current?.setReverbMix(mix);
  };

  const changeMix = (v: number) => {
    setReverbMix(v);
    engineRef.current?.setReverbMix(v);
  };

  // ---------- Fontes ----------
  const selectPlaylist = useCallback(async (playlistId: string, token: string) => {
    setSelectedPlaylist(playlistId);
    setIsSyncing(true);
    try {
      setSpotifyTracks(await fetchPlaylistTracks(playlistId, token));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Não foi possível carregar a playlist.');
    } finally {
      setIsSyncing(false);
    }
  }, [notify]);

  const syncPlaylists = useCallback(
    async (token: string) => {
      setIsSyncing(true);
      try {
        const list = await fetchUserPlaylists(token);
        setPlaylists(list);
        if (list.length > 0) await selectPlaylist(list[0].id, token);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Falha ao sincronizar o Spotify.');
        setSpotifyToken(null);
      } finally {
        setIsSyncing(false);
      }
    },
    [notify, selectPlaylist],
  );

  useEffect(() => {
    (async () => {
      const token = await handleSpotifyCallback().catch(() => null);
      if (token) {
        setSpotifyToken(token);
        syncPlaylists(token);
      }
    })();
  }, [syncPlaylists]);

  const connectSpotify = () => {
    if (!isSpotifyConfigured()) {
      notify('Defina SPOTIFY_CLIENT_ID em src/spotify/SpotifySync.ts para conectar.');
      return;
    }
    loginWithSpotify();
  };

  const disconnectSpotify = () => {
    logoutSpotify();
    setSpotifyToken(null);
    setPlaylists([]);
    setSpotifyTracks([]);
    setSelectedPlaylist('');
  };

  const handleFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const added: LocalFile[] = Array.from(files).map((file) => {
      const name = file.name.replace(/\.[^/.]+$/, '');
      return { key: normalizeText(name), name, url: URL.createObjectURL(file) };
    });
    setLocalFiles((prev) => [...prev, ...added]);
    e.target.value = '';
    notify(`${added.length} ${added.length === 1 ? 'arquivo importado' : 'arquivos importados'}.`);
    if (!currentId) {
      const first = added[0];
      loadTrack({ id: first.url, name: first.name, artist: 'Arquivo local', url: first.url, source: 'local' });
    }
  };

  const playDemo = async () => {
    let url = demoUrl;
    if (!url) {
      url = await createDemoTrackUrl();
      setDemoUrl(url);
    }
    setAutoOrbit(true);
    loadTrack({ id: 'demo', name: 'Aether Demo — Órbita', artist: 'Faixa de demonstração', url, source: 'demo' });
  };

  const engineActive = isPlaying && Boolean(engineRef.current?.ready);

  const library = (
    <Library
      connected={Boolean(spotifyToken)}
      syncing={isSyncing}
      playlists={playlists}
      selectedPlaylist={selectedPlaylist}
      tracks={tracks}
      currentIndex={currentIndex}
      isPlaying={isPlaying}
      onConnect={connectSpotify}
      onSync={() => spotifyToken && syncPlaylists(spotifyToken)}
      onLogout={disconnectSpotify}
      onImport={() => fileInputRef.current?.click()}
      onDemo={playDemo}
      onSelectPlaylist={(id) => spotifyToken && selectPlaylist(id, spotifyToken)}
      onPlayTrack={(i) => loadTrack(tracks[i])}
    />
  );

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(99,102,241,0.14), transparent 70%), radial-gradient(40% 40% at 100% 100%, rgba(30,215,96,0.04), transparent 70%)',
        }}
      />

      <header className="relative z-10 safe-top">
        <div className="mx-auto max-w-[1440px] px-4 lg:px-6 pb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight leading-tight">Aether 3D</h1>
              <p className="text-[11px] text-ink-muted leading-tight">Áudio espacial binaural</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`hidden sm:inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium ${
                engineActive ? 'border-ok/30 bg-ok/[0.08] text-ok' : 'border-line-strong bg-surface text-ink-muted'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${engineActive ? 'bg-ok animate-pulse' : 'bg-ink-faint'}`} />
              {engineActive ? 'Motor HRTF ativo' : 'Motor em espera'}
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="lg:hidden inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink"
            >
              <FolderOpen className="w-3.5 h-3.5 text-accent" /> Arquivos
            </button>
          </div>
        </div>
      </header>

      <input ref={fileInputRef} type="file" accept="audio/*" multiple onChange={handleFiles} className="hidden" />

      <main className="relative z-10 mx-auto max-w-[1440px] px-4 lg:px-6 pb-40 lg:pb-32 grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)_minmax(340px,400px)]">
        {/* Biblioteca */}
        <aside className={`${tab === 'library' ? 'flex' : 'hidden'} lg:flex flex-col min-h-0`}>{library}</aside>

        {/* Palco */}
        <div className="order-first lg:order-none flex flex-col gap-4 min-h-0">
          <section className="panel p-5 flex-1 flex flex-col">
            <PanelHeader
              icon={<Orbit className="w-4 h-4" />}
              title="Palco sonoro 360°"
              aside={
                <div className="flex items-center gap-2.5">
                  <span className="text-xs text-ink-muted">Órbita automática</span>
                  <Toggle checked={autoOrbit} onChange={setAutoOrbit} label="Órbita automática" />
                </div>
              }
            />

            <div className="flex-1 grid place-items-center py-2">
              <SpatialStage
                pos={pos}
                onMove={(p) => {
                  setAutoOrbit(false);
                  setPos(p);
                }}
                isPlaying={isPlaying}
                getFrequencyData={getFrequencyData}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 mt-2">
              <Stat label="Azimute" value={`${azimuth > 0 ? '+' : ''}${azimuth}°`} />
              <Stat label="Distância" value={`${distance.toFixed(1)} m`} />
              <Stat label="Elevação" value={`${elevation > 0 ? '+' : ''}${elevation.toFixed(1)}`} />
            </div>

            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 mt-4">
              <Field label="Elevação vertical (eixo Y)" value={`${elevation > 0 ? '+' : ''}${elevation.toFixed(1)}`}>
                <Range label="Elevação vertical" min={-1} max={1} step={0.1} value={elevation} onChange={setElevation} />
              </Field>
              <Field label="Velocidade da órbita" value={`${orbitSpeed.toFixed(1)}×`}>
                <Range label="Velocidade da órbita" min={0.2} max={2} step={0.1} value={orbitSpeed} onChange={setOrbitSpeed} disabled={!autoOrbit} />
              </Field>
            </div>
          </section>

          {/* Abas (mobile) */}
          <nav className="lg:hidden grid grid-cols-3 gap-1 p-1 rounded-2xl bg-surface border border-line" aria-label="Seções">
            {(
              [
                ['library', 'Biblioteca', LibraryIcon],
                ['eq', 'Equalizador', Sliders],
                ['room', 'Ambiente', Sparkles],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium transition ${
                  tab === id ? 'bg-raised text-ink shadow' : 'text-ink-muted'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Som */}
        <aside className="flex flex-col gap-4 min-h-0">
          <div className={`${tab === 'eq' ? 'block' : 'hidden'} lg:block`}>
            <Equalizer gains={eqGains} activePreset={activePreset} onPreset={selectPreset} onBand={changeBand} />
          </div>
          <div className={`${tab === 'room' ? 'block' : 'hidden'} lg:block`}>
            <RoomPanel room={roomType} mix={reverbMix} onRoom={changeRoom} onMix={changeMix} />
          </div>
        </aside>
      </main>

      <PlayerBar
        track={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        canPlay={tracks.some((t) => t.url)}
        onToggle={togglePlay}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onSeek={seek}
        onVolume={changeVolume}
      />

      {toast && (
        <div role="status" className="fixed z-40 left-1/2 -translate-x-1/2 bottom-36 lg:bottom-28 animate-fade-up">
          <div className="flex items-center gap-3 rounded-xl bg-raised border border-line-strong shadow-2xl px-4 py-3 text-sm text-ink max-w-[min(92vw,440px)]">
            <span>{toast}</span>
            <button onClick={() => setToast(null)} aria-label="Fechar aviso" className="text-ink-muted hover:text-ink">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
