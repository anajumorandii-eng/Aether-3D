import type { ReactNode } from 'react';

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b3331" />
          <stop offset="1" stopColor="#181a1b" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#lg)" stroke="rgb(180 193 189 / 0.2)" />
      <g fill="none" stroke="#9cdec7">
        <circle cx="20" cy="20" r="12.5" strokeOpacity=".3" strokeWidth="1.2" />
        <circle cx="20" cy="20" r="8.5" strokeOpacity=".6" strokeWidth="1.2" />
        <circle cx="20" cy="20" r="4.5" strokeWidth="1.4" />
      </g>
      <circle cx="20" cy="20" r="1.6" fill="#c8ebde" />
      <circle cx="28.8" cy="11.2" r="2.6" fill="#f4f5f5" />
    </svg>
  );
}

export function Range({
  value,
  min,
  max,
  step,
  onChange,
  label,
  disabled,
  className = '',
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const fill = ((value - min) / (max - min || 1)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={`range ${className}`}
      style={{ ['--fill' as string]: `${fill}%` }}
    />
  );
}

export function PanelHeader({
  icon,
  title,
  aside,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink tracking-tight">
        <span className="hidden">{icon}</span>
        {title}
      </h2>
      {aside}
    </div>
  );
}

export function Field({ label, value, children }: { label: string; value: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-ink-muted">{label}</span>
        <span className="font-mono text-[11px] text-ink tnum">{value}</span>
      </div>
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors border ${
        checked ? 'bg-accent-strong border-accent' : 'bg-sunken border-line-strong'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-sunken/70 border border-line px-3 py-2">
      <div className="eyebrow !text-[10px]">{label}</div>
      <div className="font-mono text-sm text-ink tnum mt-0.5">{value}</div>
    </div>
  );
}
