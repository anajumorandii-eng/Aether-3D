import { EQ_PRESETS, type RoomType } from './AudioEngine';

export interface ListeningMode {
  id: string;
  name: string;
  description: string;
  eq: (typeof EQ_PRESETS)[number];
  room: RoomType;
  mix: number;
  orbit: boolean;
  speed: number;
  position: { x: number; z: number };
  elevation: number;
  spatial: boolean;
  night: boolean;
  djIntensity?: number;
  adaptive?: boolean;
  adaptiveIntensity?: number;
  /** Cinema 7.1: stereo split into seven virtual HRTF speakers. */
  surround?: boolean;
  surroundAmount?: number;
  voiceFocus?: number;
  bassPunch?: number;
  /** Passeio 8D: instruments and ambience circle the head, the voice stays in front. */
  walk8d?: boolean;
  walkSpeed?: number;
}

const base = { room: 'off' as RoomType, mix: 0, orbit: false, speed: 0.35, position: { x: 0, z: -0.35 }, elevation: 0, spatial: false, night: false };

export const DJ_LEVELS = [
  { name: 'Suave', intensity: 25 },
  { name: 'Intenso', intensity: 65 },
  { name: 'Máximo', intensity: 100 },
] as const;

export function createDjMode(value: number): ListeningMode {
  const intensity = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 65;
  const strength = intensity / 100;
  return {
    ...base, id: 'dj', name: 'DJ 3D', djIntensity: intensity,
    description: 'Imersão completa: voz colada em você, graves com impacto e a pista em 7 alto-falantes virtuais ao redor.',
    eq: { name: `DJ 3D · ${intensity}%`, gains: [5,4,2,-1,-1,0,1,2,2,1].map(gain => Math.round(gain * strength * 10) / 10) },
    room: 'hall', mix: Number((0.28 * strength).toFixed(3)),
    spatial: true, adaptive: true, adaptiveIntensity: intensity, orbit: false,
    surround: true, surroundAmount: Math.round(55 + 0.45 * intensity), voiceFocus: Math.round(70 + 0.3 * intensity), bassPunch: intensity,
    walk8d: intensity >= 50, walkSpeed: Math.round(20 + 0.3 * intensity),
    position: { x: 0, z: -0.5 },
  };
}

// Profiles use this app's DSP; these are not Boom 3D's proprietary algorithms.
export const LISTENING_MODES: ListeningMode[] = [
  { ...base, id: 'cinema', name: 'Cinema 7.1', description: 'Voz isolada no centro, à frente. Ambiência em alto-falantes virtuais nas laterais e atrás.', eq: { name: 'Cinema 7.1', gains: [3, 2, 0, -1, 0, 0, 1, 1, 2, 1] }, room: 'studio', mix: 0.15, position: { x: 0, z: -0.7 }, spatial: true, adaptive: true, adaptiveIntensity: 65, surround: true, surroundAmount: 70, voiceFocus: 80, bassPunch: 30 },
  { ...base, id: 'immersive', name: 'Som 3D', description: 'Abertura e ambiência ajustadas ao estéreo, aos graves e à dinâmica da faixa.', eq: EQ_PRESETS[0], room: 'studio', mix: 0.2, orbit: false, position: { x: 0, z: -0.7 }, spatial: true, adaptive: true, adaptiveIntensity: 65 },
  { ...base, id: 'ambience', name: 'Ambiência', description: 'Reverberação de teatro para dar profundidade ao estéreo, sem órbita.', eq: EQ_PRESETS[0], room: 'hall', mix: 0.35 },
  { ...base, id: 'fidelity', name: 'Fidelidade', description: 'Realce moderado de presença e agudos para destacar detalhes.', eq: { name: 'Fidelidade', gains: [0, 0, -1, -1, 0, 1, 2, 2, 2, 1] } },
  { ...base, id: 'night', name: 'Noturno', description: 'Reduz picos de volume e graves para ouvir com menos variação de intensidade.', eq: { name: 'Noturno', gains: [-4, -3, -2, -1, 0, 1, 2, 1, 0, -1] }, night: true },
  { ...base, id: 'bass', name: 'Graves', description: 'Reforça baixas frequências, mantendo a reprodução em estéreo.', eq: EQ_PRESETS[2] },
  createDjMode(65),
  { ...base, id: 'natural', name: 'Natural', description: 'Estéreo com equalização neutra, sem reverberação nem espacialização.', eq: EQ_PRESETS[0] },
];

/** Upgrade old rotating presets without discarding a user's EQ or room settings. */
export function upgradeListeningMode(mode: ListeningMode): ListeningMode {
  return { ...mode, orbit: false, surround: mode.surround ?? false, surroundAmount: mode.surroundAmount ?? 70, voiceFocus: mode.voiceFocus ?? 70, bassPunch: mode.bassPunch ?? 30, walk8d: mode.walk8d ?? false, walkSpeed: mode.walkSpeed ?? 40, adaptive: mode.adaptive ?? (mode.orbit || mode.id === 'immersive' || mode.id === 'dj' || mode.djIntensity !== undefined), adaptiveIntensity: mode.adaptiveIntensity ?? mode.djIntensity ?? 65 };
}
