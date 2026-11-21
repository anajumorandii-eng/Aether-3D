import { upgradeListeningMode, type ListeningMode } from '../audio/listeningModes';
import type { RoomType } from '../audio/AudioEngine';
import { validCustomMode, MAX_CUSTOM_MODES } from '../storage/listeningModes';
import { parseSasUrl } from '../cloud/BlobSync';

export interface SoundSettings {
  modeId?: string;
  djIntensity?: number;
  adaptive?: boolean;
  adaptiveIntensity?: number;
  surround?: boolean;
  surroundAmount?: number;
  voiceFocus?: number;
  bassPunch?: number;
  autoMix?: boolean;
  djTransitions?: boolean;
  gains: number[];
  preset: string;
  room: RoomType;
  mix: number;
  spatial: boolean;
  night: boolean;
  orbit: boolean;
  speed: number;
  position: { x: number; z: number };
  elevation: number;
}
export interface AccountSettings { sound: string; customModes: string; spotify: string; cloudUrl: string; }
export type SettingsPatch = Partial<AccountSettings>;
export const SETTINGS_KEYS = ['sound', 'customModes', 'spotify', 'cloudUrl'] as const;
const between = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function parseSound(raw: string): SoundSettings {
  const s = JSON.parse(raw) as SoundSettings;
  if (!s || (s.adaptive !== undefined && typeof s.adaptive !== 'boolean') || (s.adaptiveIntensity !== undefined && !between(s.adaptiveIntensity, 0, 100)) ||
    (s.surround !== undefined && typeof s.surround !== 'boolean') || (s.surroundAmount !== undefined && !between(s.surroundAmount, 0, 100)) || (s.voiceFocus !== undefined && !between(s.voiceFocus, 0, 100)) || (s.bassPunch !== undefined && !between(s.bassPunch, 0, 100)) ||
    (s.autoMix !== undefined && typeof s.autoMix !== 'boolean') || (s.djTransitions !== undefined && typeof s.djTransitions !== 'boolean') || (s.djIntensity !== undefined && !between(s.djIntensity, 0, 100)) || (s.modeId !== undefined && (typeof s.modeId !== 'string' || s.modeId.length > 100)) || !Array.isArray(s.gains) || s.gains.length !== 10 || !s.gains.every(g => between(g, -12, 12)) ||
    typeof s.preset !== 'string' || s.preset.length > 80 || !['off','studio','hall','cathedral'].includes(s.room) ||
    !between(s.mix, 0, 1) || !between(s.speed, 0.2, 2) || !between(s.elevation, -1, 1) ||
    !between(s.position?.x, -1, 1) || !between(s.position?.z, -1, 1) ||
    typeof s.spatial !== 'boolean' || typeof s.night !== 'boolean' || typeof s.orbit !== 'boolean' || (s.orbit && !s.spatial)) throw new Error('Ajustes inválidos na conta.');
  return s;
}
export function parseModes(raw: string): ListeningMode[] {
  const modes: unknown = JSON.parse(raw);
  if (!Array.isArray(modes) || modes.length > MAX_CUSTOM_MODES || !modes.every(validCustomMode)) throw new Error('Modos inválidos na conta.');
  return modes.map(upgradeListeningMode);
}
export function parseSpotify(raw: string): { playlistId: string; refreshRevision: string } {
  const parsed: unknown = JSON.parse(raw);
  const value = typeof parsed === 'string' ? { playlistId: parsed, refreshRevision: '' } : parsed as { playlistId: string; refreshRevision: string };
  if (!value || typeof value.playlistId !== 'string' || (value.playlistId !== 'liked-songs' && !/^[a-zA-Z0-9]{0,100}$/.test(value.playlistId)) ||
      typeof value.refreshRevision !== 'string' || value.refreshRevision.length > 80) throw new Error('Playlist inválida na conta.');
  return value;
}

export function validateSettings(value: unknown): AccountSettings {
  if (!value || typeof value !== 'object') throw new Error('Dados inválidos na conta.');
  const v = value as AccountSettings;
  for (const key of SETTINGS_KEYS) if (typeof v[key] !== 'string') throw new Error('Dados incompletos na conta.');
  if (v.sound.length > 4096 || v.customModes.length > 32768 || v.spotify.length > 256 || v.cloudUrl.length > 8192) throw new Error('Dados muito grandes na conta.');
  parseSound(v.sound); parseModes(v.customModes); parseSpotify(v.spotify);
  if (v.cloudUrl) parseSasUrl(v.cloudUrl);
  return Object.fromEntries(SETTINGS_KEYS.map(k => [k, v[k]])) as unknown as AccountSettings;
}

export function settingsDiff(before: AccountSettings, after: AccountSettings): SettingsPatch {
  return Object.fromEntries(SETTINGS_KEYS.filter(key => before[key] !== after[key]).map(key => [key, after[key]]));
}
