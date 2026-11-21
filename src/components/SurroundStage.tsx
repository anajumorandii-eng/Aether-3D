import { useEffect, useState } from 'react';
import { SPEAKERS, type SurroundAnalysis } from '../audio/VirtualSurround';
import { Range, Toggle } from './ui';

/** Cinema 7.1: seven virtual speakers around the head, the voice isolated in front. */
export function SurroundStage({ readAnalysis, playing, enabled, amount, focus, punch, onAmount, onFocus, onPunch, autoMix, onAutoMix, transitions, onTransitions }: {
  readAnalysis: () => SurroundAnalysis | null; playing: boolean; enabled: boolean;
  amount: number; focus: number; punch: number; onAmount: (value: number) => void; onFocus: (value: number) => void; onPunch: (value: number) => void;
  autoMix: boolean; onAutoMix: (enabled: boolean) => void; transitions: boolean; onTransitions: (enabled: boolean) => void;
}) {
  const [analysis, setAnalysis] = useState<SurroundAnalysis | null>(null);
  useEffect(() => { const read = () => setAnalysis(readAnalysis()); read(); const timer = window.setInterval(read, 400); return () => clearInterval(timer); }, [readAnalysis]);
  const unavailable = analysis?.status === 'error' || analysis?.status === 'unsupported';
  const measured = enabled && playing && analysis?.status === 'ready' && analysis.frames > 0;
  // Speaker brightness follows how much of the music each group is receiving.
  const level = (id: string) => !measured ? 0.35 : id === 'C' ? 0.35 + Math.min(0.65, analysis.center * 1.6) : id.startsWith('F') ? 0.75 : 0.35 + Math.min(0.65, analysis.ambience * 2.2);
  return <div className="py-5">
    <div className="relative h-44 border-y border-line-strong overflow-hidden" aria-hidden="true">
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-line-strong" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-ink-faint" />
      {SPEAKERS.map(s => {
        const rad = (s.azimuth * Math.PI) / 180;
        return <span key={s.id} className="absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] text-accent transition-opacity duration-500"
          style={{ left: `calc(50% + ${Math.sin(rad) * 70}px)`, top: `calc(50% - ${Math.cos(rad) * 62}px)`, opacity: level(s.id) }}>{s.id}</span>;
      })}
    </div>
    <p role="status" className="text-sm text-ink-muted leading-relaxed mt-4">{unavailable ? 'O Cinema 7.1 não está disponível neste navegador. O áudio está sendo preservado em estéreo.' : !enabled ? 'Efeito desligado. Reprodução em estéreo.' : !playing ? 'Inicie uma música para separar voz e ambiência.' : !measured ? 'Separando voz e ambiência…' : 'Voz perto, à frente. Ambiência nas laterais e atrás.'}</p>
    {measured && <dl className="grid grid-cols-2 gap-4 text-xs mt-4"><div><dt className="text-ink-muted">Voz no centro</dt><dd className="font-mono text-ink mt-1">{Math.round(analysis.center * 100)}%</dd></div><div><dt className="text-ink-muted">Ambiência ao redor</dt><dd className="font-mono text-ink mt-1">{Math.round(analysis.ambience * 100)}%</dd></div></dl>}
    <div className="mt-5"><div className="flex justify-between gap-3 text-xs text-ink-muted mb-2"><span>Voz à frente</span><span>{focus}%</span></div><Range label="Voz à frente" min={0} max={100} step={1} value={focus} onChange={onFocus} disabled={!enabled || unavailable} /></div>
    <div className="mt-4"><div className="flex justify-between gap-3 text-xs text-ink-muted mb-2"><span>Envolvimento</span><span>{amount}%</span></div><Range label="Envolvimento" min={0} max={100} step={1} value={amount} onChange={onAmount} disabled={!enabled || unavailable} /></div>
    <div className="mt-4"><div className="flex justify-between gap-3 text-xs text-ink-muted mb-2"><span>Impacto dos graves</span><span>{punch}%</span></div><Range label="Impacto dos graves" min={0} max={100} step={1} value={punch} onChange={onPunch} disabled={!enabled || unavailable} /></div>
    <div className="mt-5 border-t border-line-strong pt-4 space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-muted"><span>DJ ao vivo: mixar cada música</span><Toggle checked={autoMix} onChange={onAutoMix} label="DJ ao vivo: mixar cada música" /></div>
      <div className="flex items-center justify-between gap-3 text-xs text-ink-muted"><span>Transições de DJ</span><Toggle checked={transitions} onChange={onTransitions} label="Transições de DJ" /></div>
      {autoMix && measured && analysis.offsets && <p className="text-xs text-ink-muted">Nesta música: <span className="font-mono text-ink">{[['Voz', analysis.offsets.focus], ['Envolvimento', analysis.offsets.amount], ['Graves', analysis.offsets.punch]].map(([label, v]) => `${label} ${Number(v) >= 0 ? '+' : '−'}${Math.abs(Math.round(Number(v) * 100))}`).join(' · ')}</span></p>}
      <p className="text-[11px] text-ink-muted leading-relaxed">Cada música recebe sua própria mixagem, a partir dos seus ajustes acima. Nas trocas, o filtro abre a partir dos graves e o fim da música anterior ecoa.</p>
    </div>
    <p className="text-[11px] text-ink-muted leading-relaxed mt-3">Separa a mixagem estéreo em 7 alto-falantes virtuais com HRTF, como um home theater nos fones. Não reconstrói uma mixagem Dolby Atmos original.</p>
  </div>;
}
