import { LineChart } from './charts';
import { Card, Stat, ago } from './panels';
import { GSR_CAL, RING_MSG_HZ, RING_WINDOW_SEC } from '../lib/config';

// Live ring (wearable 01) signals straight from MQTT: skin conductance, heart rate,
// PPG and movement -- the same topic for the real ring and the live stimulator.
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export default function RawRingPanel({ ring, now }) {
  const { msgs, beats, stats } = ring;
  const last = msgs[msgs.length - 1];
  const recentHr = beats.slice(-8).map((b) => b.hr).filter((v) => v != null && v > 30 && v < 220);
  const rel = (t) => (t - now) / 1000;
  const series = (rows, f) => rows.map((r) => ({ x: rel(r.t), y: f(r) }));
  const xFormat = (v) => `${Math.round(v)}s`;
  const charts = [
    { title: 'Skin conductance (µS)', pts: series(msgs, (r) => r.us), y: (v) => v.toFixed(2), hint: `Grove GSR, ADC → µS with GSR_CAL ${GSR_CAL}` },
    { title: 'Heart rate from beat intervals (bpm)', pts: series(beats, (r) => r.hr), y: (v) => v.toFixed(0), hint: 'One point per detected beat (60000 / IBI)', dots: true },
    { title: 'PPG infrared (raw)', pts: series(msgs, (r) => r.ir), y: (v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)), hint: 'MAX30102 IR; finger detected above 50k' },
    { title: 'Movement (g)', pts: series(msgs, (r) => r.acc), y: (v) => v.toFixed(2), hint: 'MPU6050 acceleration magnitude / 9.81; ~1 g at rest' },
  ];
  return (
    <Card title="Live ring signals" subtitle={`last ${RING_WINDOW_SEC} s`}
      right={<span className="muted">{stats.lastPacketAt ? `message ${ago(stats.lastPacketAt, now)}` : 'waiting'}</span>}>
      <div className="stats">
        <Stat label="Message rate" value={ring.rate == null ? '—' : `${ring.rate.toFixed(1)}/s`} sub={`expected ${RING_MSG_HZ}/s`} />
        <Stat label="Finger" value={last ? (last.finger ? 'On' : 'Off') : '—'} sub={last?.ir != null ? `IR ${last.ir}` : undefined} />
        <Stat label="Heart rate" value={recentHr.length ? `${mean(recentHr).toFixed(0)} bpm` : '—'} sub={`${beats.length} beats in ${RING_WINDOW_SEC}s`} />
        <Stat label="Skin conductance" value={last?.us == null ? '—' : `${last.us.toFixed(2)} µS`} sub={last?.gsr != null ? `ADC ${last.gsr}` : undefined} />
        <Stat label="Movement" value={last ? `${last.acc.toFixed(2)} g` : '—'} />
        <Stat label="Gaps / bad msgs" value={`${stats.gaps} / ${stats.malformed}`} sub="since page opened" />
      </div>
      {ring.conn.error && <p className="caption warn-text">▲ MQTT: {ring.conn.error}</p>}
      <div className="grid-2">
        {charts.map((c) => (
          <div key={c.title}>
            <h3 title={c.hint}>{c.title}</h3>
            <LineChart points={c.pts} height={150} xFormat={xFormat} yFormat={c.y} dots={c.dots}
              ariaLabel={c.title} emptyText="No live data (ring off, or not publishing)" />
          </div>
        ))}
      </div>
    </Card>
  );
}
