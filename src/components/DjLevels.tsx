import { DJ_LEVELS } from '../audio/listeningModes';
import { Range } from './ui';

export function DjLevels({ intensity, onIntensity }: { intensity: number; onIntensity: (value: number) => void }) {
  return <section aria-labelledby="dj-levels-title" className="mt-4 border-t border-line-strong pt-4">
    <div className="flex justify-between gap-3 items-center mb-3"><h3 id="dj-levels-title" className="text-sm font-medium">Imersão DJ</h3><output className="font-mono text-xs text-accent" aria-live="polite">{intensity}%</output></div>
    <div className="grid grid-cols-3 gap-2 mb-3" role="group" aria-label="Níveis DJ">
      {DJ_LEVELS.map(level => <button key={level.name} onClick={() => onIntensity(level.intensity)} aria-pressed={intensity === level.intensity} className={`rounded-md border text-xs font-medium transition-colors ${intensity === level.intensity ? 'border-accent bg-accent-wash text-accent' : 'border-line-strong text-ink-muted hover:text-ink'}`}>{level.name}</button>)}
    </div>
    <Range label="Intensidade DJ" min={0} max={100} step={1} value={intensity} onChange={onIntensity} />
    <p className="text-xs leading-relaxed text-ink-muted mt-2">Ajusta a força dos efeitos e da adaptação estéreo, sem rotação. O volume do player permanece no seu controle. Use Personalizar para ajustar cada efeito ou salvar seu modo.</p>
  </section>;
}
