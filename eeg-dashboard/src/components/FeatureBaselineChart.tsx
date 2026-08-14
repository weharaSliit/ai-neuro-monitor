import { useEffect, useRef } from 'react';
import type { EpochResult } from '../types';

const DIST_COLOR = '#b28dff';
const DEVIATE_COLOR = '#ff4d4f';
const SHOCK_COLOR = '#ffb020';
const BAND_SIGMA = 2; // shaded "within baseline" band = mu +/- 2*sigma

interface Props {
  history: EpochResult[];
}

/**
 * Time-series view of FeatureTrendMonitor (eeg/trend_detector.py) — the
 * Mahalanobis distance of the full 76-dim feature vector from this user's
 * own frozen feature-space baseline, plotted the same way
 * ChannelBaselineChart plots T7/T8 raw-signal level: a shaded mu +/- 2sigma
 * band, with the trace turning red past it. Complements (does not
 * replace) TrendGauge's live p_emo-CUSUM number and ChannelBaselineChart's
 * per-channel view — this is the aggregate, all-76-features signal.
 *
 * feature_trend_alarm is corroborating-only (doesn't gate `stage`), so it's
 * shown as a red band under the trace rather than a stage-changing event.
 * shock_alarm (fast, dual-signal, DOES gate `stage`) is marked separately
 * with amber ticks so the two different early-warning mechanisms (Sec 4.5
 * vs Sec 4.6 of the pipeline report) aren't visually conflated.
 */
export default function FeatureBaselineChart({ history }: Props) {
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

    const padTop = 10 * dpr;
    const padBottom = 20 * dpr;
    const plotH = h - padTop - padBottom;

    // y-range: fit both observed distances and the baseline band
    let mn = Infinity;
    let mx = -Infinity;
    for (const e of history) {
      const v = e.feature_dist;
      if (v !== null && v !== undefined) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    const lastReady = [...history].reverse().find((e) => e.feature_dist_mu !== null);
    const mu = lastReady?.feature_dist_mu ?? null;
    const sigma = lastReady?.feature_dist_sigma ?? null;
    if (mu !== null && sigma !== null) {
      mn = Math.min(mn, mu - (BAND_SIGMA + 1) * sigma, 0);
      mx = Math.max(mx, mu + (BAND_SIGMA + 1) * sigma);
    }
    if (!Number.isFinite(mn) || !Number.isFinite(mx)) return;
    if (mn === mx) {
      mn -= 1;
      mx += 1;
    }
    const pad = (mx - mn) * 0.1;
    mn = Math.max(0, mn - pad); // Mahalanobis distance is never negative
    mx += pad;
    const yOf = (v: number) => padTop + plotH - ((v - mn) / (mx - mn)) * plotH;

    // shaded baseline band + mu line
    if (mu !== null && sigma !== null) {
      const yTop = yOf(mu + BAND_SIGMA * sigma);
      const yBot = yOf(mu - BAND_SIGMA * sigma);
      ctx.fillStyle = DIST_COLOR + '1a';
      ctx.fillRect(0, yTop, w, yBot - yTop);

      ctx.strokeStyle = DIST_COLOR + '80';
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, yOf(mu));
      ctx.lineTo(w, yOf(mu));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // feature_trend_alarm periods — thin red band along the bottom axis
    ctx.fillStyle = DEVIATE_COLOR + '55';
    for (const e of history) {
      if (e.feature_trend_alarm) {
        const x = xOf(e.time_s);
        ctx.fillRect(x - 1 * dpr, padTop + plotH - 4 * dpr, 3 * dpr, 4 * dpr);
      }
    }

    // shock_alarm ticks — amber marks along the top axis (fast, separate mechanism)
    ctx.fillStyle = SHOCK_COLOR;
    for (const e of history) {
      if (e.shock_alarm) {
        const x = xOf(e.time_s);
        ctx.fillRect(x - 1 * dpr, padTop, 3 * dpr, 4 * dpr);
      }
    }

    // feature_dist line, colored red past the baseline band
    ctx.lineWidth = 1.6 * dpr;
    let started = false;
    let prevPt: { x: number; y: number } | null = null;
    for (const e of history) {
      const v = e.feature_dist;
      if (v === null || v === undefined) {
        started = false;
        prevPt = null;
        continue;
      }
      const x = xOf(e.time_s);
      const y = yOf(v);
      const deviating = mu !== null && sigma !== null && v > mu + BAND_SIGMA * sigma;

      ctx.strokeStyle = deviating ? DEVIATE_COLOR : DIST_COLOR;
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

    const calibrating = history[history.length - 1]?.feature_dist_mu === null;
    if (calibrating) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `${11 * dpr}px monospace`;
      ctx.fillText('identifying feature baseline...', 8 * dpr, padTop + 14 * dpr);
    }
  }, [history]);

  return (
    <div className="panel feature-baseline-panel">
      <div className="panel__header">
        <span>Feature-Space Deviation from Identified Baseline (76-dim, Mahalanobis)</span>
        <div className="waveform-legend">
          <span className="legend-dot" style={{ background: DIST_COLOR }} /> feature_dist
          <span className="legend-dot" style={{ background: DEVIATE_COLOR }} /> {'>'}2σ / sustained (feature_trend_alarm)
          <span className="legend-dot" style={{ background: SHOCK_COLOR }} /> shock_alarm
        </div>
      </div>
      <canvas ref={canvasRef} className="feature-baseline-canvas" />
    </div>
  );
}
