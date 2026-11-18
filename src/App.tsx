import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { FolderOpen, Library as LibraryIcon, Orbit, Sliders, Sparkles, X } from 'lucide-react';
import { EQ_PRESETS, SpatialAudioEngine, type RoomType } from './audio/AudioEngine';
import { LISTENING_MODES, type ListeningMode } from './audio/listeningModes';
import { createDemoTrackUrl } from './audio/demoTrack';
import { clearCloudUrl, displayName, downloadCloudBlob, getCloudUrl, listCloudAudio, parseSasUrl, setCloudUrl } from './cloud/BlobSync';
import { CloudPanel, type CloudStatus } from './components/CloudPanel';
import { deleteStoredFile, loadStoredFiles, requestPersistentStorage, saveStoredFiles, type StoredFile } from './storage/library';
import {
  FOLLOW_SCOPES,
  fetchCurrentlyPlaying,
  fetchPlaylistTracks,
  fetchUserPlaylists,
  hasScopes,
  pauseSpotifyPlayback,
  handleSpotifyCallback,
  isSpotifySessionSaved,
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
import { CustomizeSound } from './components/CustomizeSound';
import { loadCustomModes, saveCustomModes, MAX_CUSTOM_MODES } from './storage/listeningModes';
import { PlayerBar } from './components/PlayerBar';
import { Field, PanelHeader, Range, Stat, Toggle } from './components/ui';

interface LocalFile {
  id: string;
  cloudName?: string;
  size: number;
  key: string;
  name: string;
  url: string;
}

type MobileTab = 'listen' | 'library' | 'eq' | 'room';

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
  // Lembra o modo "Seguir o Spotify" entre aberturas do app
  const [followSpotify, setFollowSpotifyState] = useState(
    () => localStorage.getItem('aether_follow_spotify') === '1' && isSpotifySessionSaved() && hasScopes(FOLLOW_SCOPES),
  );
  const setFollowSpotify = useCallback((on: boolean) => {
    try {
      localStorage.setItem('aether_follow_spotify', on ? '1' : '0');
    } catch {
      /* armazenamento indisponível */
    }
    setFollowSpotifyState(on);
  }, []);
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
  const [autoOrbit, setAutoOrbit] = useState(true);
  const [orbitSpeed, setOrbitSpeed] = useState(0.35);

  // Som
  const [spatialEnabled, setSpatialEnabled] = useState(true);
  const [nightMode, setNightMode] = useState(false);
  const [activePreset, setActivePreset] = useState('Palco Amplo');
  const [eqGains, setEqGains] = useState<number[]>(EQ_PRESETS[1].gains);
  const [roomType, setRoomType] = useState<RoomType>('studio');
  const [reverbMix, setReverbMix] = useState(0.2);

  const [tab, setTab] = useState<MobileTab>('listen');
  const [customModes, setCustomModes] = useState<ListeningMode[]>(loadCustomModes);
  const [customizing, setCustomizing] = useState(false);
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
  const settingsRef = useRef({ eqGains, roomType, reverbMix, pos, elevation, volume, spatialEnabled, nightMode });
  settingsRef.current = { eqGains, roomType, reverbMix, pos, elevation, volume, spatialEnabled, nightMode };

  const pendingSeekRef = useRef<number | null>(null);

  /** Carrega e toca a faixa. Resolve true se a reprodução começou de fato. */
  const loadTrack = useCallback(async (track: PlayableTrack, startAt?: number): Promise<boolean> => {
    const engine = engineRef.current;
    if (!engine || !track.url) return false;
    const s = settingsRef.current;
    engine.init();
    engine.applyPreset(s.eqGains);
    engine.setSpatialEnabled(s.spatialEnabled);
    engine.setNightMode(s.nightMode);
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

  const changeOrbit = (enabled: boolean) => {
    setAutoOrbit(enabled);
    if (enabled) {
      setSpatialEnabled(true);
      engineRef.current?.setSpatialEnabled(true);
      const radius = Math.hypot(pos.x, pos.z);
      const bounded = Math.max(0.35, Math.min(0.9, radius));
      if (radius === 0) setPos({ x: 0, z: -bounded });
      else if (Math.abs(radius - bounded) > 0.001) setPos({ x: pos.x * bounded / radius, z: pos.z * bounded / radius });
    }
  };

  const activeMode = [...customModes, ...LISTENING_MODES].find((mode) =>
    mode.eq.gains.every((gain, i) => gain === eqGains[i]) &&
    mode.room === roomType && mode.mix === reverbMix && mode.spatial === spatialEnabled && mode.night === nightMode &&
    mode.orbit === autoOrbit && mode.speed === orbitSpeed && mode.elevation === elevation &&
    (autoOrbit
      ? Math.abs(Math.hypot(pos.x, pos.z) - Math.hypot(mode.position.x, mode.position.z)) < 0.001
      : mode.position.x === pos.x && mode.position.z === pos.z),
  );

  const applyListeningMode = (mode: ListeningMode) => {
    selectPreset(mode.eq.name, [...mode.eq.gains]);
    changeRoom(mode.room);
    changeMix(mode.mix);
    setAutoOrbit(mode.orbit);
    setOrbitSpeed(mode.speed);
    setPos({ ...mode.position });
    setElevation(mode.elevation);
    setSpatialEnabled(mode.spatial);
    setNightMode(mode.night);
    engineRef.current?.setSpatialEnabled(mode.spatial);
    engineRef.current?.setNightMode(mode.night);
    notify(`${mode.name} aplicado.`);
  };

  const saveCurrentMode = (name: string) => {
    if (!name || name.length > 40) return false;
    const existing = customModes.find(m => m.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!existing && customModes.length >= MAX_CUSTOM_MODES) {
      notify(`Você pode salvar até ${MAX_CUSTOM_MODES} modos. Remova um para criar outro.`);
      return false;
    }
    const mode: ListeningMode = {
      id: existing?.id ?? `custom-${crypto.randomUUID()}`, name,
      description: 'Sua configuração de áudio.', eq: { name: activePreset, gains: [...eqGains] },
      room: roomType, mix: reverbMix, orbit: autoOrbit, speed: orbitSpeed,
      position: { ...pos }, elevation, spatial: spatialEnabled, night: nightMode,
    };
    const next = existing ? customModes.map(m => m.id === mode.id ? mode : m) : [...customModes, mode];
    try { saveCustomModes(next); } catch { notify('Não foi possível salvar neste navegador. Seus ajustes continuam ativos.'); return false; }
    setCustomModes(next);
    notify(`“${name}” salvo.`);
    return true;
  };

  const removeCustomMode = (id: string) => {
    const next = customModes.filter(m => m.id !== id);
    try { saveCustomModes(next); } catch { notify('Não foi possível remover o modo salvo.'); return; }
    setCustomModes(next);
    notify('Modo removido. O som atual foi mantido.');
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

  const selectedPlaylistRef = useRef(selectedPlaylist);
  selectedPlaylistRef.current = selectedPlaylist;
  const lastPlaylistSyncRef = useRef(0);

  const syncPlaylists = useCallback(
    async (token: string, quiet = false) => {
      setIsSyncing(true);
      try {
        const list = await fetchUserPlaylists(token);
        setPlaylists(list);
        lastPlaylistSyncRef.current = Date.now();
        // Mantém a playlist escolhida, se ela ainda existir
        const keep = list.find((pl) => pl.id === selectedPlaylistRef.current) ?? list[0];
        if (keep) await selectPlaylist(keep.id, token);
      } catch (err) {
        if (!isSpotifySessionSaved()) {
          notify(err instanceof Error ? err.message : 'Falha ao sincronizar o Spotify.');
          setSpotifyToken(null);
        } else if (!quiet) {
          notify('Não consegui atualizar o Spotify agora. Tento de novo em instantes.');
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [notify, selectPlaylist],
  );

  // Atualiza playlists sozinho: ao voltar para o app e a cada 15 min (no máximo a cada 10 min)
  useEffect(() => {
    if (!spotifyToken) return;
    const maybeSync = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastPlaylistSyncRef.current < 10 * 60_000) return;
      syncPlaylists(spotifyToken, true);
    };
    const t = window.setInterval(maybeSync, 15 * 60_000);
    document.addEventListener('visibilitychange', maybeSync);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', maybeSync);
    };
  }, [spotifyToken, syncPlaylists]);

  useEffect(() => {
    (async () => {
      const token = await handleSpotifyCallback().catch(() => null);
      if (token) {
        setSpotifyToken(token);
        syncPlaylists(token);
        if (localStorage.getItem('aether_follow_spotify') === '1' && hasScopes(FOLLOW_SCOPES)) {
          setFollowSpotifyState(true);
        }
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
      localStorage.setItem('aether_follow_spotify', '1'); // liga sozinho ao voltar do login
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
        // Falha passageira (rede): tenta de novo no próximo ciclo. Sessão perdida: desliga.
        if (!isSpotifySessionSaved()) {
          notifyRef.current(err instanceof Error ? err.message : 'Falha ao ler o Spotify.');
          setFollowSpotify(false);
          setSpotifyToken(null);
        }
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
      if (cancelled) return;
      if (stored.length === 0) {
        restoredRef.current = true;
        return;
      }
      const restored = stored.map((f) => {
        const name = f.name;
        return { id: f.id, cloudName: f.cloudName, size: f.size, key: normalizeText(name), name, url: URL.createObjectURL(f.blob) };
      });
      setLocalFiles((prev) => [...restored, ...prev.filter((p) => !restored.some((r) => r.id === p.id))]);
      localFilesRef.current = [...restored, ...localFilesRef.current.filter((p) => !restored.some((r) => r.id === p.id))];
      restoredRef.current = true;
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
    notify(
      file.cloudName
        ? `“${file.name}” removida do aparelho. Ela volta na próxima sincronização se continuar na nuvem.`
        : `“${file.name}” removida da biblioteca.`,
    );
  };

  // ---------- Nuvem (Azure Blob Storage) ----------
  const [cloudUrl, setCloudUrlState] = useState<string | null>(() => getCloudUrl());
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>({ phase: 'idle', cloudCount: 0, total: 0, done: 0 });
  const syncingRef = useRef(false);
  const lastSyncRef = useRef(0);
  const restoredRef = useRef(false);
  const wantedRef = useRef<string[]>([]);
  wantedRef.current = [
    ...(spotifyNow ? [normalizeText(spotifyNow.name)] : []),
    ...spotifyTracks.map((t) => normalizeText(t.name)),
  ].filter(Boolean);

  const syncCloud = useCallback(async (url: string) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setCloudStatus((s) => ({ ...s, phase: 'checking', error: undefined }));
    try {
      const blobs = await listCloudAudio(url);
      const local = localFilesRef.current;
      const missing = blobs.filter(
        (b) => !local.some((f) => f.cloudName === b.name || (f.name === displayName(b.name) && f.size === b.size)),
      );
      // Primeiro as músicas da playlist / da faixa que está tocando no Spotify
      const wanted = wantedRef.current;
      const score = (name: string) => {
        const key = normalizeText(displayName(name));
        const i = wanted.findIndex((w) => key.includes(w));
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      missing.sort((a, b) => score(a.name) - score(b.name));

      let failed = 0;
      for (let i = 0; i < missing.length; i++) {
        const b = missing[i];
        const name = displayName(b.name);
        setCloudStatus((s) => ({ ...s, phase: 'downloading', total: missing.length, done: i, current: name }));
        try {
          const blob = await downloadCloudBlob(url, b.name);
          const id = `cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await saveStoredFiles([{ id, name, size: blob.size, blob, addedAt: Date.now(), cloudName: b.name, cloudEtag: b.etag }]);
          const file: LocalFile = { id, cloudName: b.name, size: blob.size, key: normalizeText(name), name, url: URL.createObjectURL(blob) };
          setLocalFiles((prev) => [...prev, file]);
          localFilesRef.current = [...localFilesRef.current, file];
        } catch {
          failed++;
        }
      }

      // Remove do aparelho o que foi apagado da nuvem
      const names = new Set(blobs.map((b) => b.name));
      const removed = localFilesRef.current.filter((f) => f.cloudName && !names.has(f.cloudName));
      if (removed.length) {
        for (const f of removed) {
          URL.revokeObjectURL(f.url);
          await deleteStoredFile(f.id).catch(() => undefined);
        }
        setLocalFiles((prev) => prev.filter((f) => !removed.some((r) => r.id === f.id)));
      }

      lastSyncRef.current = Date.now();
      setCloudStatus({ phase: 'done', cloudCount: blobs.length, total: 0, done: 0, lastSync: Date.now(), failed });
      const got = missing.length - failed;
      if (got > 0) notifyRef.current(`${got} ${got === 1 ? 'música nova baixada' : 'músicas novas baixadas'} da nuvem.`);
    } catch (err) {
      setCloudStatus((s) => ({ ...s, phase: 'error', error: err instanceof Error ? err.message : 'Falha ao sincronizar.' }));
    } finally {
      syncingRef.current = false;
    }
  }, []);

  // Sincroniza ao abrir o app e sempre que ele volta para a tela (no máximo a cada 2 min)
  useEffect(() => {
    if (!cloudUrl) return;
    const maybeSync = () => {
      if (!restoredRef.current || document.visibilityState !== 'visible') return;
      if (Date.now() - lastSyncRef.current < 120_000) return;
      syncCloud(cloudUrl);
    };
    const t = window.setInterval(maybeSync, 1000 * 60 * 10);
    const start = window.setTimeout(maybeSync, 800);
    document.addEventListener('visibilitychange', maybeSync);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(start);
      document.removeEventListener('visibilitychange', maybeSync);
    };
  }, [cloudUrl, syncCloud]);

  const connectCloud = async (raw: string): Promise<boolean> => {
    try {
      parseSasUrl(raw);
      setCloudStatus((s) => ({ ...s, phase: 'checking', error: undefined }));
      await listCloudAudio(raw);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Não foi possível conectar.');
      setCloudStatus((s) => ({ ...s, phase: 'idle' }));
      return false;
    }
    setCloudUrl(raw);
    setCloudUrlState(raw.trim());
    await requestPersistentStorage();
    lastSyncRef.current = 0;
    syncCloud(raw.trim());
    return true;
  };

  const disconnectCloud = () => {
    clearCloudUrl();
    setCloudUrlState(null);
    setCloudStatus({ phase: 'idle', cloudCount: 0, total: 0, done: 0 });
    notify('Nuvem desconectada. As músicas já baixadas continuam no aparelho.');
  };

  const playDemo = async () => {
    let url = demoUrl;
    if (!url) {
      url = await createDemoTrackUrl();
      setDemoUrl(url);
    }
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
      cloud={
        <CloudPanel
          configured={Boolean(cloudUrl)}
          status={cloudStatus}
          onConnect={connectCloud}
          onSync={() => cloudUrl && syncCloud(cloudUrl)}
          onDisconnect={disconnectCloud}
        />
      }
    />
  );

  return (
    <div className="min-h-screen relative overflow-x-hidden">

      <header className="relative z-10 safe-top">
        <div className="mx-auto max-w-[1440px] px-4 xl:px-6 pb-5 pt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-[-0.05em]">aether<span className="text-accent ml-1.5 font-mono text-xs tracking-normal">3D</span></h1>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`hidden sm:inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium ${
                engineActive ? 'border-ok/30 bg-ok/[0.08] text-ok' : 'border-line-strong bg-surface text-ink-muted'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${engineActive ? 'bg-ok animate-pulse' : 'bg-ink-faint'}`} />
              {engineActive ? 'Áudio ativo' : 'Em espera'}
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="xl:hidden inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink"
            >
              <FolderOpen className="w-3.5 h-3.5 text-accent" /> Arquivos
            </button>
          </div>
        </div>
      </header>

          {/* Abas (mobile) */}
          <nav className="app-tabs xl:hidden grid grid-cols-4 mx-4 mb-6 border-b border-line-strong" aria-label="Seções">
            {(
              [
                ['listen', 'Som 3D', Orbit],
                ['library', 'Biblioteca', LibraryIcon],
                ['eq', 'Equalizador', Sliders],
                ['room', 'Ambiente', Sparkles],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`flex items-center justify-center gap-1.5 py-3 text-[11px] font-medium transition ${
                  tab === id ? 'text-accent border-b-2 border-accent' : 'text-ink-muted border-b-2 border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 hidden min-[380px]:block" /> {label}
              </button>
            ))}
          </nav>
      <input ref={fileInputRef} type="file" accept="audio/*" multiple onChange={handleFiles} className="hidden" />

      <main className="relative z-10 mx-auto max-w-[1440px] px-4 xl:px-6 pb-40 xl:pb-32 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        {/* Biblioteca */}
        <aside className={`${tab === 'library' ? 'flex' : 'hidden'} xl:flex flex-col min-h-0`}>{library}</aside>

        {/* Palco e faixa atual */}
        <div className={`${tab === 'listen' ? 'flex' : 'hidden'} xl:flex order-first xl:order-none flex-col gap-0 min-h-0 listening-console`}>
          <section className="now-playing px-5 pt-6 pb-5 sm:px-7" aria-label="Em reprodução">
            <div className="flex items-center gap-4">
              <div className="cover-placeholder shrink-0" aria-hidden="true">
                {currentTrack?.albumArt ? <img src={currentTrack.albumArt} alt="" className="w-full h-full object-cover" /> : <LibraryIcon className="w-6 h-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.14em] text-ink-muted mb-1">{isPlaying ? 'Tocando agora' : currentTrack ? 'Pausado' : 'Player'}</p>
                <h2 className="text-lg font-semibold tracking-tight truncate">{currentTrack?.name ?? 'Nenhuma faixa selecionada'}</h2>
                <p className="text-xs text-ink-muted mt-1 truncate">{currentTrack?.artist ?? 'Arquivos locais · Spotify · Nuvem'}</p>
              </div>
            </div>
            {!currentTrack && <button onClick={playDemo} className="demo-button mt-5 w-full flex items-center justify-center gap-2 text-sm font-medium min-h-11">Testar som 3D <span aria-hidden="true">↗</span></button>}
          </section>
          <section className="mode-strip px-5 py-5 sm:px-7" aria-labelledby="listening-modes-title">
            <div className="flex items-center justify-between mb-3 gap-3">
              <h2 id="listening-modes-title" className="text-xs font-medium text-ink-muted">Modo de escuta</h2>
              <span className="font-mono text-[10px] text-accent">{activeMode ? 'PRESET' : 'MANUAL'}</span>
            </div>
            <div className="grid grid-cols-3 gap-1 mode-selector" role="group" aria-label="Modos de escuta">
              {LISTENING_MODES.map((mode) => (
                <button key={mode.id} onClick={() => applyListeningMode(mode)} aria-pressed={activeMode?.id === mode.id}
                  className={`min-h-11 text-xs font-medium transition-colors ${activeMode?.id === mode.id ? 'mode-selected' : 'text-ink-muted hover:text-ink'}`}>
                  {mode.name}
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-2"><button onClick={() => setCustomizing(true)} className="text-xs font-medium text-accent underline underline-offset-4">Personalizar</button></div>
            {customModes.length > 0 && <div className="mt-3 border-t border-line-strong pt-3">
              <h3 className="text-xs text-ink-muted mb-2">Meus modos</h3>
              <ul className="space-y-1">{customModes.map(mode => <li key={mode.id} className="flex items-center gap-2">
                <button onClick={() => applyListeningMode(mode)} aria-pressed={activeMode?.id === mode.id} className={`flex-1 min-w-0 text-left text-sm px-3 rounded-md truncate ${activeMode?.id === mode.id ? 'bg-raised text-accent' : 'text-ink-muted'}`}>{mode.name}</button>
                <button onClick={() => removeCustomMode(mode.id)} aria-label={`Excluir modo ${mode.name}`} className="text-xs text-ink-muted px-2">Excluir</button>
              </li>)}</ul>
            </div>}
            <p className="text-xs text-ink-muted leading-relaxed mt-3 min-h-9">{activeMode?.description ?? 'Ajuste manual. Selecione um modo para restaurar a configuração.'}</p>
          </section>
          <section className="stage-panel px-5 pb-5 sm:px-7 flex-1 flex flex-col">
            <PanelHeader
              icon={<Orbit className="w-4 h-4" />}
              title="Som 3D"
              aside={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">Órbita</span>
                  <Toggle checked={autoOrbit} onChange={changeOrbit} label="Órbita automática" />
                </div>
              }
            />

            <div className="flex items-center justify-between mt-4 mb-2 gap-3 text-xs text-ink-muted">
              <span>Espacialização binaural</span>
              <Toggle checked={spatialEnabled} onChange={(enabled) => { setSpatialEnabled(enabled); if (!enabled) setAutoOrbit(false); engineRef.current?.setSpatialEnabled(enabled); }} label="Espacialização binaural" />
            </div>
            <div inert={!spatialEnabled} className={`flex-1 grid place-items-center py-2 ${spatialEnabled ? '' : 'opacity-35'}`}>
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

            <p className="text-center text-[11px] text-ink-muted mb-5">{spatialEnabled ? 'Use fones. Arraste o ponto para posicionar o som.' : 'Reprodução em estéreo. Ative a espacialização para usar o palco.'}</p>
            <details className="border-t border-line-strong">
              <summary className="cursor-pointer text-sm text-ink-muted py-3 min-h-11">Ajustes do espaço</summary>
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
            </details>
          </section>


        </div>

        {/* Som */}
        <aside className="flex flex-col gap-4 min-h-0">
          <div className={`${tab === 'eq' ? 'block' : 'hidden'} xl:block`}>
            <Equalizer gains={eqGains} activePreset={activePreset} onPreset={selectPreset} onBand={changeBand} />
          </div>
          <div className={`${tab === 'room' ? 'block' : 'hidden'} xl:block`}>
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

      {customizing && <CustomizeSound onClose={() => setCustomizing(false)} onSave={saveCurrentMode}
        gains={eqGains} activePreset={activePreset} onPreset={selectPreset} onBand={changeBand}
        room={roomType} mix={reverbMix} onRoom={changeRoom} onMix={changeMix}
        spatial={spatialEnabled} night={nightMode} orbit={autoOrbit}
        onSpatial={enabled => { setSpatialEnabled(enabled); if (!enabled) setAutoOrbit(false); engineRef.current?.setSpatialEnabled(enabled); }}
        onNight={enabled => { setNightMode(enabled); engineRef.current?.setNightMode(enabled); }}
        onOrbit={changeOrbit}
        position={pos} onPosition={setPos} elevation={elevation} onElevation={setElevation}
        speed={orbitSpeed} onSpeed={setOrbitSpeed} />}

      {toast && (
        <div role="status" className="fixed z-40 left-1/2 -translate-x-1/2 bottom-36 xl:bottom-28 animate-fade-up w-[min(92vw,440px)]">
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
