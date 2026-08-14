import { useEffect, useRef } from 'react';
import type { EpochResult } from '../types';

const T7_COLOR = '#4fc3f7';
const T8_COLOR = '#ff8a65';
const DEVIATE_COLOR = '#ff4d4f';
const BAND_SIGMA = 2; // shaded "within baseline" band = mu +/- 2*sigma

interface ChannelSpec {
  levelKey: 'ch1_level' | 'ch2_level';
  muKey: 'ch1_baseline_mu' | 'ch2_baseline_mu';
  sigmaKey: 'ch1_baseline_sigma' | 'ch2_baseline_sigma';
  color: string;
  label: string;
}

const CHANNELS: ChannelSpec[] = [
  { levelKey: 'ch1_level', muKey: 'ch1_baseline_mu', sigmaKey: 'ch1_baseline_sigma', color: T7_COLOR, label: 'T7' },
  { levelKey: 'ch2_level', muKey: 'ch2_baseline_mu', sigmaKey: 'ch2_baseline_sigma', color: T8_COLOR, label: 'T8' },
];

interface Props {
  history: EpochResult[];
}

export default function ChannelBaselineChart({ history }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a1420';
    ctx.fillRect(0, 0, w, h);

    if (history.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `${13 * dpr}px monospace`;
      ctx.fillText('collecting epochs...', 16 * dpr, h / 2);
      return;
    }

    const tMin = history[0].time_s;
    const tMax = history[history.length - 1].time_s;
    const span = Math.max(tMax - tMin, 1e-6);
    const xOf = (t: number) => ((t - tMin) / span) * w;

    const rowH = h / CHANNELS.length;
    const padTop = 10 * dpr;
    const padBottom = 16 * dpr;

    CHANNELS.forEach((spec, row) => {
      const y0 = row * rowH;
      const plotH = rowH - padTop - padBottom;

      if (row > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.lineTo(w, y0);
        ctx.stroke();
      }

      // y-range: fit both the observed levels and the baseline band
      let mn = Infinity;
      let mx = -Infinity;
      for (const e of history) {
        const v = e[spec.levelKey];
        if (v !== null && v !== undefined) {
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      const lastReady = [...history].reverse().find((e) => e[spec.muKey] !== null);
      const mu = lastReady?.[spec.muKey] ?? null;
      const sigma = lastReady?.[spec.sigmaKey] ?? null;
      if (mu !== null && sigma !== null) {
        mn = Math.min(mn, mu - (BAND_SIGMA + 1) * sigma);
        mx = Math.max(mx, mu + (BAND_SIGMA + 1) * sigma);
      }
      if (!Number.isFinite(mn) || !Number.isFinite(mx)) return;
      if (mn === mx) {
        mn -= 1;
        mx += 1;
      }
      const pad = (mx - mn) * 0.1;
      mn -= pad;
      mx += pad;
      const yOf = (v: number) => y0 + padTop + plotH - ((v - mn) / (mx - mn)) * plotH;

      // shaded baseline band + mu line
      if (mu !== null && sigma !== null) {
        const yTop = yOf(mu + BAND_SIGMA * sigma);
        const yBot = yOf(mu - BAND_SIGMA * sigma);
        ctx.fillStyle = spec.color + '1a';
        ctx.fillRect(0, yTop, w, yBot - yTop);

        ctx.strokeStyle = spec.color + '80';
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.moveTo(0, yOf(mu));
        ctx.lineTo(w, yOf(mu));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // level line, colored red past the baseline band (deviation highlight)
      ctx.lineWidth = 1.6 * dpr;
      let started = false;
      let prevPt: { x: number; y: number } | null = null;
      for (const e of history) {
        const v = e[spec.levelKey];
        if (v === null || v === undefined) {
          started = false;
          prevPt = null;
          continue;
        }
        const x = xOf(e.time_s);
        const y = yOf(v);
        const deviating = mu !== null && sigma !== null && Math.abs(v - mu) > BAND_SIGMA * sigma;

        ctx.strokeStyle = deviating ? DEVIATE_COLOR : spec.color;
        ctx.beginPath();
        if (!started || !prevPt) {
          ctx.moveTo(x, y);
        } else {
          ctx.moveTo(prevPt.x, prevPt.y);
        }
        ctx.lineTo(x, y);
        ctx.stroke();

        started = true;
        prevPt = { x, y };
      }

      // row label
      ctx.fillStyle = spec.color;
      ctx.font = `${11 * dpr}px monospace`;
      ctx.fillText(spec.label, 6 * dpr, y0 + padTop + 10 * dpr);

      const calibrating = history[history.length - 1]?.channel_calibrating;
      if (calibrating) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = `${10.5 * dpr}px monospace`;
        ctx.fillText('identifying baseline...', 30 * dpr, y0 + padTop + 10 * dpr);
      }
    });
  }, [history]);

  return (
    <div className="panel channel-baseline-panel">
      <div className="panel__header">
        <span>Channel Deviation from Identified Baseline (T7 / T8)</span>
        <div className="waveform-legend">
          <span className="legend-dot" style={{ background: T7_COLOR }} /> T7 level
          <span className="legend-dot" style={{ background: T8_COLOR }} /> T8 level
          <span className="legend-dot" style={{ background: DEVIATE_COLOR }} /> {'>'}2σ from baseline
        </div>
      </div>
      <canvas ref={canvasRef} className="channel-baseline-canvas" />
    </div>
  );
}
