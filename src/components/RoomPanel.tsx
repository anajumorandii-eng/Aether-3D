import { Church, Mic2, Sparkles, Theater, VolumeX } from 'lucide-react';
import type { RoomType } from '../audio/AudioEngine';
import { Field, PanelHeader, Range } from './ui';

const ROOMS: { id: RoomType; label: string; detail: string; Icon: typeof Mic2 }[] = [
  { id: 'off', label: 'Seco', detail: 'Sem reverb', Icon: VolumeX },
  { id: 'studio', label: 'Estúdio', detail: 'RT 0,8 s', Icon: Mic2 },
  { id: 'hall', label: 'Teatro', detail: 'RT 2,1 s', Icon: Theater },
  { id: 'cathedral', label: 'Catedral', detail: 'RT 3,6 s', Icon: Church },
];

interface Props {
  room: RoomType;
  mix: number;
  onRoom: (r: RoomType) => void;
  onMix: (v: number) => void;
}

export function RoomPanel({ room, mix, onRoom, onMix }: Props) {
  return (
    <section className="panel p-5">
      <PanelHeader
        icon={<Sparkles className="w-4 h-4" />}
        title="Acústica de ambiente"
        aside={<span className="font-mono text-[11px] text-ink-muted tnum">{Math.round(mix * 100)}% wet</span>}
      />
      <div className="grid grid-cols-4 gap-2 mb-4">
        {ROOMS.map(({ id, label, detail, Icon }) => {
          const active = room === id;
          return (
            <button
              key={id}
              onClick={() => onRoom(id)}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1.5 rounded-md border px-1 py-3 transition ${
                active
                  ? 'bg-accent-wash border-accent/60 text-ink'
                  : 'bg-sunken/70 border-line text-ink-muted hover:text-ink hover:border-line-strong'
              }`}
            >
              <Icon className={`w-4 h-4 ${active ? 'text-accent' : ''}`} />
              <span className="text-xs font-medium">{label}</span>
              <span className="text-[10px] text-ink-faint">{detail}</span>
            </button>
          );
        })}
      </div>
      <Field label="Mistura de reverb" value={`${Math.round(mix * 100)}%`}>
        <Range label="Mistura de reverb" min={0} max={0.8} step={0.02} value={mix} onChange={onMix} disabled={room === 'off'} />
      </Field>
    </section>
  );
}
