import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Headphones } from 'lucide-react';

export interface StagePos {
  x: number;
  z: number;
}

interface Props {
  pos: StagePos;
  onMove: (pos: StagePos) => void;
  isPlaying: boolean;
  getFrequencyData: (arr: Uint8Array<ArrayBuffer>) => boolean;
}

const BARS = 96;

export function SpatialStage({ pos, onMove, isPlaying, getFrequencyData }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(320);
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize(Math.max(240, Math.min(440, Math.floor(entry.contentRect.width))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const data = new Uint8Array(128);
    const smooth = new Float32Array(BARS);
    const cx = size / 2;
    const cy = size / 2;
    const padR = size * 0.36;
    let raf = 0;

    const render = (t: number) => {
      ctx.clearRect(0, 0, size, size);
      const hasData = isPlaying && getFrequencyData(data);

      // Brilho dos graves
      let bass = 0;
      if (hasData) for (let b = 0; b < 6; b++) bass += data[b];
      const bassNorm = bass / (6 * 255);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, padR);
      glow.addColorStop(0, `rgba(99,102,241,${0.1 + bassNorm * 0.28})`);
      glow.addColorStop(1, 'rgba(99,102,241,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, padR, 0, Math.PI * 2);
      ctx.fill();

      // Anéis de distância
      ctx.lineWidth = 1;
      [1, 0.66, 0.33].forEach((k, i) => {
        ctx.strokeStyle = `rgba(148,163,255,${0.22 - i * 0.05})`;
        ctx.setLineDash(i === 0 ? [] : [2, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, padR * k, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = 'rgba(148,163,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(cx - padR, cy);
      ctx.lineTo(cx + padR, cy);
      ctx.moveTo(cx, cy - padR);
      ctx.lineTo(cx, cy + padR);
      ctx.stroke();
      ctx.setLineDash([]);

      // Feixe ouvinte -> fonte
      const sx = cx + posRef.current.x * padR;
      const sy = cy + posRef.current.z * padR;
      const beam = ctx.createLinearGradient(cx, cy, sx, sy);
      beam.addColorStop(0, 'rgba(129,140,248,0)');
      beam.addColorStop(1, 'rgba(129,140,248,0.55)');
      ctx.strokeStyle = beam;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      // Espectro radial
      const inner = padR + 10;
      const maxAmp = size * 0.1;
      for (let i = 0; i < BARS; i++) {
        const mirror = i < BARS / 2 ? i : BARS - i;
        const bin = Math.min(85, Math.floor((mirror / (BARS / 2)) * 75));
        const target = hasData
          ? data[bin] / 255
          : 0.05 + 0.04 * Math.sin(t / 900 + i * 0.35) * Math.sin(t / 1400 + i * 0.13);
        smooth[i] += (target - smooth[i]) * 0.35;
        const v = Math.max(0, smooth[i]);
        const amp = Math.pow(v, 1.35) * maxAmp + 2;
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.strokeStyle = v > 0.08 ? `rgba(165,180,252,${0.3 + v * 0.7})` : 'rgba(148,163,255,0.22)';
        ctx.lineWidth = Math.max(1.5, size / 200);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + cos * inner, cy + sin * inner);
        ctx.lineTo(cx + cos * (inner + amp), cy + sin * (inner + amp));
        ctx.stroke();
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [size, isPlaying, getFrequencyData]);

  const handlePointer = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointermove' && e.buttons !== 1) return;
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    const rect = padRef.current!.getBoundingClientRect();
    const r = rect.width / 2;
    let nx = (e.clientX - (rect.left + r)) / r;
    let nz = (e.clientY - (rect.top + r)) / r;
    const d = Math.hypot(nx, nz);
    if (d > 1) {
      nx /= d;
      nz /= d;
    }
    onMove({ x: nx, z: nz });
  };

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    let x = pos.x + d[0];
    let z = pos.z + d[1];
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    onMove({ x, z });
  };

  const padSize = size * 0.72;
  const azimuth = Math.round((Math.atan2(pos.x, -pos.z) * 180) / Math.PI);

  return (
    <div ref={wrapRef} className="w-full flex justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" style={{ width: size, height: size }} />

        <div
          ref={padRef}
          role="application"
          tabIndex={0}
          aria-label={`Posição da fonte sonora: azimute ${azimuth} graus. Use as setas para mover.`}
          onPointerDown={handlePointer}
          onPointerMove={handlePointer}
          onKeyDown={handleKey}
          className="absolute rounded-full touch-none cursor-crosshair focus-visible:!rounded-full"
          style={{ width: padSize, height: padSize, left: (size - padSize) / 2, top: (size - padSize) / 2 }}
        >
          <span className="absolute top-2 left-1/2 -translate-x-1/2 eyebrow !text-[9px] !tracking-[0.2em]">Frente</span>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 eyebrow !text-[9px] !tracking-[0.2em]">Trás</span>
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 eyebrow !text-[9px]">E</span>
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 eyebrow !text-[9px]">D</span>

          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-raised border border-line-strong grid place-items-center text-ink-muted shadow-lg pointer-events-none">
            <Headphones className="w-4 h-4" />
          </div>

          <div
            className="absolute left-1/2 top-1/2 pointer-events-none"
            style={{ transform: `translate(calc(-50% + ${pos.x * padSize * 0.5}px), calc(-50% + ${pos.z * padSize * 0.5}px))` }}
          >
            <span className="absolute inset-0 rounded-full bg-accent/40 animate-ping" style={{ animationDuration: isPlaying ? '1.6s' : '0s', opacity: isPlaying ? 1 : 0 }} />
            <div className="relative w-8 h-8 rounded-full bg-accent-strong border-2 border-white/90 grid place-items-center shadow-[0_0_24px_rgba(99,102,241,0.85)]">
              <div className="w-2 h-2 rounded-full bg-white" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
