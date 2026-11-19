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
    ...base, id: 'dj', name: 'DJ', djIntensity: intensity,
    description: 'Graves, presença e ambiente com movimento ao redor da cabeça.',
    eq: { name: `DJ · ${intensity}%`, gains: [5,4,2,-1,-1,0,1,2,2,1].map(gain => Math.round(gain * strength * 10) / 10) },
    room: 'hall', mix: Number((0.4 * strength).toFixed(3)),
    spatial: true, orbit: intensity > 0, speed: Number((0.2 + strength * 0.8).toFixed(2)),
    position: { x: 0, z: -0.5 },
  };
}

// Profiles use this app's DSP; these are not Boom 3D's proprietary algorithms.
export const LISTENING_MODES: ListeningMode[] = [
  { ...base, id: 'immersive', name: 'Som 3D', description: 'Áudio binaural com movimento suave ao redor da cabeça. Use fones.', eq: EQ_PRESETS[1], room: 'studio', mix: 0.2, orbit: true, position: { x: 0, z: -0.7 }, spatial: true },
  { ...base, id: 'ambience', name: 'Ambiência', description: 'Reverberação de teatro para dar profundidade ao estéreo, sem órbita.', eq: EQ_PRESETS[0], room: 'hall', mix: 0.35 },
  { ...base, id: 'fidelity', name: 'Fidelidade', description: 'Realce moderado de presença e agudos para destacar detalhes.', eq: { name: 'Fidelidade', gains: [0, 0, -1, -1, 0, 1, 2, 2, 2, 1] } },
  { ...base, id: 'night', name: 'Noturno', description: 'Reduz picos de volume e graves para ouvir com menos variação de intensidade.', eq: { name: 'Noturno', gains: [-4, -3, -2, -1, 0, 1, 2, 1, 0, -1] }, night: true },
  { ...base, id: 'bass', name: 'Graves', description: 'Reforça baixas frequências, mantendo a reprodução em estéreo.', eq: EQ_PRESETS[2] },
  createDjMode(65),
  { ...base, id: 'natural', name: 'Natural', description: 'Estéreo com equalização neutra, sem reverberação nem espacialização.', eq: EQ_PRESETS[0] },
];
