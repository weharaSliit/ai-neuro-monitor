import { useEffect, useMemo, useState } from 'react';
import { api, eegApi } from '../lib/api';
import { COLORS } from '../lib/levels';
import useElementWidth from '../hooks/useElementWidth';

// Real-time waves while calibrating and during the personal-limit test.
// The services expose, through the status routes they already have, what has
// arrived so far in the block being captured:
//   ring:  skin conductance (uS) and the last beat intervals
//   EEG:   signal amplitude (RMS, uV) once a second
// plus the finished blocks. Polled every second; nothing is stored.
const POLL_MS = 1000;
const H = 150;
const PAD = { l: 40, r: 12, t: 12, b: 10 };

function useStatus(client, path, enabled) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await client.get(path);
        if (!cancelled) setState(res.data);
      } catch { /* next poll retries */ }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [client, path, enabled]);
  return state;
}

function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

// `points` = [{ x: 0..1, v }], x already placed across the window.
function WaveSvg({ width, points, color, fmt, avg, minSpan }) {
  if (points.length < 2) {
    return (
      <svg width={width} height={H}>
        <text x={width / 2} y={H / 2} textAnchor="middle" fontSize="12" fill={COLORS.textMuted}>—</text>
      </svg>
    );
  }
  const vals = points.map((p) => p.v);
  let lo = Math.min(...vals, avg ?? Infinity); let hi = Math.max(...vals, avg ?? -Infinity);
  if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
  const pad = (hi - lo) * 0.18; lo -= pad; hi += pad;
  const plotW = width - PAD.l - PAD.r; const plotH = H - PAD.t - PAD.b;
  const x = (f) => PAD.l + f * plotW;
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;
  const xy = points.map((p) => [x(p.x), y(p.v)]);
  const last = xy[xy.length - 1];
  const d = smooth(xy);
  const area = `${d} L ${last[0].toFixed(1)} ${H - PAD.b} L ${xy[0][0].toFixed(1)} ${H - PAD.b} Z`;
  const gid = `w${color.replace('#', '')}`;
  return (
    <svg width={width} height={H} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f) => {
        const v = lo + f * (hi - lo);
        return (
          <g key={f}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} stroke={COLORS.borderSoft} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fontWeight="700" fill={COLORS.textMuted}>{fmt(v)}</text>
          </g>
        );
      })}
      {avg != null && (
        <line x1={PAD.l} x2={width - PAD.r} y1={y(avg)} y2={y(avg)} stroke={color} strokeOpacity="0.55" strokeDasharray="6 5" strokeWidth="2" />
      )}
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="4.5" fill={color} stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

function WaveCard({ title, unit, points, color, fmt, avg, minSpan }) {
  const [box, width] = useElementWidth();
  const last = points.length ? points[points.length - 1].v : null;
  return (
    <div className="card flat" style={{ padding: 14 }}>
      <div className="between" style={{ marginBottom: 4 }}>
        <b style={{ fontSize: 14 }}>{title}</b>
        <b style={{ fontSize: 18, color }}>{last != null ? `${fmt(last)}${unit}` : '—'}</b>
      </div>
      <div ref={box} style={{ width: '100%', minWidth: 0 }}>
        <WaveSvg width={Math.max(160, width)} points={points} color={color} fmt={fmt} avg={avg} minSpan={minSpan} />
      </div>
    </div>
  );
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export default function LiveCalibrationGraphs({ phase, ringOnline, eegOnline }) {
  const path = phase === 'task' ? '/calibrate/threshold/status' : '/calibrate/status';
  const ring = useStatus(api, path, ringOnline);
  const eeg = useStatus(eegApi, path, eegOnline);

  // Keep the last wave on screen once capture ends (the services stop
  // sending `live` when they finish), so the graphs don't go blank.
  const [held, setHeld] = useState({ ibi: [], gsr: [], rms: [] });
  useEffect(() => { setHeld({ ibi: [], gsr: [], rms: [] }); }, [phase]);
  useEffect(() => {
    const l = ring?.live;
    if (!l) return;
    setHeld((h) => ({
      ...h,
      ibi: (l.ibi_ms || []).length >= 2 ? l.ibi_ms : h.ibi,
      gsr: (l.gsr_us || []).length >= 2 ? l.gsr_us : h.gsr,
    }));
  }, [ring?.live]);
  useEffect(() => {
    const l = eeg?.live;
    if (!l) return;
    setHeld((h) => ({ ...h, rms: (l.rms_uv || []).length >= 2 ? l.rms_uv : h.rms }));
  }, [eeg?.live]);

  // Heart rate: one point per beat, spaced by the beat intervals.
  const ibi = held.ibi;
  let hrPoints = [];
  if (ibi.length >= 2) {
    const total = ibi.reduce((a, b) => a + b, 0);
    let t = 0;
    hrPoints = ibi.map((m) => { t += m; return { x: t / total, v: 60000 / m }; });
  }
  // Skin response: evenly spaced samples.
  const gsr = held.gsr;
  const gsrPoints = gsr.length >= 2 ? gsr.map((v, i) => ({ x: i / (gsr.length - 1), v })) : [];
  // Brain activity: amplitude once a second.
  const rms = held.rms;
  const rmsPoints = rms.length >= 2 ? rms.map((v, i) => ({ x: i / (rms.length - 1), v })) : [];

  const blocks = (ring?.blocks || []).filter((b) => b && b.valid);
  const hrAvg = mean(blocks.map((b) => b.hr).filter((v) => v != null && v > 0));
  const gsrAvg = mean(blocks.map((b) => b.gsr).filter((v) => v != null));

  return (
    <div className="live-graphs" style={{ marginTop: 16 }}>
      <WaveCard title="Heart rate" unit=" bpm" points={hrPoints} color={COLORS.hrv} fmt={(v) => Math.round(v)} avg={hrAvg} minSpan={10} />
      <WaveCard title="Skin response" unit=" µS" points={gsrPoints} color={COLORS.gsr} fmt={(v) => v.toFixed(2)} avg={gsrAvg} minSpan={0.1} />
      <WaveCard title="Brain activity" unit=" µV" points={rmsPoints} color={COLORS.eeg} fmt={(v) => Math.round(v)} minSpan={10} />
    </div>
  );
}
