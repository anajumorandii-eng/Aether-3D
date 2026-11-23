// Cole aqui o Client ID copiado do Spotify Developer Dashboard
export const SPOTIFY_CLIENT_ID = 'f6d326f9c3764b1bb0cd57034abb89ff';

const REDIRECT_URI = `${window.location.origin}/`;
const SCOPES = [
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

/** Permissões necessárias para o modo "Seguir o Spotify". */
export const FOLLOW_SCOPES = ['user-read-currently-playing', 'user-modify-playback-state'];

export function hasScopes(required: string[]): boolean {
  const granted = (localStorage.getItem('spotify_scope') ?? '').split(' ');
  return required.every((s) => granted.includes(s));
}

export interface SpotifyTrackItem {
  id: string;
  name: string;
  artist: string;
  albumArt?: string;
  previewUrl?: string | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  image?: string;
  tracksCount: number;
}

export const isSpotifyConfigured = () => !SPOTIFY_CLIENT_ID.startsWith('COLE_');

function generateRandomString(length: number): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], '');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return window.crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64encode(input: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Opens Spotify's login. Spotify skips its screen when the browser is already signed in, which
 * reconnects the same account; `chooseAccount` makes it show the screen (with "Not you?"), so another
 * account can be picked.
 */
export async function loginWithSpotify(options: { chooseAccount?: boolean } = {}) {
  const codeVerifier = generateRandomString(64);
  localStorage.setItem('spotify_code_verifier', codeVerifier);

  const codeChallenge = base64encode(await sha256(codeVerifier));

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    redirect_uri: REDIRECT_URI,
    ...(options.chooseAccount ? { show_dialog: 'true' } : {}),
  }).toString();

  window.location.href = authUrl.toString();
}

