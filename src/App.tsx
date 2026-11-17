import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { FolderOpen, Library as LibraryIcon, Orbit, Sliders, Sparkles, X } from 'lucide-react';
import { EQ_PRESETS, SpatialAudioEngine, type RoomType } from './audio/AudioEngine';
import { createDemoTrackUrl } from './audio/demoTrack';
import { deleteStoredFile, loadStoredFiles, requestPersistentStorage, saveStoredFiles, type StoredFile } from './storage/library';
import {
  FOLLOW_SCOPES,
  fetchCurrentlyPlaying,
  fetchPlaylistTracks,
  fetchUserPlaylists,
  hasScopes,
  pauseSpotifyPlayback,
  handleSpotifyCallback,
  isSpotifyConfigured,
  loginWithSpotify,
  logoutSpotify,
  normalizeText,
  type SpotifyNowPlaying,
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
  id: string;
  size: number;
  key: string;
  name: string;
  url: string;
}

type MobileTab = 'library' | 'eq' | 'room';

function findLocalMatch(files: LocalFile[], name: string, artist: string) {
  const cleanTrack = normalizeText(name);
  const cleanFull = normalizeText(`${artist} ${name}`);
  if (!cleanTrack) return undefined;
  return files.find((f) => f.key.includes(cleanTrack) || cleanFull.includes(f.key));
}

