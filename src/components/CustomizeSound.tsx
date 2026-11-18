import { useEffect, useRef, useState } from 'react';
import type { RoomType } from '../audio/AudioEngine';
import { Equalizer } from './Equalizer';
import { RoomPanel } from './RoomPanel';
import { Field, Range, Toggle } from './ui';

interface Props {
  onClose: () => void;
  onSave: (name: string) => boolean;
  gains: number[];
  activePreset: string;
  onPreset: (name: string, gains: number[]) => void;
  onBand: (index: number, gain: number) => void;
  room: RoomType;
  mix: number;
  onRoom: (room: RoomType) => void;
  onMix: (mix: number) => void;
  spatial: boolean;
  night: boolean;
  orbit: boolean;
  onSpatial: (enabled: boolean) => void;
  onNight: (enabled: boolean) => void;
  onOrbit: (enabled: boolean) => void;
  position: { x: number; z: number };
  onPosition: (position: { x: number; z: number }) => void;
  elevation: number;
  onElevation: (value: number) => void;
  speed: number;
  onSpeed: (value: number) => void;
}

export function CustomizeSound(p: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} onCancel={p.onClose} onClose={p.onClose} aria-labelledby="customize-title"
      className="m-auto w-[min(640px,calc(100%-24px))] max-h-[90dvh] overflow-y-auto rounded-xl border border-line-strong bg-canvas text-ink p-0 backdrop:bg-black/70">
      <div className="sticky top-0 z-10 bg-canvas border-b border-line-strong px-5 py-3 flex items-center justify-between gap-4">
        <h2 id="customize-title" className="font-semibold">Personalizar som</h2>
        <button type="button" autoFocus onClick={p.onClose} className="text-sm text-ink-muted px-2">Concluir</button>
      </div>
      <div className="p-4 sm:p-5 space-y-4">
        <p className="text-sm text-ink-muted">As alterações são aplicadas enquanto você ouve. Salve para usar essa combinação depois.</p>
        <Equalizer gains={p.gains} activePreset={p.activePreset} onPreset={p.onPreset} onBand={p.onBand} />
        <RoomPanel room={p.room} mix={p.mix} onRoom={p.onRoom} onMix={p.onMix} />
        <section className="panel p-5 space-y-4" aria-label="Efeitos personalizados">
          {[
            ['Espacialização 3D', p.spatial, p.onSpatial],
            ['Órbita automática', p.orbit, p.onOrbit],
            ['Modo noturno', p.night, p.onNight],
          ].map(([label, checked, change]) => <div key={String(label)} className="flex justify-between items-center gap-3 text-sm"><span>{String(label)}</span><Toggle label={String(label)} checked={Boolean(checked)} onChange={change as (v: boolean) => void} /></div>)}
          <p className="text-xs text-ink-muted">O modo noturno comprime os picos. Desligar o 3D mantém o estéreo e desativa a órbita.</p>
          <Field label="Velocidade da órbita" value={`${p.speed.toFixed(1)}×`}><Range label="Velocidade personalizada" min={0.2} max={2} step={0.1} value={p.speed} onChange={p.onSpeed} disabled={!p.orbit} /></Field>
          <Field label="Posição lateral" value={p.position.x.toFixed(1)}><Range label="Posição lateral" min={-1} max={1} step={0.1} value={p.position.x} onChange={x => p.onPosition({ ...p.position, x })} disabled={!p.spatial || p.orbit} /></Field>
          <Field label="Frente / trás" value={p.position.z.toFixed(1)}><Range label="Frente / trás" min={-1} max={1} step={0.1} value={p.position.z} onChange={z => p.onPosition({ ...p.position, z })} disabled={!p.spatial || p.orbit} /></Field>
          <Field label="Elevação" value={p.elevation.toFixed(1)}><Range label="Elevação personalizada" min={-1} max={1} step={0.1} value={p.elevation} onChange={p.onElevation} disabled={!p.spatial} /></Field>
        </section>
        <form onSubmit={e => { e.preventDefault(); if (p.onSave(name.trim())) p.onClose(); else setSaveError(true); }} className="panel p-5 space-y-3">
          <label htmlFor="custom-mode-name" className="block text-sm font-medium">Salvar como meu modo</label>
          <input id="custom-mode-name" value={name} onChange={e => setName(e.target.value)} required maxLength={40} placeholder="Ex.: Meu som para estudar" className="w-full min-h-11 rounded-md border border-line-strong bg-sunken px-3 text-sm select-text" />
          <p className="text-xs text-ink-muted">Fica salvo neste navegador. Use o mesmo nome para atualizar um modo existente.</p>
          {saveError && <p role="alert" className="text-sm text-warn">Não foi possível salvar. Verifique se há espaço no navegador ou remova um modo salvo antes de tentar novamente.</p>}
          <button type="submit" disabled={!name.trim()} className="w-full min-h-11 rounded-md bg-raised border border-line-strong text-sm font-medium disabled:opacity-40">Salvar modo</button>
        </form>
      </div>
    </dialog>
  );
}