export async function handleSpotifyCallback(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const codeVerifier = localStorage.getItem('spotify_code_verifier');

  if (!code || !codeVerifier) {
    // Sessão salva: renova o token se ele já venceu, sem pedir login de novo.
    if (!localStorage.getItem('spotify_access_token')) return null;
    return getValidToken().catch(() => null);
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  const data = await response.json();
  if (data.access_token) {
    saveTokens(data);
    localStorage.removeItem('spotify_code_verifier');
    window.history.replaceState({}, document.title, '/');
    return data.access_token;
  }
  return null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

function saveTokens(data: TokenResponse) {
  localStorage.setItem('spotify_access_token', data.access_token);
  if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
  if (data.scope !== undefined) localStorage.setItem('spotify_scope', data.scope);
  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  localStorage.setItem('spotify_expires_at', String(expiresAt));
}

let refreshing: Promise<string> | null = null;

/** Troca o refresh token por um access token novo (o do Spotify dura 1 hora). */
async function refreshAccessToken(): Promise<string> {
  if (refreshing) return refreshing;
  const refreshToken = localStorage.getItem('spotify_refresh_token');
  if (!refreshToken) throw new Error('Sessão do Spotify expirada. Conecte novamente.');
  refreshing = (async () => {
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: SPOTIFY_CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.access_token) {
        // Só desconecta se o Spotify recusou o refresh token; erro de rede mantém a sessão.
        if (res.status === 400 || res.status === 401) logoutSpotify();
        throw new Error('Sessão do Spotify expirada. Conecte novamente.');
      }
      saveTokens(data);
      return data.access_token as string;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Token válido para usar agora, renovando automaticamente quando faltar menos de 1 min. */
export async function getValidToken(): Promise<string> {
  const token = localStorage.getItem('spotify_access_token');
  const expiresAt = Number(localStorage.getItem('spotify_expires_at') ?? 0);
  if (token && expiresAt - Date.now() > 60_000) return token;
  return refreshAccessToken();
}

export const isSpotifySessionSaved = () => Boolean(localStorage.getItem('spotify_access_token'));

export function logoutSpotify() {
  ['spotify_access_token', 'spotify_refresh_token', 'spotify_expires_at', 'spotify_scope'].forEach((k) =>
    localStorage.removeItem(k),
  );
}

// O parâmetro token é mantido por compatibilidade; o token usado é sempre o mais recente e válido.
async function spotifyFetch(endpoint: string, _token: string, method = 'GET', retried = false): Promise<any> {
  const token = await getValidToken();
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    if (!retried) {
      localStorage.setItem('spotify_expires_at', '0');
      return spotifyFetch(endpoint, _token, method, true);
    }
    logoutSpotify();
    throw new Error('Sessão do Spotify expirada. Conecte novamente.');
  }
  if (!res.ok) throw new Error(`Spotify respondeu ${res.status}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export interface SpotifyNowPlaying extends SpotifyTrackItem {
  progressMs: number;
  durationMs: number;
  isPlaying: boolean;
}

/** O que está tocando agora na conta (em qualquer aparelho). null se nada estiver tocando. */
export async function fetchCurrentlyPlaying(token: string): Promise<SpotifyNowPlaying | null> {
  const data = await spotifyFetch('/me/player/currently-playing', token);
  const item = data?.item;
  if (!item || data.currently_playing_type !== 'track') return null;
  return {
    id: String(item.id),
    name: String(item.name),
    artist: Array.isArray(item.artists)
      ? item.artists.map((a: { name: string }) => a.name).join(', ')
      : 'Artista desconhecido',
    albumArt: item.album?.images?.[0]?.url,
    previewUrl: item.preview_url ?? null,
    progressMs: Number(data.progress_ms ?? 0),
    durationMs: Number(item.duration_ms ?? 0),
    isPlaying: Boolean(data.is_playing),
  };
}

/** Pausa o Spotify (requer Premium). Retorna false se não foi possível. */
export async function pauseSpotifyPlayback(token: string): Promise<boolean> {
  try {
    await spotifyFetch('/me/player/pause', token, 'PUT');
    return true;
  } catch {
    return false;
  }
}

/** The connected account's name, to show which account the app is using. */
export async function fetchSpotifyProfile(token: string): Promise<{ name: string }> {
  const data = await spotifyFetch('/me', token);
  return { name: String(data?.display_name || data?.id || 'Conta do Spotify') };
}

export async function fetchUserPlaylists(token: string): Promise<SpotifyPlaylist[]> {
  const data = await spotifyFetch('/me/playlists?limit=30', token);
  const playlists: SpotifyPlaylist[] = [{ id: 'liked-songs', name: 'Músicas Curtidas', tracksCount: 50 }];

  for (const item of data.items ?? []) {
    if (!item) continue;
    playlists.push({
      id: item.id,
      name: item.name,
      image: item.images?.[0]?.url,
      tracksCount: item.items?.total ?? item.tracks?.total ?? 0,
    });
  }
  return playlists;
}

export async function fetchPlaylistTracks(
  playlistId: string,
  token: string,
): Promise<SpotifyTrackItem[]> {
  let data: { items?: Record<string, unknown>[] };
  if (playlistId === 'liked-songs') {
    data = await spotifyFetch('/me/tracks?limit=50', token);
  } else {
    // Development Mode usa /items; mantém /tracks como alternativa.
    try {
      data = await spotifyFetch(`/playlists/${playlistId}/items?limit=50`, token);
    } catch {
      data = await spotifyFetch(`/playlists/${playlistId}/tracks?limit=50`, token);
    }
  }
  if (!data.items) return [];

  return data.items
    .map((entry) => (entry.item ?? entry.track) as Record<string, unknown> | undefined)
    .filter((t): t is Record<string, unknown> => Boolean(t && t.id && t.name))
    .map((t) => {
      const artists = Array.isArray(t.artists)
        ? t.artists.map((a: { name: string }) => a.name).join(', ')
        : 'Artista desconhecido';
      const album = t.album as { images?: { url: string }[] } | undefined;
      return {
        id: String(t.id),
        name: String(t.name),
        artist: artists,
        albumArt: album?.images?.[0]?.url,
        previewUrl: (t.preview_url as string | null) || null,
      };
    });
}

export function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
