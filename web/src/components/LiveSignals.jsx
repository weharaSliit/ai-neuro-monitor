import { useState } from 'react';
import useElementWidth from '../hooks/useElementWidth';
import { COLORS } from '../lib/levels';
import { Card, CardHead } from './ui';

// Live view of the ring and the headband straight from the broker (nothing stored):
// a heart that pumps at your real heart rate, your skin response, and the headband's
// signal. Connection status lives in the strip at the top of the page.
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// Smooth area sparkline, no axes: only the shape and the newest value matter here.
function Spark({ points, color, straight = false, symmetric = false, minSpan = 0, height = 70 }) {
  const [box, width] = useElementWidth();
  const W = Math.max(120, width);
  let body = <text x={W / 2} y={height / 2} textAnchor="middle" fontSize="12" fill={COLORS.textMuted}>Waiting for signal…</text>;
  if (points.length >= 2) {
    const vals = points.map((p) => p.v);
    let lo = Math.min(...vals); let hi = Math.max(...vals);
    if (symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)); lo = -m; hi = m; }
    if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const xy = points.map((p) => [4 + p.x * (W - 8), 4 + (1 - (p.v - lo) / (hi - lo)) * (height - 8)]);
    let d = `M ${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
    for (let i = 1; i < xy.length; i += 1) {
      const [x0, y0] = xy[i - 1]; const [x1, y1] = xy[i];
      d += straight ? ` L ${x1.toFixed(1)} ${y1.toFixed(1)}` : ` C ${((x0 + x1) / 2).toFixed(1)} ${y0.toFixed(1)}, ${((x0 + x1) / 2).toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
    const last = xy[xy.length - 1];
    const gid = `sp${color.replace('#', '')}`;
    body = (
      <>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {!symmetric && <path d={`${d} L ${last[0].toFixed(1)} ${height} L ${xy[0][0].toFixed(1)} ${height} Z`} fill={`url(#${gid})`} />}
        <path d={d} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {!straight && <circle cx={last[0]} cy={last[1]} r="4.5" fill={color} stroke="#fff" strokeWidth="2" />}
      </>
    );
  }
  return <div ref={box} style={{ width: '100%', minWidth: 0 }}><svg width={W} height={height} style={{ display: 'block' }}>{body}</svg></div>;
}

function HeartIcon({ bpm }) {
  // Pumps once per beat at the measured rate (kept between 35 and 200 so it never freezes or flickers).
  const secs = bpm ? Math.max(0.3, Math.min(1.7, 60 / bpm)) : null;
  return (
    <svg viewBox="0 0 64 58" width="84" height="76" className={`heart ${secs ? 'beat' : ''}`} style={secs ? { animationDuration: `${secs}s` } : undefined} aria-hidden="true">
      <defs>
        <linearGradient id="heartg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F08B73" /><stop offset="1" stopColor="#D9482F" /></linearGradient>
      </defs>
      <path d="M32 55C10 40 2 29 2 18 2 9 9 3 17 3c6 0 11 3 15 9 4-6 9-9 15-9 8 0 15 6 15 15 0 11-8 22-30 37z"
        fill={secs ? 'url(#heartg)' : '#E6E0D2'} />
      <path d="M14 14c1-4 4-6 8-6" stroke="#fff" strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function Tile({ icon, title, color, children, foot }) {
  return (
    <div className="ls-tile">
      <div className="ls-head"><span className="ls-ico" style={{ background: `${color}1F` }}>{icon}</span><b>{title}</b></div>
      {children}
      {foot && <div className="ls-foot">{foot}</div>}
    </div>
  );
}

// live = useLiveDevices() from the dashboard, which also feeds the connection strip.
export default function LiveSignals({ live }) {
  const [open, setOpen] = useState(true);
  const ring = live?.ring; const eeg = live?.eeg;

  let bpm = null; let gsrPoints = [];
  if (ring) {
    const t0 = ring.now - 30000;
    const recent = ring.beats.slice(-6).map((b) => b.hr);
    bpm = recent.length >= 3 ? Math.round(mean(recent)) : null;
    gsrPoints = ring.msgs.filter((m) => m.us != null && m.t >= t0).map((m) => ({ x: (m.t - t0) / 30000, v: m.us }));
  }
  const eegPoints = eeg?.wave?.length > 1 ? eeg.wave.map((v, i) => ({ x: i / (eeg.wave.length - 1), v })) : [];
  const ringLive = Boolean(ring?.fresh); const eegLive = Boolean(eeg?.fresh);
  const fingerOff = ringLive && ring.finger === false;

  return (
    <Card>
      <CardHead title="Live" right={<button className="btn ghost sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</button>} />
      {open && (
        <div className="ls-grid">
          <Tile icon="❤️" title="Heart rate" color={COLORS.stress}>
            <div className="ls-heart">
              <HeartIcon bpm={ringLive && !fingerOff ? bpm : null} />
              <div className="ls-big"><b style={{ color: COLORS.stress }}>{ringLive && !fingerOff && bpm != null ? bpm : '—'}</b><span>bpm</span></div>
            </div>
            {fingerOff && <div className="ls-note">Finger off the ring</div>}
          </Tile>

          <Tile icon="💧" title="Skin response" color={COLORS.gsr}>
            <div className="ls-big"><b style={{ color: COLORS.gsr }}>{ringLive && ring.us != null ? ring.us.toFixed(2) : '—'}</b><span>µS</span></div>
            <Spark points={gsrPoints} color={COLORS.gsr} minSpan={0.1} />
          </Tile>

          <Tile icon="🧠" title="Brain signal" color={COLORS.eeg}>
            <div className="ls-big"><b style={{ color: COLORS.eeg }}>{eegLive && eeg.rms != null ? Math.round(eeg.rms) : '—'}</b><span>µV</span></div>
            <Spark points={eegPoints} color={COLORS.eeg} straight symmetric minSpan={20} />
          </Tile>
        </div>
      )}
    </Card>
  );
}
