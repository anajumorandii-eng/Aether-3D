import { upgradeListeningMode, type ListeningMode } from '../audio/listeningModes';

const KEY = 'aether_custom_modes_v1';
export const MAX_CUSTOM_MODES = 12;
const between = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function validCustomMode(v: unknown): v is ListeningMode {
  if (!v || typeof v !== 'object') return false;
  const m = v as ListeningMode;
  return typeof m.id === 'string' && m.id.startsWith('custom-') &&
    typeof m.name === 'string' && m.name.trim().length > 0 && m.name.length <= 40 &&
    typeof m.description === 'string' && m.description.length <= 160 &&
    typeof m.eq?.name === 'string' && Array.isArray(m.eq.gains) && m.eq.gains.length === 10 &&
    m.eq.gains.every(g => between(g, -12, 12)) && ['off', 'studio', 'hall', 'cathedral'].includes(m.room) &&
    between(m.mix, 0, 1) && between(m.speed, 0.2, 2) && between(m.elevation, -1, 1) &&
    between(m.position?.x, -1, 1) && between(m.position?.z, -1, 1) &&
    typeof m.orbit === 'boolean' && typeof m.spatial === 'boolean' && typeof m.night === 'boolean' &&
    (!m.orbit || m.spatial) && (m.djIntensity === undefined || between(m.djIntensity, 0, 100)) &&
    (m.adaptive === undefined || typeof m.adaptive === 'boolean') && (m.adaptiveIntensity === undefined || between(m.adaptiveIntensity, 0, 100)) &&
    (m.surround === undefined || typeof m.surround === 'boolean') && (m.surroundAmount === undefined || between(m.surroundAmount, 0, 100)) &&
    (m.voiceFocus === undefined || between(m.voiceFocus, 0, 100));
}

export function loadCustomModes(): ListeningMode[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(validCustomMode).slice(0, MAX_CUSTOM_MODES).map(upgradeListeningMode) : [];
  } catch { return []; }
}

export function saveCustomModes(modes: ListeningMode[], uid?: string) {
  localStorage.setItem(uid ? `${KEY}_${uid}` : KEY, JSON.stringify(modes));
}