// WAV silencioso: "destrava" o player no iOS durante um toque, para tocar depois sem gesto.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

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
  const [followSpotify, setFollowSpotify] = useState(false);
  const [spotifyNow, setSpotifyNow] = useState<SpotifyNowPlaying | null>(null);

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
      const match = findLocalMatch(localFiles, sp.name, sp.artist);
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
  const [followMeta, setFollowMeta] = useState<Pick<PlayableTrack, 'id' | 'name' | 'artist' | 'albumArt'> | null>(null);
  const baseTrack = currentIndex >= 0 ? tracks[currentIndex] : undefined;
  // Ao seguir o Spotify, mostra os dados da faixa do Spotify sobre o arquivo local vinculado.
  const currentTrack = baseTrack && followMeta?.id === baseTrack.id ? { ...baseTrack, ...followMeta } : baseTrack;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4200);
  }, []);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  // ---------- Reprodução ----------
  const settingsRef = useRef({ eqGains, roomType, reverbMix, pos, elevation, volume });
  settingsRef.current = { eqGains, roomType, reverbMix, pos, elevation, volume };

  const pendingSeekRef = useRef<number | null>(null);

  /** Carrega e toca a faixa. Resolve true se a reprodução começou de fato. */
  const loadTrack = useCallback(async (track: PlayableTrack, startAt?: number): Promise<boolean> => {
    const engine = engineRef.current;
    if (!engine || !track.url) return false;
    const s = settingsRef.current;
    engine.init();
    engine.applyPreset(s.eqGains);
    engine.setRoomType(s.roomType);
    engine.setReverbMix(s.roomType === 'off' ? 0 : s.reverbMix);
    engine.setPosition(s.pos.x * 3, s.elevation * 2, s.pos.z * 3);

    const audio = engine.getAudioElement();
    pendingSeekRef.current = startAt && startAt > 0 ? startAt : null;
    audio.src = track.url;
    audio.volume = s.volume;
    setCurrentId(track.id);
    engine.updateMediaSession(track.name, track.artist, track.albumArt, () => stepRef.current(1), () => stepRef.current(-1));
    try {
      await audio.play();
      return true;
    } catch {
      notifyRef.current(`“${track.name}” está pronta. Toque em play para ouvir em 3D.`);
      return false;
    }
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
    const onMeta = () => {
      setDuration(audio.duration || 0);
      const seek = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (seek !== null && seek < (audio.duration || Infinity)) audio.currentTime = seek;
    };
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
    setFollowSpotify(false);
    setSpotifyNow(null);
    setSpotifyToken(null);
    setPlaylists([]);
    setSpotifyTracks([]);
    setSelectedPlaylist('');
  };

  // ---------- Seguir o Spotify ----------
  const localFilesRef = useRef(localFiles);
  localFilesRef.current = localFiles;
  const followStateRef = useRef<{ handledId: string | null; notifiedId: string | null; warnedPause: boolean }>({ handledId: null, notifiedId: null, warnedPause: false });

  const toggleFollow = (on: boolean) => {
    if (on && !hasScopes(FOLLOW_SCOPES)) {
      notify('Autorize o Aether 3D a ver o que você está ouvindo. Abrindo o Spotify…');
      window.setTimeout(loginWithSpotify, 900);
      return;
    }
    if (on) {
      // Destrava o áudio no iOS enquanto há um toque do usuário.
      const engine = engineRef.current;
      if (engine) {
        engine.init();
        const audio = engine.getAudioElement();
        if (!audio.src) {
          audio.src = SILENT_WAV;
          audio.play().then(() => audio.pause()).catch(() => undefined);
        }
      }
      followStateRef.current = { handledId: null, notifiedId: null, warnedPause: false };
    } else {
      setSpotifyNow(null);
    }
    setFollowSpotify(on);
  };

  const handleSpotifyNow = useCallback(
    async (now: SpotifyNowPlaying | null, token: string) => {
      setSpotifyNow(now);
      const state = followStateRef.current;
      if (!now || !now.isPlaying || now.id === state.handledId) return;

      const match = findLocalMatch(localFilesRef.current, now.name, now.artist);
      if (!match) {
        if (state.notifiedId !== now.id) {
          state.notifiedId = now.id;
          notifyRef.current(`No Spotify: “${now.name}”. Importe o arquivo para ouvir em 3D.`);
        }
        return;
      }
      state.handledId = now.id;
      const startAt = now.progressMs / 1000 + 0.6; // compensa o atraso da troca
      // Usa o ID da faixa já na fila (ex.: a mesma música na playlist selecionada) para o player achá-la.
      const queueId = tracksRef.current.find((t) => t.url === match.url)?.id ?? match.url;
      setFollowMeta({ id: queueId, name: now.name, artist: now.artist, albumArt: now.albumArt });
      const started = await loadTrack(
        { id: queueId, name: now.name, artist: now.artist, albumArt: now.albumArt, url: match.url, source: 'spotify-matched' },
        startAt,
      );
      // Só pausa o Spotify se o 3D realmente começou a tocar; senão os dois ficariam mudos.
      if (!started) return;
      const paused = await pauseSpotifyPlayback(token);
      if (!paused && !state.warnedPause) {
        state.warnedPause = true;
        notifyRef.current('Não consegui pausar o Spotify (requer Premium). Pause-o para ouvir só em 3D.');
      }
    },
    [loadTrack],
  );

  useEffect(() => {
    if (!followSpotify || !spotifyToken) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const now = await fetchCurrentlyPlaying(spotifyToken);
        if (!cancelled) await handleSpotifyNow(now, spotifyToken);
      } catch (err) {
        if (cancelled) return;
        notifyRef.current(err instanceof Error ? err.message : 'Falha ao ler o Spotify.');
        setFollowSpotify(false);
      }
    };
    poll();
    const id = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [followSpotify, spotifyToken, handleSpotifyNow]);

  const spotifyNowMatched = spotifyNow ? Boolean(findLocalMatch(localFiles, spotifyNow.name, spotifyNow.artist)) : false;

  // Restaura a biblioteca salva no aparelho ao abrir o app.
  useEffect(() => {
    let cancelled = false;
    loadStoredFiles().then((stored) => {
      if (cancelled || stored.length === 0) return;
      const restored = stored.map((f) => {
        const name = f.name;
        return { id: f.id, size: f.size, key: normalizeText(name), name, url: URL.createObjectURL(f.blob) };
      });
      setLocalFiles((prev) => [...restored, ...prev.filter((p) => !restored.some((r) => r.id === p.id))]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const existing = localFilesRef.current;
    const stored: StoredFile[] = [];
    const added: LocalFile[] = [];
    let skipped = 0;
    for (const file of Array.from(files)) {
      const name = file.name.replace(/\.[^/.]+$/, '');
      // Ignora arquivos repetidos (mesmo nome e tamanho)
      if ([...existing, ...added].some((f) => f.name === name && f.size === file.size)) {
        skipped++;
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      stored.push({ id, name, size: file.size, blob: file, addedAt: Date.now() + added.length });
      added.push({ id, size: file.size, key: normalizeText(name), name, url: URL.createObjectURL(file) });
    }
    e.target.value = '';
    if (added.length === 0) {
      notify(skipped === 1 ? 'Esse arquivo já está na sua biblioteca.' : 'Esses arquivos já estão na sua biblioteca.');
      return;
    }
    setLocalFiles((prev) => [...prev, ...added]);

    let saved = true;
    try {
      await requestPersistentStorage();
      await saveStoredFiles(stored);
    } catch {
      saved = false;
    }
    const n = added.length;
    notify(
      saved
        ? `${n} ${n === 1 ? 'música salva' : 'músicas salvas'} no aparelho. Não precisa importar de novo.`
        : `${n} ${n === 1 ? 'arquivo importado' : 'arquivos importados'}, mas sem espaço para salvar no aparelho.`,
    );
    if (!currentId) {
      const first = added[0];
      loadTrack({ id: first.url, name: first.name, artist: 'Arquivo local', url: first.url, source: 'local' });
    }
  };

  const removeLocal = async (url: string) => {
    const file = localFilesRef.current.find((f) => f.url === url);
    if (!file) return;
    if (currentIdRef.current && engineRef.current?.getAudioElement().src === url) {
      engineRef.current.getAudioElement().pause();
      setCurrentId(null);
    }
    setLocalFiles((prev) => prev.filter((f) => f.id !== file.id));
    URL.revokeObjectURL(url);
    await deleteStoredFile(file.id).catch(() => undefined);
    notify(`“${file.name}” removida da biblioteca.`);
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
      following={followSpotify}
      onFollow={toggleFollow}
      spotifyNow={spotifyNow}
      spotifyNowMatched={spotifyNowMatched}
      onLogout={disconnectSpotify}
      onImport={() => fileInputRef.current?.click()}
      onDemo={playDemo}
      onSelectPlaylist={(id) => spotifyToken && selectPlaylist(id, spotifyToken)}
      onPlayTrack={(i) => loadTrack(tracks[i])}
      onRemoveTrack={removeLocal}
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
