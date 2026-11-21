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
  adaptive: boolean;
  adaptiveIntensity: number;
  onSpatial: (enabled: boolean) => void;
  onNight: (enabled: boolean) => void;
  onAdaptive: (enabled: boolean) => void;
  onAdaptiveIntensity: (value: number) => void;
  surround: boolean;
  surroundAmount: number;
  voiceFocus: number;
  onSurround: (enabled: boolean) => void;
  onSurroundAmount: (value: number) => void;
  onVoiceFocus: (value: number) => void;
  bassPunch: number;
  onBassPunch: (value: number) => void;
  walk: boolean;
  onWalk: (enabled: boolean) => void;
  walkSpeed: number;
  onWalkSpeed: (value: number) => void;
  walkDepth: number;
  onWalkDepth: (value: number) => void;
  position: { x: number; z: number };
  onPosition: (position: { x: number; z: number }) => void;
  elevation: number;
  onElevation: (value: number) => void;

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
            ['Processamento espacial', p.spatial, p.onSpatial],
            ['Cinema 7.1 virtual', p.surround, p.onSurround],
            ['Passeio 8D', p.walk, p.onWalk],
            ['Adaptar à música', p.adaptive, p.onAdaptive],
            ['Modo noturno', p.night, p.onNight],
          ].map(([label, checked, change]) => <div key={String(label)} className="flex justify-between items-center gap-3 text-sm"><span>{String(label)}</span><Toggle label={String(label)} checked={Boolean(checked)} onChange={change as (v: boolean) => void} /></div>)}
          <p className="text-xs text-ink-muted">O modo noturno comprime os picos. Desligar o 3D mantém o estéreo. A adaptação preserva o centro da mixagem, sem rotação. O Cinema 7.1 tem prioridade sobre a adaptação e o posicionamento manual.</p>
          <Field label="Voz à frente" value={`${p.voiceFocus}%`}><Range label="Voz à frente personalizada" min={0} max={100} step={1} value={p.voiceFocus} onChange={p.onVoiceFocus} disabled={!p.spatial || !p.surround} /></Field>
          <Field label="Impacto dos graves" value={`${p.bassPunch}%`}><Range label="Impacto dos graves personalizado" min={0} max={100} step={1} value={p.bassPunch} onChange={p.onBassPunch} disabled={!p.spatial || !p.surround} /></Field>
          <Field label="Imersão do 8D" value={`${p.walkDepth}%`}><Range label="Imersão do 8D personalizada" min={0} max={100} step={1} value={p.walkDepth} onChange={p.onWalkDepth} disabled={!p.spatial || !p.surround || !p.walk} /></Field>
          <Field label="Velocidade do passeio 8D" value={`${p.walkSpeed}%`}><Range label="Velocidade do passeio personalizada" min={0} max={100} step={1} value={p.walkSpeed} onChange={p.onWalkSpeed} disabled={!p.spatial || !p.surround || !p.walk} /></Field>
          <Field label="Envolvimento" value={`${p.surroundAmount}%`}><Range label="Envolvimento personalizado" min={0} max={100} step={1} value={p.surroundAmount} onChange={p.onSurroundAmount} disabled={!p.spatial || !p.surround} /></Field>
          <Field label="Intensidade da adaptação" value={`${p.adaptiveIntensity}%`}><Range label="Intensidade adaptativa personalizada" min={0} max={100} step={1} value={p.adaptiveIntensity} onChange={p.onAdaptiveIntensity} disabled={!p.spatial || p.surround || !p.adaptive} /></Field>
          <Field label="Posição lateral" value={p.position.x.toFixed(1)}><Range label="Posição lateral" min={-1} max={1} step={0.1} value={p.position.x} onChange={x => p.onPosition({ ...p.position, x })} disabled={!p.spatial || p.surround || p.adaptive} /></Field>
          <Field label="Frente / trás" value={p.position.z.toFixed(1)}><Range label="Frente / trás" min={-1} max={1} step={0.1} value={p.position.z} onChange={z => p.onPosition({ ...p.position, z })} disabled={!p.spatial || p.surround || p.adaptive} /></Field>
          <Field label="Elevação" value={p.elevation.toFixed(1)}><Range label="Elevação personalizada" min={-1} max={1} step={0.1} value={p.elevation} onChange={p.onElevation} disabled={!p.spatial || p.surround || p.adaptive} /></Field>
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
