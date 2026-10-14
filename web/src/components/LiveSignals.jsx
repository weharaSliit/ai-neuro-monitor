import { useState } from 'react';
import useLiveDevices from '../hooks/useLiveDevices';
import useElementWidth from '../hooks/useElementWidth';
import { COLORS } from '../lib/levels';
import { Badge, Card, CardHead } from './ui';

// "Live" view of the ring and the headband, between the once-a-minute
// predictions: heart rate per beat, skin conductance, the headband's signal,
// and quick checks that the data is trustworthy (finger, message rate, gaps).
// Straight from the MQTT broker, like the technical dashboard; nothing stored.
const H = 130;
const PAD = { l: 40, r: 12, t: 10, b: 10 };

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

// points: [{ x: 0..1, v }]
function Wave({ width, points, color, fmt, minSpan, straight = false, symmetric = false }) {
  if (points.length < 2) {
    return (
      <svg width={width} height={H}>
        <text x={width / 2} y={H / 2} textAnchor="middle" fontSize="12" fill={COLORS.textMuted}>Waiting for signal…</text>
      </svg>
    );
  }
  const vals = points.map((p) => p.v);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  if (symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)); lo = -m; hi = m; }
  if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const plotW = width - PAD.l - PAD.r; const plotH = H - PAD.t - PAD.b;
  const xy = points.map((p) => [PAD.l + p.x * plotW, PAD.t + (1 - (p.v - lo) / (hi - lo)) * plotH]);
  const d = straight
    ? xy.map((q, i) => `${i ? 'L' : 'M'} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ')
    : smooth(xy);
  const last = xy[xy.length - 1];
  return (
    <svg width={width} height={H} style={{ display: 'block' }}>
      {[0, 0.5, 1].map((f) => {
        const v = lo + f * (hi - lo);
        const y = PAD.t + (1 - f) * plotH;
        return (
          <g key={f}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} stroke={COLORS.borderSoft} />
            <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize="10" fontWeight="700" fill={COLORS.textMuted}>{fmt(v)}</text>
          </g>
        );
      })}
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {!straight && <circle cx={last[0]} cy={last[1]} r="4.5" fill={color} stroke="#fff" strokeWidth="2" />}
    </svg>
  );
}

function WaveBox({ title, value, unit, color, ...wave }) {
  const [box, width] = useElementWidth();
  return (
    <div>
      <div className="between" style={{ marginBottom: 4 }}>
        <span className="subtitle">{title}</span>
        <span><b style={{ fontSize: 20, color }}>{value ?? '—'}</b> <small className="muted">{unit}</small></span>
      </div>
      <div ref={box} style={{ width: '100%', minWidth: 0 }}>
        <Wave width={Math.max(160, width)} color={color} {...wave} />
      </div>
    </div>
  );
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export default function LiveSignals() {
  const [open, setOpen] = useState(true);
  const { ring, eeg, ringConn, eegConn } = useLiveDevices();

  // Heart rate: one point per beat, placed by wall-clock arrival time.
  let hrPoints = []; let bpm = null; let gsrPoints = [];
  if (ring) {
    const t1 = ring.now; const t0 = t1 - 30000;
    hrPoints = ring.beats.filter((b) => b.t >= t0).map((b) => ({ x: (b.t - t0) / 30000, v: b.hr }));
    const recent = ring.beats.slice(-6).map((b) => b.hr);
    bpm = recent.length >= 3 ? Math.round(mean(recent)) : null;
    gsrPoints = ring.msgs.filter((m) => m.us != null && m.t >= t0).map((m) => ({ x: (m.t - t0) / 30000, v: m.us }));
  }
  const eegPoints = eeg?.wave?.length > 1 ? eeg.wave.map((v, i) => ({ x: i / (eeg.wave.length - 1), v })) : [];

  const ringLive = ring?.fresh;
  const eegLive = eeg?.fresh;

  return (
    <Card>
      <CardHead
        title="Live signals"
        right={<button className="btn ghost sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</button>}
      />
      {open && (
        <div className="grid grid-2" style={{ gap: 28, marginTop: 6 }}>
          {/* ── Ring ── */}
          <div>
            <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <b style={{ fontSize: 15 }}>💍 Ring</b>
              <Badge color={ringLive ? COLORS.normal : '#989294'} dot live={ringLive}>
                {ringLive ? 'Streaming' : ringConn === 'connected' ? 'No data' : 'Connecting…'}
              </Badge>
              <Badge color={ring?.finger ? COLORS.normal : COLORS.warning}>Finger {ring?.finger == null ? '—' : ring.finger ? 'on' : 'off'}</Badge>
              <Badge color="#989294">{ring?.rate != null ? `${ring.rate.toFixed(1)}/s` : '—/s'} msgs</Badge>
              <Badge color={ring?.gaps ? COLORS.warning : COLORS.normal}>{ring?.gaps ?? 0} gaps</Badge>
            </div>
            <div className="stack" style={{ gap: 22 }}>
              <WaveBox title="Heart rate" value={ringLive ? bpm : null} unit="bpm" color={COLORS.stress}
                points={hrPoints} fmt={(v) => Math.round(v)} minSpan={10} />
              <WaveBox title="Skin response" value={ringLive && ring.us != null ? ring.us.toFixed(2) : null} unit="µS"
                color={COLORS.gsr} points={gsrPoints} fmt={(v) => v.toFixed(2)} minSpan={0.1} />
            </div>
          </div>

          {/* ── Headband ── */}
          <div>
            <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <b style={{ fontSize: 15 }}>🧠 Headband</b>
              <Badge color={eegLive ? COLORS.normal : '#989294'} dot live={eegLive}>
                {eegLive ? 'Streaming' : eegConn === 'connected' ? 'No data' : 'Connecting…'}
              </Badge>
              <Badge color={eeg?.gaps ? COLORS.warning : COLORS.normal}>{eeg?.gaps ?? 0} gaps</Badge>
            </div>
            <WaveBox title="Brain signal (last 10 s)" value={eegLive && eeg.rms != null ? Math.round(eeg.rms) : null}
              unit="µV rms" color={COLORS.eeg} points={eegPoints} fmt={(v) => Math.round(v)}
              minSpan={20} straight symmetric />
          </div>
        </div>
      )}
    </Card>
  );
}
