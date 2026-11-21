import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { FolderOpen, Library as LibraryIcon, Orbit, Sliders, Sparkles, X } from 'lucide-react';
import { EQ_PRESETS, SpatialAudioEngine, type RoomType } from './audio/AudioEngine';
import { LISTENING_MODES, createDjMode, upgradeListeningMode, type ListeningMode } from './audio/listeningModes';
import { SpotifyHandoff, type HandoffStatus } from './spotify/SpotifyHandoff';
import { findTrackMatch } from './spotify/trackMatching';
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
import { useAccount } from './account/useAccount';
import { parseSound, parseModes, parseSpotify, type AccountSettings, type SettingsPatch } from './account/settings';
import { AdaptiveStage } from './components/AdaptiveStage';
import { SurroundStage } from './components/SurroundStage';
import { LivePanel } from './components/LivePanel';
import { captureDevice, captureTab, describeCaptureError, stopSource, type LiveSource } from './audio/liveInput';
import { DjLevels } from './components/DjLevels';
import { AccountPanel } from './components/AccountPanel';
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

const findLocalMatch = findTrackMatch;

export default function App() {
  const engineRef = useRef<SpatialAudioEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accountIdentityRef = useRef<string | null>(null);
  const requestCloudTrackRef = useRef<(name: string) => void>(() => {});

  // Fontes
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [demoUrl, setDemoUrl] = useState<string | null>(null);
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState('');
  const [spotifyRefreshRevision, setSpotifyRefreshRevision] = useState('');
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
  const [handoffStatus, setHandoffStatus] = useState<HandoffStatus>({ phase: 'idle', message: '' });
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
  const autoOrbit = false;
  const orbitSpeed = 0.35;
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(true);
  const [adaptiveIntensity, setAdaptiveIntensity] = useState(65);
  const [surroundEnabled, setSurroundEnabled] = useState(false);
  const [surroundAmount, setSurroundAmount] = useState(70);
  const [voiceFocus, setVoiceFocus] = useState(70);
  const [bassPunch, setBassPunch] = useState(30);
  const [autoMix, setAutoMix] = useState(true);
  const [djTransitions, setDjTransitions] = useState(true);
  const [liveNow, setLiveNow] = useState<SpotifyNowPlaying | null>(null);

  // Ao vivo (computador): aba do navegador ou entrada de áudio, sem salvar arquivos
  const [liveSource, setLiveSource] = useState<LiveSource | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveSourceRef = useRef<LiveSource | null>(null);
  liveSourceRef.current = liveSource;

  // Som
  const [djIntensity, setDjIntensity] = useState(65);
  const [preferredModeId, setPreferredModeId] = useState<string>('immersive');
  const [spatialEnabled, setSpatialEnabled] = useState(true);
  const [nightMode, setNightMode] = useState(false);
  const [activePreset, setActivePreset] = useState('Neutro');
  const [eqGains, setEqGains] = useState<number[]>(EQ_PRESETS[0].gains);
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
      ? [{ id: 'demo', name: 'Aether · Demonstração', artist: 'Faixa de demonstração', url: demoUrl, source: 'demo' }]
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
  const settingsRef = useRef({ eqGains, roomType, reverbMix, pos, elevation, volume, spatialEnabled, nightMode, adaptiveEnabled, adaptiveIntensity, surroundEnabled, surroundAmount, voiceFocus, bassPunch, autoMix, djTransitions });
  settingsRef.current = { eqGains, roomType, reverbMix, pos, elevation, volume, spatialEnabled, nightMode, adaptiveEnabled, adaptiveIntensity, surroundEnabled, surroundAmount, voiceFocus, bassPunch, autoMix, djTransitions };

  /** Applies every current sound setting to the engine (before a file or a live source starts). */
  const applyEngineSettings = useCallback((engine: SpatialAudioEngine) => {
    const s = settingsRef.current;
    engine.init();
    engine.applyPreset(s.eqGains);
    engine.setSpatialEnabled(s.spatialEnabled);
    engine.setAdaptiveEnabled(s.adaptiveEnabled);
    engine.setAdaptiveIntensity(s.adaptiveIntensity);
    engine.setSurroundEnabled(s.surroundEnabled);
    engine.setSurroundAmount(s.surroundAmount);
    engine.setVoiceFocus(s.voiceFocus);
    engine.setBassPunch(s.bassPunch);
    engine.setAutoMix(s.autoMix);
    engine.setDjTransitions(s.djTransitions);
    engine.resetAdaptiveAnalysis();
    engine.resetSurroundAnalysis();
    engine.setNightMode(s.nightMode);
    engine.setRoomType(s.roomType);
    engine.setReverbMix(s.roomType === 'off' ? 0 : s.reverbMix);
    engine.setPosition(s.pos.x * 3, s.elevation * 2, s.pos.z * 3);
  }, []);

  const stopLive = useCallback(() => {
    const source = liveSourceRef.current;
    if (!source) return;
    liveSourceRef.current = null;
    stopSource(source);
    engineRef.current?.detachStream();
    setLiveSource(null);
    setLiveNow(null);
    setIsPlaying(false);
  }, []);

  const pendingSeekRef = useRef<{ position: number; receivedAt: number } | null>(null);

  /** Carrega e toca a faixa. Resolve true se a reprodução começou de fato. */
  const loadTrack = useCallback(async (track: PlayableTrack, startAt?: number): Promise<boolean> => {
    const engine = engineRef.current;
    if (!engine || !track.url) return false;
    const s = settingsRef.current;
    stopLive();
    applyEngineSettings(engine);

    const audio = engine.getAudioElement();
    pendingSeekRef.current = startAt !== undefined && startAt >= 0 ? { position: startAt, receivedAt: performance.now() } : null;
    audio.src = track.url;
    audio.volume = s.volume;
    setCurrentId(track.id);
    engine.updateMediaSession(track.name, track.artist, track.albumArt, () => stepRef.current(1), () => stepRef.current(-1));
    try {
      await engine.play();
      engine.djTrackChange();
      return true;
    } catch {
      notifyRef.current(`“${track.name}” está pronta. Toque em play para ouvir em 3D.`);
      return false;
    }
  }, [applyEngineSettings, stopLive]);

  const startLive = useCallback(async (capture: () => Promise<LiveSource>) => {
    const engine = engineRef.current;
    if (!engine) return;
    setLiveBusy(true);
    setLiveError(null);
    try {
      const source = await capture();
      stopLive();
      engine.getAudioElement().pause();
      applyEngineSettings(engine);
      await engine.attachStream(source.stream);
      // Sharing stopped from the browser's own bar, or the device unplugged.
      source.stream.getAudioTracks()[0]?.addEventListener('ended', () => { if (liveSourceRef.current === source) stopLive(); });
      liveSourceRef.current = source;
      setLiveSource(source);
      setIsPlaying(true);
      notifyRef.current('Ao vivo pelo motor do Aether.');
    } catch (error) {
      setLiveError(describeCaptureError(error));
    } finally {
      setLiveBusy(false);
    }
  }, [applyEngineSettings, stopLive]);

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

    const onTime = () => {
      setCurrentTime(audio.currentTime);
      // Files get the same DJ outro as Spotify: the last 8 seconds echo out.
      const left = audio.duration - audio.currentTime;
      if (Number.isFinite(left) && left > 0 && left < 8 && !audio.paused) engine.djOutro(left);
    };
    const onMeta = () => {
      setDuration(audio.duration || 0);
      const seek = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (seek !== null) {
        const position = seek.position + (performance.now() - seek.receivedAt) / 1000;
        if (position < (audio.duration || Infinity)) audio.currentTime = position;
      }
    };
    const onEnded = () => stepRef.current(1);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => { if (!liveSourceRef.current) setIsPlaying(false); };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      stopSource(liveSourceRef.current);
      engine.dispose();
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
    if (liveSourceRef.current) { stopLive(); return; }
    const audio = engine.getAudioElement();
    if (audio.paused && followSpotify && spotifyToken && (handoffStatus.phase === 'blocked' || handoffStatus.phase === 'error')) {
      void handoff.retry(spotifyToken);
      return;
    }
    if (audio.paused) {
      if (!audio.src || !currentTrack) {
        const first = tracks.find((t) => t.url);
        if (first) loadTrack(first);
      } else {
        engine.init();
        void engine.play().catch(() => notify('Toque em play para retomar o áudio.'));
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


  const modesByPreference = [...LISTENING_MODES.map(mode => mode.id === 'dj' ? createDjMode(djIntensity) : mode), ...customModes].map(upgradeListeningMode).sort((a, b) => Number(b.id === preferredModeId) - Number(a.id === preferredModeId));
  const activeMode = modesByPreference.find((mode) =>
    mode.eq.gains.every((gain, i) => gain === eqGains[i]) &&
    mode.room === roomType && mode.mix === reverbMix && mode.spatial === spatialEnabled && mode.night === nightMode &&
    Boolean(mode.adaptive) === adaptiveEnabled &&
    Boolean(mode.surround) === surroundEnabled && (!mode.surround || (mode.surroundAmount === surroundAmount && mode.voiceFocus === voiceFocus && (mode.bassPunch ?? 30) === bassPunch)) &&
    (mode.adaptive ? mode.adaptiveIntensity === adaptiveIntensity : mode.elevation === elevation && mode.position.x === pos.x && mode.position.z === pos.z),
  );

  const changeSurround = (enabled: boolean) => { setSurroundEnabled(enabled); engineRef.current?.setSurroundEnabled(enabled); };
  const changeSurroundAmount = (value: number) => { setSurroundAmount(value); engineRef.current?.setSurroundAmount(value); };
  const changeVoiceFocus = (value: number) => { setVoiceFocus(value); engineRef.current?.setVoiceFocus(value); };
  const changeBassPunch = (value: number) => { setBassPunch(value); engineRef.current?.setBassPunch(value); };
  const changeAutoMix = (enabled: boolean) => { setAutoMix(enabled); engineRef.current?.setAutoMix(enabled); };
  const changeDjTransitions = (enabled: boolean) => { setDjTransitions(enabled); engineRef.current?.setDjTransitions(enabled); };

  const applyListeningMode = (rawMode: ListeningMode, announce = true) => {
    const mode = upgradeListeningMode(rawMode);
    setAdaptiveEnabled(Boolean(mode.adaptive));
    setAdaptiveIntensity(mode.adaptiveIntensity ?? 65);
    engineRef.current?.setAdaptiveEnabled(Boolean(mode.adaptive));
    engineRef.current?.setAdaptiveIntensity(mode.adaptiveIntensity ?? 65);
    changeSurround(Boolean(mode.surround));
    changeSurroundAmount(mode.surroundAmount ?? 70);
    changeVoiceFocus(mode.voiceFocus ?? 70);
    changeBassPunch(mode.bassPunch ?? 30);
    if (mode.djIntensity !== undefined) setDjIntensity(mode.djIntensity);
    setPreferredModeId(mode.id);
    selectPreset(mode.eq.name, [...mode.eq.gains]);
    changeRoom(mode.room);
    changeMix(mode.mix);

    setPos({ ...mode.position });
    setElevation(mode.elevation);
    setSpatialEnabled(mode.spatial);
    setNightMode(mode.night);
    engineRef.current?.setSpatialEnabled(mode.spatial);
    engineRef.current?.setNightMode(mode.night);
    if (announce) notify(`${mode.name} aplicado.`);
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
      adaptive: adaptiveEnabled, adaptiveIntensity, surround: surroundEnabled, surroundAmount, voiceFocus, bassPunch,
      ...((preferredModeId === 'dj' || activeMode?.djIntensity !== undefined) ? { djIntensity } : {}),
    };
    const next = existing ? customModes.map(m => m.id === mode.id ? mode : m) : [...customModes, mode];
    try { saveCustomModes(next, accountIdentityRef.current ?? undefined); } catch { notify('Não foi possível salvar neste navegador. Seus ajustes continuam ativos.'); return false; }
    setCustomModes(next);
    setPreferredModeId(mode.id);
    notify(`“${name}” salvo.`);
    return true;
  };

  const removeCustomMode = (id: string) => {
    const next = customModes.filter(m => m.id !== id);
    try { saveCustomModes(next, accountIdentityRef.current ?? undefined); } catch { notify('Não foi possível remover o modo salvo.'); return; }
    setCustomModes(next);
    notify('Modo removido. O som atual foi mantido.');
  };

  // ---------- Fontes ----------
  const lastRequestedPlaylist = useRef('');
  const selectPlaylist = useCallback(async (playlistId: string, token: string) => {
    lastRequestedPlaylist.current = playlistId;
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

  useEffect(() => {
    if (spotifyToken && selectedPlaylist && !isSyncing && lastRequestedPlaylist.current !== selectedPlaylist) {
      void selectPlaylist(selectedPlaylist, spotifyToken);
    }
  }, [spotifyToken, selectedPlaylist, isSyncing, selectPlaylist]);

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
  const handoff = useMemo(() => new SpotifyHandoff({
    findFile: track => findLocalMatch(localFilesRef.current, track.name, track.artist),
    isPlaying: file => {
      const audio = engineRef.current?.getAudioElement();
      return Boolean(audio && audio.src === file.url && !audio.paused && !audio.ended);
    },
    start: async (track, file, position) => {
      const queueId = tracksRef.current.find(t => t.url === file.url)?.id ?? file.url;
      setFollowMeta({ id: queueId, name: track.name, artist: track.artist, albumArt: track.albumArt });
      const started = await loadTrack({ id: queueId, name: track.name, artist: track.artist, albumArt: track.albumArt, url: file.url, source: 'spotify-matched' }, position);
      const audio = engineRef.current?.getAudioElement();
      if (started && audio && Number.isFinite(audio.duration) && track.durationMs > 0 &&
          (position >= audio.duration || Math.abs(audio.duration - track.durationMs / 1000) > Math.max(10, track.durationMs / 1000 * 0.05))) {
        if (audio.src === file.url) audio.pause();
        return { started: false, mismatch: true };
      }
      return { started };
    },
    stop: file => { const audio = engineRef.current?.getAudioElement(); if (audio?.src === file.url) audio.pause(); },
    readSpotify: fetchCurrentlyPlaying,
    pauseSpotify: pauseSpotifyPlayback,
    requestFile: track => requestCloudTrackRef.current(track.name),
    report: setHandoffStatus,
  }), [loadTrack]);

  const toggleFollow = (on: boolean) => {
    if (on && !hasScopes(FOLLOW_SCOPES)) {
      notify('Autorize o Aether a acompanhar a reprodução do Spotify.');
      localStorage.setItem('aether_follow_spotify', '1');
      loginWithSpotify();
      return;
    }
    if (!on) setSpotifyNow(null);
    setFollowSpotify(on);
  };

  const resumeHandoff = () => { if (spotifyToken) void handoff.retry(spotifyToken); };

  // DJ ao vivo: reads what Spotify is playing to time transitions and show the song. Never hands off.
  useEffect(() => {
    if (!liveSource || !spotifyToken || !hasScopes(['user-read-currently-playing'])) { setLiveNow(null); return; }
    let cancelled = false; let busy = false; let lastId: string | null = null;
    const poll = async () => {
      if (busy || cancelled) return;
      busy = true;
      try {
        const now = await fetchCurrentlyPlaying(spotifyToken);
        if (cancelled) return;
        setLiveNow(now);
        const engine = engineRef.current;
        if (!now || !engine) return;
        if (lastId && now.id !== lastId) engine.djTrackChange();
        lastId = now.id;
        const left = (now.durationMs - now.progressMs) / 1000;
        if (now.isPlaying && left > 0 && left <= 9) engine.djOutro(left);
      } catch { /* The DJ keeps working from the audio alone. */ } finally { busy = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [liveSource, spotifyToken]);

  useEffect(() => {
    handoff.reset();
    if (liveSource) { handoff.cancel(); return; } // Live: Spotify keeps playing; never take over.
    if (!followSpotify || !spotifyToken) {
      handoff.cancel(); setHandoffStatus({ phase: 'idle', message: '' });
      return;
    }
    let cancelled = false;
    let busy = false;
    const poll = async () => {
      if (busy || cancelled) return;
      busy = true;
      try {
        const now = await fetchCurrentlyPlaying(spotifyToken);
        if (!cancelled) { setSpotifyNow(now); await handoff.handle(now, spotifyToken); }
      } catch (error) {
        if (!cancelled && !isSpotifySessionSaved()) {
          notifyRef.current(error instanceof Error ? error.message : 'Falha ao ler o Spotify.');
          setFollowSpotify(false); setSpotifyToken(null);
        }
      } finally { busy = false; }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void poll(); };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      cancelled = true; handoff.cancel(); window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pageshow', onVisible);
    };
  }, [followSpotify, spotifyToken, handoff, setFollowSpotify, liveSource]);

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
    if (!currentId && !followSpotify) {
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
    if (!accountIdentityRef.current) setCloudUrl(raw);
    setCloudUrlState(raw.trim());
    await requestPersistentStorage();
    lastSyncRef.current = 0;
    syncCloud(raw.trim());
    return true;
  };

  const disconnectCloud = () => {
    if (!accountIdentityRef.current) clearCloudUrl();
    setCloudUrlState(null);
    setCloudStatus({ phase: 'idle', cloudCount: 0, total: 0, done: 0 });
    notify('Nuvem desconectada. As músicas já baixadas continuam no aparelho.');
  };

  requestCloudTrackRef.current = name => {
    if (!cloudUrl) return;
    const wanted = normalizeText(name);
    wantedRef.current = [wanted, ...wantedRef.current.filter(item => item !== wanted)];
    void syncCloud(cloudUrl);
  };

  const playDemo = async () => {
    let url = demoUrl;
    if (!url) {
      url = await createDemoTrackUrl();
      setDemoUrl(url);
    }
    loadTrack({ id: 'demo', name: 'Aether · Demonstração', artist: 'Faixa de demonstração', url, source: 'demo' });
  };

  // Keep volume, playback and OAuth credentials local to each device.

  const accountSettings: AccountSettings = {
    sound: JSON.stringify({ modeId: preferredModeId, djIntensity, gains: eqGains, preset: activePreset, room: roomType, mix: reverbMix,
      spatial: spatialEnabled, night: nightMode, orbit: autoOrbit, speed: orbitSpeed, adaptive: adaptiveEnabled, adaptiveIntensity,
      surround: surroundEnabled, surroundAmount, voiceFocus, bassPunch, autoMix, djTransitions, position: pos, elevation }),
    customModes: JSON.stringify(customModes), spotify: JSON.stringify({ playlistId: selectedPlaylist, refreshRevision: spotifyRefreshRevision }), cloudUrl: cloudUrl ?? '',
  };
  const applyAccountSettings = (patch: SettingsPatch) => {
    if (patch.sound !== undefined) {
      const sound = parseSound(patch.sound);
      setPreferredModeId(sound.modeId ?? '');
      if (sound.djIntensity !== undefined) setDjIntensity(sound.djIntensity);
      setEqGains(sound.gains); setActivePreset(sound.preset); setRoomType(sound.room); setReverbMix(sound.mix);
      const adaptive = sound.adaptive ?? (sound.orbit || sound.modeId === 'immersive' || sound.modeId === 'dj');
      const intensity = sound.adaptiveIntensity ?? sound.djIntensity ?? 65;
      setSpatialEnabled(sound.spatial); setNightMode(sound.night);
      setAdaptiveEnabled(adaptive); setAdaptiveIntensity(intensity);
      engineRef.current?.setAdaptiveEnabled(adaptive); engineRef.current?.setAdaptiveIntensity(intensity);
      changeSurround(sound.surround ?? false); changeSurroundAmount(sound.surroundAmount ?? 70); changeVoiceFocus(sound.voiceFocus ?? 70); changeBassPunch(sound.bassPunch ?? 30); changeAutoMix(sound.autoMix ?? true); changeDjTransitions(sound.djTransitions ?? true);
      setPos(sound.position); setElevation(sound.elevation);
      const engine = engineRef.current;
      engine?.applyPreset(sound.gains); engine?.setRoomType(sound.room); engine?.setReverbMix(sound.mix);
      engine?.setSpatialEnabled(sound.spatial); engine?.setNightMode(sound.night);
    }
    if (patch.customModes !== undefined) setCustomModes(parseModes(patch.customModes));
    if (patch.spotify !== undefined) {
      const spotify = parseSpotify(patch.spotify);
      setSelectedPlaylist(spotify.playlistId);
      setSpotifyRefreshRevision(spotify.refreshRevision);
      if (spotify.refreshRevision && spotify.refreshRevision !== spotifyRefreshRevision && spotifyToken) {
        void syncPlaylists(spotifyToken, true);
      }
    }
    if (patch.cloudUrl !== undefined && patch.cloudUrl !== (cloudUrl ?? '')) {
      setCloudUrlState(patch.cloudUrl || null);
      lastSyncRef.current = 0;
      setCloudStatus({ phase: 'idle', cloudCount: 0, total: 0, done: 0 });
    }
  };
  const account = useAccount(accountSettings, applyAccountSettings);
  accountIdentityRef.current = account.user?.uid ?? null;

  const readAdaptiveAnalysis = useCallback(() => engineRef.current?.getAdaptiveAnalysis() ?? null, []);
  const readSurroundAnalysis = useCallback(() => engineRef.current?.getSurroundAnalysis() ?? null, []);
  const playerTrack: PlayableTrack | undefined = liveSource
    ? liveNow ? { id: 'live', name: liveNow.name, artist: `${liveNow.artist} · ao vivo`, albumArt: liveNow.albumArt, source: 'local' } : { id: 'live', name: 'Ao vivo', artist: liveSource.label, source: 'local' }
    : currentTrack;
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
      onSync={() => {
        if (!spotifyToken) return;
        setSpotifyRefreshRevision(crypto.randomUUID());
        void syncPlaylists(spotifyToken);
      }}
      following={followSpotify}
      onFollow={toggleFollow}
      spotifyNow={spotifyNow}
      handoffStatus={handoffStatus}
      onResumeHandoff={resumeHandoff}
      onLogout={disconnectSpotify}
      onImport={() => fileInputRef.current?.click()}
      onDemo={playDemo}
      onSelectPlaylist={(id) => spotifyToken && selectPlaylist(id, spotifyToken)}
      onPlayTrack={(i) => loadTrack(tracks[i])}
      onRemoveTrack={removeLocal}
      live={
        <LivePanel
          liveLabel={liveSource?.label ?? null}
          spotifyLinked={Boolean(spotifyToken) && hasScopes(['user-read-currently-playing'])}
          busy={liveBusy}
          error={liveError}
          onTab={() => void startLive(captureTab)}
          onDevice={device => void startLive(() => captureDevice(device))}
          onStop={stopLive}
        />
      }
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
            <AccountPanel account={account} />
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
                <button key={mode.id} onClick={() => applyListeningMode(mode.id === 'dj' ? createDjMode(djIntensity) : mode)} aria-pressed={activeMode?.id === mode.id}
                  className={`min-h-11 text-xs font-medium transition-colors ${activeMode?.id === mode.id ? 'mode-selected' : 'text-ink-muted hover:text-ink'}`}>
                  {mode.name}
                </button>
              ))}
            </div>
            {(preferredModeId === 'dj' || activeMode?.djIntensity !== undefined) && <DjLevels intensity={djIntensity} onIntensity={value => applyListeningMode(createDjMode(value), false)} />}
            <div className="flex justify-end mt-2"><button onClick={() => setCustomizing(true)} className="text-xs font-medium text-accent underline underline-offset-4">Personalizar</button></div>
            {customModes.length > 0 && <div className="mt-3 border-t border-line-strong pt-3">
              <h3 className="text-xs text-ink-muted mb-2">Meus modos</h3>
              <ul className="space-y-1">{customModes.map(mode => <li key={mode.id} className="flex items-center gap-2">
                <button onClick={() => applyListeningMode(mode.id === 'dj' ? createDjMode(djIntensity) : mode)} aria-pressed={activeMode?.id === mode.id} className={`flex-1 min-w-0 text-left text-sm px-3 rounded-md truncate ${activeMode?.id === mode.id ? 'bg-raised text-accent' : 'text-ink-muted'}`}>{mode.name}</button>
                <button onClick={() => removeCustomMode(mode.id)} aria-label={`Excluir modo ${mode.name}`} className="text-xs text-ink-muted px-2">Excluir</button>
              </li>)}</ul>
            </div>}
            <p className="text-xs text-ink-muted leading-relaxed mt-3 min-h-9">{activeMode?.description ?? 'Ajuste manual. Selecione um modo para restaurar a configuração.'}</p>
          </section>
          <section className="stage-panel px-5 pb-5 sm:px-7 flex-1 flex flex-col">
            <PanelHeader
              icon={<Orbit className="w-4 h-4" />}
              title={surroundEnabled ? 'Cinema 7.1 virtual' : adaptiveEnabled ? 'Imersão adaptativa' : 'Posicionamento manual'}
            />

            <div className="flex items-center justify-between mt-4 mb-2 gap-3 text-xs text-ink-muted">
              <span>Processamento espacial</span>
              <Toggle checked={spatialEnabled} onChange={(enabled) => { setSpatialEnabled(enabled); engineRef.current?.setSpatialEnabled(enabled); }} label="Processamento espacial" />
            </div>
            <div className="flex items-center justify-between gap-3 mt-3 text-xs text-ink-muted"><span>Cinema 7.1 virtual</span><Toggle checked={surroundEnabled} onChange={changeSurround} label="Cinema 7.1 virtual" /></div>
            {!surroundEnabled && <div className="flex items-center justify-between gap-3 mt-3 text-xs text-ink-muted"><span>Adaptar à música</span><Toggle checked={adaptiveEnabled} onChange={enabled => { setAdaptiveEnabled(enabled); engineRef.current?.setAdaptiveEnabled(enabled); }} label="Adaptar à música" /></div>}
            {surroundEnabled ? <SurroundStage readAnalysis={readSurroundAnalysis} playing={isPlaying} enabled={spatialEnabled} amount={surroundAmount} focus={voiceFocus} punch={bassPunch} onAmount={changeSurroundAmount} onFocus={changeVoiceFocus} onPunch={changeBassPunch} autoMix={autoMix} onAutoMix={changeAutoMix} transitions={djTransitions} onTransitions={changeDjTransitions} /> : adaptiveEnabled ? <AdaptiveStage readAnalysis={readAdaptiveAnalysis} playing={isPlaying} enabled={spatialEnabled} intensity={adaptiveIntensity} onIntensity={value => { setAdaptiveIntensity(value); engineRef.current?.setAdaptiveIntensity(value); }} /> : <>
            <div inert={!spatialEnabled} className={`flex-1 grid place-items-center py-2 ${spatialEnabled ? '' : 'opacity-35'}`}>
              <SpatialStage
                pos={pos}
                onMove={(p) => {
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

            </div>
            </details>
            </>}
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
        track={playerTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        canPlay={Boolean(liveSource) || tracks.some((t) => t.url)}
        onToggle={togglePlay}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onSeek={seek}
        onVolume={changeVolume}
      />

      {customizing && <CustomizeSound onClose={() => setCustomizing(false)} onSave={saveCurrentMode}
        gains={eqGains} activePreset={activePreset} onPreset={selectPreset} onBand={changeBand}
        room={roomType} mix={reverbMix} onRoom={changeRoom} onMix={changeMix}
        spatial={spatialEnabled} night={nightMode} adaptive={adaptiveEnabled} adaptiveIntensity={adaptiveIntensity}
        surround={surroundEnabled} surroundAmount={surroundAmount} voiceFocus={voiceFocus}
        onSurround={changeSurround} onSurroundAmount={changeSurroundAmount} onVoiceFocus={changeVoiceFocus}
        bassPunch={bassPunch} onBassPunch={changeBassPunch}
        onSpatial={enabled => { setSpatialEnabled(enabled); engineRef.current?.setSpatialEnabled(enabled); }}
        onNight={enabled => { setNightMode(enabled); engineRef.current?.setNightMode(enabled); }}
        onAdaptive={enabled => { setAdaptiveEnabled(enabled); engineRef.current?.setAdaptiveEnabled(enabled); }}
        onAdaptiveIntensity={value => { setAdaptiveIntensity(value); engineRef.current?.setAdaptiveIntensity(value); }}
        position={pos} onPosition={setPos} elevation={elevation} onElevation={setElevation}
        />}

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
