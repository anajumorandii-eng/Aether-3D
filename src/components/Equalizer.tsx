import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { EQ_FREQUENCIES, EQ_PRESETS } from '../audio/AudioEngine';
import { PanelHeader } from './ui';

const MIN = -12;
const MAX = 12;
const fmtFreq = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`);
const pct = (v: number) => ((MAX - v) / (MAX - MIN)) * 100;

function curvePath(gains: number[]) {
  const pts = gains.map((g, i) => [(i + 0.5) * 10, pct(g)]);
  let d = `M0 ${pts[0][1]} L${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${x1 + (x2 - x0) / 6} ${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6} ${y2 - (y3 - y1) / 6} ${x2} ${y2}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L100 ${last[1]}`;
}

function BandSlider({ freq, value, onChange }: { freq: number; value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointermove' && e.buttons !== 1) return;
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = 1 - (e.clientY - rect.top) / rect.height;
    const v = Math.round(MIN + Math.max(0, Math.min(1, ratio)) * (MAX - MIN));
    if (v !== value) onChange(v);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, number> = {
      ArrowUp: value + 1, ArrowRight: value + 1, ArrowDown: value - 1, ArrowLeft: value - 1,
      PageUp: value + 3, PageDown: value - 3, Home: MAX, End: MIN,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    onChange(Math.max(MIN, Math.min(MAX, map[e.key])));
  };

  const top = pct(value);
  const zero = pct(0);

  return (
    <div className="flex flex-col items-center gap-2 min-w-0">
      <span className={`font-mono text-[10px] tnum h-3 ${value === 0 ? 'text-ink-faint' : 'text-accent-soft'}`}>
        {value > 0 ? `+${value}` : value}
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={`Banda ${fmtFreq(freq)}Hz`}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={value}
        aria-valuetext={`${value} dB`}
        onPointerDown={fromPointer}
        onPointerMove={fromPointer}
        onDoubleClick={() => onChange(0)}
        onKeyDown={onKey}
        className="group relative h-36 w-full flex justify-center touch-none cursor-ns-resize"
      >
        <div className="absolute inset-y-0 w-1 rounded-full bg-line-strong/60" />
        <div
          className="absolute w-1 rounded-full bg-accent"
          style={{ top: `${Math.min(top, zero)}%`, height: `${Math.abs(top - zero)}%` }}
        />
        <div
          className="absolute w-4 h-4 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_4px_rgba(104,204,232,0.22),0_2px_6px_rgba(0,0,0,0.5)] transition-transform group-active:scale-110"
          style={{ top: `${top}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-ink-faint">{fmtFreq(freq)}</span>
    </div>
  );
}

interface Props {
  gains: number[];
  activePreset: string;
  onPreset: (name: string, gains: number[]) => void;
  onBand: (index: number, value: number) => void;
}

export function Equalizer({ gains, activePreset, onPreset, onBand }: Props) {
  return (
    <section className="panel p-5">
      <PanelHeader
        icon={<SlidersHorizontal className="w-4 h-4" />}
        title="Equalizador · 10 bandas"
        aside={
          <button
            onClick={() => onPreset('Neutro', EQ_PRESETS[0].gains)}
            className="flex items-center gap-1.5 text-[11px] text-ink-muted hover:text-ink transition px-2 py-1 rounded-lg hover:bg-raised"
          >
            <RotateCcw className="w-3 h-3" /> Zerar
          </button>
        }
      />

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1 mb-4">
        {[...EQ_PRESETS, ...(EQ_PRESETS.some((p) => p.name === activePreset) ? [] : [{ name: activePreset, gains }])].map(
          (preset) => {
            const active = activePreset === preset.name;
            return (
              <button
                key={preset.name}
                onClick={() => onPreset(preset.name, preset.gains)}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition ${
                  active
                    ? 'bg-accent-strong border-accent text-white shadow-sm'
                    : 'bg-sunken border-line text-ink-muted hover:text-ink hover:border-line-strong'
                }`}
              >
                {preset.name}
              </button>
            );
          },
        )}
      </div>

      <div className="relative rounded-lg bg-sunken/70 border border-line px-2 pt-2 pb-2">
        <svg
          className="absolute left-2 right-2 pointer-events-none"
          style={{ top: 28, height: 144, width: 'calc(100% - 16px)' }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#9cdec7" stopOpacity="0.28" />
              <stop offset="1" stopColor="#9cdec7" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" x2="100" y1="50" y2="50" stroke="rgb(180 193 189 / 0.18)" strokeDasharray="1 2" vectorEffect="non-scaling-stroke" />
          <path d={`${curvePath(gains)} L100 100 L0 100 Z`} fill="url(#eqfill)" />
          <path d={curvePath(gains)} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="relative grid grid-cols-10 gap-0.5">
          {EQ_FREQUENCIES.map((f, i) => (
            <BandSlider key={f} freq={f} value={gains[i]} onChange={(v) => onBand(i, v)} />
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">Arraste as bandas · toque duplo zera · ±12 dB</p>
    </section>
  );
}
