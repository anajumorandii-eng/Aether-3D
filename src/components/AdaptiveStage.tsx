import { useEffect, useState } from 'react';
import type { ImmersionAnalysis } from '../audio/AdaptiveImmersion';
import { Range } from './ui';

export function AdaptiveStage({ readAnalysis, playing, enabled, intensity, onIntensity }: {
  readAnalysis: () => ImmersionAnalysis | null; playing: boolean; enabled: boolean;
  intensity: number; onIntensity: (value: number) => void;
}) {
  const [analysis, setAnalysis] = useState<ImmersionAnalysis | null>(null);
  useEffect(() => { const read = () => setAnalysis(readAnalysis()); read(); const timer = window.setInterval(read, 400); return () => clearInterval(timer); }, [readAnalysis]);
  const unavailable = analysis?.status === 'error' || analysis?.status === 'unsupported';
  const measured = enabled && playing && analysis?.status === 'ready' && analysis.frames > 0;
  return <div className="py-5">
    <div className="relative h-32 border-y border-line-strong flex items-center justify-between px-5 overflow-hidden" aria-hidden="true">
      <span className="text-xs text-ink-muted">E</span>
      <div className="absolute inset-x-12 top-1/2 border-t border-line-strong" style={{ transform: `scaleX(${measured ? Math.min(1, (analysis.width - 0.5) / 1.2) : 0.5})`, transition: 'transform 0.6s ease' }} />
      <div className="relative bg-surface px-4 text-center"><div className="font-medium text-sm text-ink">Centro preservado</div><div className="text-[11px] text-ink-muted mt-1">Estéreo adaptativo</div></div>
      <span className="text-xs text-ink-muted">D</span>
    </div>
    <p role="status" className="text-sm text-ink-muted leading-relaxed mt-4">{unavailable ? 'A adaptação não está disponível neste navegador. O áudio está sendo preservado em estéreo.' : !enabled ? 'Efeito desligado. Reprodução em estéreo.' : !playing ? 'Inicie uma música para analisar sua mixagem.' : !measured ? 'Analisando o áudio da faixa…' : 'A abertura e a ambiência acompanham o áudio, sem girar a fonte sonora.'}</p>
    {measured && <dl className="grid grid-cols-2 gap-4 text-xs mt-4"><div><dt className="text-ink-muted">Abertura estéreo</dt><dd className="font-mono text-ink mt-1">{Math.round(analysis.width * 100)}%</dd></div><div><dt className="text-ink-muted">Reflexões adaptativas</dt><dd className="font-mono text-ink mt-1">{Math.round(analysis.depth * 100)}%</dd></div></dl>}
    <div className="mt-5"><div className="flex justify-between gap-3 text-xs text-ink-muted mb-2"><span>Intensidade da adaptação</span><span>{intensity}%</span></div><Range label="Intensidade da adaptação" min={0} max={100} step={1} value={intensity} onChange={onIntensity} disabled={!enabled || unavailable} /></div>
    <p className="text-[11px] text-ink-muted leading-relaxed mt-3">A análise mede o sinal estéreo, os graves e a dinâmica. Não separa voz e instrumentos nem reconstrói uma mixagem Atmos.</p>
  </div>;
}
