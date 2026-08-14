import { useEffect, useRef } from 'react';
import type { EpochResult, Config } from '../types';
import { STAGE_COLORS } from '../types';

interface Props {
  history: EpochResult[];
  config: Config | null;
}

export default function ProbabilityChart({ history, config }: Props) {
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

    const stride = config?.epoch_stride_s ?? 0.5;
    for (const e of history) {
      const x0 = xOf(e.time_s - stride / 2);
      const x1 = xOf(e.time_s + stride / 2);
      if (e.skipped || e.stage === null) {
        ctx.fillStyle = 'rgba(150,150,150,0.20)';
      } else {
        ctx.fillStyle = STAGE_COLORS[e.stage] + '2e';
      }
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }

    const alertThresh = config?.alert_thresh ?? 0.45;
    const threshY = h - alertThresh * h;
    ctx.strokeStyle = 'rgba(255,77,79,0.55)';
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(0, threshY);
    ctx.lineTo(w, threshY);
    ctx.stroke();
    ctx.setLineDash([]);

    function plot(key: 'p_emo' | 'risk', color: string) {
      ctx!.strokeStyle = color;
      ctx!.lineWidth = 1.8 * dpr;
      ctx!.beginPath();
      let started = false;
      for (const e of history) {
        const v = e[key];
        if (v === null || v === undefined) {
          started = false;
          continue;
        }
        const x = xOf(e.time_s);
        const y = h - v * h;
        if (!started) {
          ctx!.moveTo(x, y);
          started = true;
        } else {
          ctx!.lineTo(x, y);
        }
      }
      ctx!.stroke();
    }

    plot('p_emo', '#4fc3f7');
    plot('risk', '#c792ea');
  }, [history, config]);

  return (
    <div className="panel prob-chart-panel">
      <div className="panel__header">
        <span>Stress Stage Timeline</span>
        <div className="waveform-legend">
          <span className="legend-dot" style={{ background: '#4fc3f7' }} /> p_emo
          <span className="legend-dot" style={{ background: '#c792ea' }} /> risk
          <span className="legend-dot" style={{ background: STAGE_COLORS[1] }} /> pre-stage
          <span className="legend-dot" style={{ background: STAGE_COLORS[2] }} /> stressed
          <span className="legend-dot" style={{ background: '#888' }} /> skipped
        </div>
      </div>
      <canvas ref={canvasRef} className="prob-chart-canvas" />
    </div>
  );
}
