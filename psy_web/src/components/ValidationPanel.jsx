import { useMemo, useState } from 'react';
import { Card, Status } from './panels';
import { LineChart, MultiLineChart } from './charts';
import useLiveSpectral, { CONDITIONS } from '../hooks/useLiveSpectral';
import { BANDS, RANGE_UV } from '../lib/dsp';

// Live evidence that the headband records EEG and that it responds to load:
//   1. real EEG     -- alpha rises eyes-closed vs eyes-open; band shares and
//                      slope inside the model's training range (TRAINING_RANGE)
//   2. load effect  -- theta up, alpha down, theta/alpha up in high vs low
//                      load, repeated over many windows / 25 s blocks
// Classification with cross-validation (step 3) is done offline on the CSV
// export, split by block -- overlapping 1 s windows must not be mixed.
const CLEAN_MAX_OUT_OF_RANGE = 0.05; // quality_gate.py MAX_OUT_OF_RANGE_FRACTION

// The model's own training data (SAM40 T7-T8 bipolar, 480 blocks,
// psycological/results/features_bipolar_only_25s_block.csv): 1st-99th
// percentile per feature. Textbook rules (1/f slope -1..-2, small gamma)
// don't hold for this montage -- T7/T8 sit on the temporalis muscle, and
// SAM40 itself has median gamma 20% and slope -0.53 -- so the live signal
// is judged against what the model was trained on instead.
const pctFmt = (v) => `${(v * 100).toFixed(1)}%`;
const TRAINING_RANGE = [
  { key: 'delta_rel', label: 'delta share', lo: 0.061, hi: 0.262, fmt: pctFmt },
  { key: 'alpha_rel', label: 'alpha share', lo: 0.065, hi: 0.290, fmt: pctFmt },
  { key: 'gamma_rel', label: 'gamma share', lo: 0.066, hi: 0.370, fmt: pctFmt },
  { key: 'slope', label: 'spectral slope', lo: -1.104, hi: 0.007, fmt: (v) => v.toFixed(2) },
];

const BAND_SERIES = [
  { key: 'delta_rel', label: 'Delta 0.5–4 Hz', color: 'var(--c1)' },
  { key: 'theta_rel', label: 'Theta 4–8 Hz', color: 'var(--c2)' },
  { key: 'alpha_rel', label: 'Alpha 8–13 Hz', color: 'var(--c3)' },
  { key: 'beta_rel', label: 'Beta 13–30 Hz', color: 'var(--c4)' },
  { key: 'gamma_rel', label: 'Gamma 30–45 Hz', color: 'var(--c5)' },
];
const TESTS = {
  eyes: { a: 'eyes_open', b: 'eyes_closed', title: 'Eyes open vs closed' },
  load: { a: 'low_load', b: 'high_load', title: 'Low vs high load' },
};

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function condBands(segments, nowMs) {
  return segments.map((s) => ({
    x0: s.start, x1: s.end ?? nowMs, label: CONDITIONS[s.key].label,
    kind: s.key === 'eyes_closed' || s.key === 'high_load' ? 'b' : 'a',
  }));
}

// Does a value move the expected way between condition A and B?
function Direction({ a, b, expect, minChange = 0.1 }) {
  if (a == null || b == null) return <Status kind="idle">Needs both conditions</Status>;
  const change = (b - a) / Math.abs(a || 1e-12);
  const ok = expect === 'up' ? change >= minChange : change <= -minChange;
  const wrong = expect === 'up' ? change < 0 : change > 0;
  return (
    <Status kind={ok ? 'good' : wrong ? 'critical' : 'warning'}>
      {change >= 0 ? '+' : ''}{(change * 100).toFixed(0)}% · {ok ? 'as expected' : wrong ? 'opposite direction' : 'too small'}
    </Status>
  );
}

function exportCsv(history) {
  const cols = ['x', 'iso_time', 'device_millis', 'condition', 'out_of_range', 'rms',
    ...Object.keys(BANDS).flatMap((b) => [b, `${b}_rel`]), 'theta_alpha', 'slope'];
  const rows = history.map((h) => cols.map((c) => {
    if (c === 'iso_time') return new Date(h.x).toISOString();
    if (c === 'device_millis') return h.deviceMillis;
    const v = h[c];
    return v == null ? '' : v;
  }).join(','));
  const blob = new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wearable02_live_features_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ValidationPanel({ raw, sessionData, now }) {
  const live = useLiveSpectral(raw);
  const [test, setTest] = useState('eyes');
  const { history, latest, segments, condition, avgSpectra } = live;
  const bands = useMemo(() => condBands(segments, now), [segments, now]);
  const clean = useMemo(() => history.filter((h) => h.out_of_range <= CLEAN_MAX_OUT_OF_RANGE), [history]);
  const t0 = history.length ? history[0].x : null;

  // per-condition summaries (clean windows only)
  const byCond = useMemo(() => {
    const out = {};
    for (const key of Object.keys(CONDITIONS)) {
      const w = clean.filter((h) => h.condition === key);
      out[key] = {
        n: w.length,
        alpha: mean(w.map((h) => h.alpha_rel)), theta: mean(w.map((h) => h.theta_rel)),
        gamma: mean(w.map((h) => h.gamma_rel)), ratio: mean(w.map((h) => h.theta_alpha)),
        slope: median(w.map((h) => h.slope).filter((v) => v != null)),
      };
    }
    return out;
  }, [clean]);

  // backend 25 s blocks, labelled by the condition active over the whole block
  const blockPoints = useMemo(() => sessionData.blocks
    .filter((b) => b.timestamp_end && b.features_eeg?.bipolar && !b.skipped)
    .map((b) => {
      const end = b.timestamp_end * 1000;
      const seg = segments.find((s) => s.start <= end - 25000 && (s.end ?? now) >= end);
      const f = b.features_eeg.bipolar;
      return { x: end, theta_rel: f.theta_rel_power, alpha_rel: f.alpha_rel_power, theta_alpha: f.theta_alpha_ratio, condition: seg?.key || null };
    }), [sessionData.blocks, segments, now]);
  const blockCounts = useMemo(() => Object.fromEntries(Object.keys(CONDITIONS).map((k) => [k, blockPoints.filter((p) => p.condition === k).length])), [blockPoints]);

  // spectrum: live + the two condition averages for the selected test
  const T = TESTS[test];
  const spectrum = useMemo(() => {
    if (!latest?.freqs) return [];
    const pts = [];
    for (let k = 0; k < latest.freqs.length; k += 1) {
      const f = latest.freqs[k];
      if (f < 1 || f > 45) continue;
      const lg = (v) => (v > 0 ? Math.log10(v) : null);
      pts.push({
        x: f,
        live: lg(latest.psd[k]),
        fit: latest.slope != null ? latest.slopeIntercept + latest.slope * Math.log10(f) : null,
        a: avgSpectra[T.a] ? lg(avgSpectra[T.a].psd[k]) : null,
        b: avgSpectra[T.b] ? lg(avgSpectra[T.b].psd[k]) : null,
      });
    }
    return pts;
  }, [latest, avgSpectra, T]);
  const freqBands = Object.entries(BANDS).map(([name, [lo, hi]], i) => ({
    x0: Math.max(lo, 1), x1: hi, label: name, kind: i % 2 ? 'b' : 'a',
  }));

  const streaming = raw.stats.lastPacketAt && now - raw.stats.lastPacketAt < 5000;
  const wave = latest?.wave ? Array.from(latest.wave, (v, i) => ({ x: i / 250, y: v })) : [];
  const largest = latest ? BAND_SERIES.reduce((m, s) => (latest[s.key] > (latest[m.key] ?? -1) ? s : m), BAND_SERIES[0]) : null;
  const xFmt = (v) => (t0 == null ? '' : clock(v));

  return (
    <Card
      title="Signal validation (live)"
      subtitle="Proof that the headband records EEG and that it changes with mental load. Filtered 1–45 Hz like the backend, computed in your browser from the raw stream."
      right={(
        <div className="seg">
          <button type="button" onClick={() => exportCsv(history)} disabled={!history.length}>Export CSV</button>
          <button type="button" onClick={live.reset} disabled={!history.length}>Reset</button>
        </div>
      )}
    >
      <div className="cond-bar" role="group" aria-label="Mark the current condition">
        <span className="muted">Mark what the person is doing now:</span>
        {Object.entries(CONDITIONS).map(([k, c]) => (
          <button key={k} type="button" className={condition?.key === k ? 'on' : ''} onClick={() => live.setCondition(k)}>{c.label}</button>
        ))}
        <button type="button" onClick={() => live.setCondition(null)} disabled={!condition}>Stop</button>
        {condition && <Status kind="good">{CONDITIONS[condition.key].label} for {Math.round((now - condition.start) / 1000)} s</Status>}
        {!streaming && <Status kind="warning">No live samples: the charts update once wearable02 streams</Status>}
      </div>
      <p className="caption">
        Protocol: eyes open 1 min → eyes closed 1 min (repeat 2–3×); then rest or 0-back as low load and 2-back or mental arithmetic as high load, 2–3 min each, repeated.
        Each point is a {live.windowSec} s window, updated every second. Windows with more than 5% of the signal beyond ±{RANGE_UV} µV are left out of the summary.
      </p>

      <div className="val-grid">
        <div>
          <h3>Filtered signal, last 5 s (unclamped, µV)</h3>
          <LineChart points={wave} height={170} ariaLabel="Filtered EEG, last 5 seconds"
            refLines={[{ y: RANGE_UV, label: `+${RANGE_UV} µV` }, { y: -RANGE_UV, label: `−${RANGE_UV} µV` }]}
            xFormat={(v) => `${v.toFixed(0)}s`} yFormat={(v) => v.toFixed(0)} emptyText="Waiting for 6 s of live data…"
            tooltip={(p) => <><b>{p.y.toFixed(1)} µV</b><span>t = {p.x.toFixed(2)} s</span></>} />
          <p className="caption">
            RMS <b>{num(latest?.rms, 1)} µV</b> · beyond ±{RANGE_UV} µV <b>{pct(latest?.out_of_range)}</b>
            {latest && latest.out_of_range > CLEAN_MAX_OUT_OF_RANGE && <span className="warn-text"> · out of the model's range: check electrode and bias contact</span>}
          </p>
        </div>
        <div>
          <div className="between-row">
            <h3>Spectrum (power, µV²/Hz, log scale, 1–45 Hz)</h3>
            <div className="seg">
              {Object.entries(TESTS).map(([k, t]) => (
                <button key={k} type="button" className={test === k ? 'on' : ''} onClick={() => setTest(k)}>{t.title}</button>
              ))}
            </div>
          </div>
          <MultiLineChart points={spectrum} height={190} ariaLabel="EEG power spectrum" xDomain={[1, 45]}
            xTicks={[1, 4, 8, 13, 20, 30, 45]} bands={freqBands}
            series={[
              { key: 'live', label: 'Live (now)', color: 'var(--ink-2)', width: 1.5 },
              { key: 'fit', label: `1/f fit (slope ${num(latest?.slope)})`, color: 'var(--muted)', dash: true, width: 1.5 },
              { key: 'a', label: `${CONDITIONS[T.a].label} avg (${avgSpectra[T.a]?.n || 0})`, color: 'var(--c6)' },
              { key: 'b', label: `${CONDITIONS[T.b].label} avg (${avgSpectra[T.b]?.n || 0})`, color: 'var(--c7)' },
            ]}
            xFormat={(v) => `${Math.round(v)} Hz`} yFormat={(v) => `10^${Number.isInteger(v) ? v : v.toFixed(1)}`}
            emptyText="Waiting for 6 s of live data…" />
          <p className="caption">
            Look for an alpha bump at 8–13 Hz that grows with eyes closed. T7–T8 also picks up temporalis muscle, so a fairly flat slope and 20–35% gamma are normal here (the model's training data has a median slope of −0.53).
            Largest band now: <b>{largest ? largest.label : '—'}</b>.
          </p>
        </div>
      </div>

      <h3 className="section-title">Relative band power over time</h3>
      <MultiLineChart points={history} series={BAND_SERIES} bands={bands} height={240} yDomain={[0, 1]}
        ariaLabel="Relative band power over time" xFormat={xFmt} yFormat={(v) => `${Math.round(v * 100)}%`}
        emptyText="Starts once live data arrives. Mark conditions above to shade them here." />

      <h3 className="section-title">Theta / alpha ratio over time (rises with mental load)</h3>
      <MultiLineChart points={history} bands={bands} height={200} ariaLabel="Theta to alpha ratio over time"
        series={[{ key: 'theta_alpha', label: 'θ/α', color: 'var(--c2)' }]} legend={false}
        xFormat={xFmt} yFormat={(v) => v.toFixed(2)} emptyText="Starts once live data arrives." />

      <h3 className="section-title">Per 25 s block, from the backend (the model's own features)</h3>
      <MultiLineChart points={blockPoints} bands={bands} height={200} yDomain={[0, 1]}
        ariaLabel="Theta and alpha relative power per 25 second block"
        series={[BAND_SERIES[1], BAND_SERIES[2]]}
        xFormat={(v) => clock(v)} yFormat={(v) => `${Math.round(v * 100)}%`}
        emptyText="No scored blocks in this session yet (rejected blocks are left out)." />

      <h3 className="section-title">Summary (clean windows only)</h3>
      <div className="table-scroll">
        <table className="log val-table">
          <thead>
            <tr><th>Check</th><th>Expected</th><th>Condition A</th><th>Condition B</th><th>Result</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><b>1. Real EEG</b> · alpha share</td><td>Higher eyes closed</td>
              <td>Eyes open {pct(byCond.eyes_open.alpha)} <span className="muted">({byCond.eyes_open.n} win)</span></td>
              <td>Eyes closed {pct(byCond.eyes_closed.alpha)} <span className="muted">({byCond.eyes_closed.n} win)</span></td>
              <td><Direction a={byCond.eyes_open.alpha} b={byCond.eyes_closed.alpha} expect="up" minChange={0.2} /></td>
            </tr>
            {TRAINING_RANGE.map((r) => {
              const v = r.key === 'slope'
                ? median(clean.map((h) => h.slope).filter((x) => x != null))
                : mean(clean.map((h) => h[r.key]));
              const inRange = v != null && v >= r.lo && v <= r.hi;
              return (
                <tr key={r.key}>
                  <td><b>Signal in model's range</b> · {r.label}</td>
                  <td>SAM40 training: {r.fmt(r.lo)} to {r.fmt(r.hi)}</td>
                  <td colSpan={2}>{r.key === 'slope' ? 'Median' : 'Mean'} over clean windows: <b>{v == null ? '—' : r.fmt(v)}</b></td>
                  <td>{v == null ? <Status kind="idle">No clean windows</Status>
                    : <Status kind={inRange ? 'good' : 'critical'}>{inRange ? 'within training range' : (v > r.hi ? 'above' : 'below') + ' training range'}</Status>}</td>
                </tr>
              );
            })}
            {[['theta', 'Theta share', 'up'], ['alpha', 'Alpha share', 'down'], ['ratio', 'Theta/alpha ratio', 'up']].map(([k, label, dir]) => (
              <tr key={k}>
                <td><b>2. Load effect</b> · {label}</td><td>{dir === 'up' ? 'Higher' : 'Lower'} under high load</td>
                <td>Low {k === 'ratio' ? num(byCond.low_load[k]) : pct(byCond.low_load[k])} <span className="muted">({byCond.low_load.n} win, {blockCounts.low_load} blocks)</span></td>
                <td>High {k === 'ratio' ? num(byCond.high_load[k]) : pct(byCond.high_load[k])} <span className="muted">({byCond.high_load.n} win, {blockCounts.high_load} blocks)</span></td>
                <td><Direction a={byCond.low_load[k]} b={byCond.high_load[k]} expect={dir} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption">
        Windows overlap (4 s, every 1 s), so window counts are not independent samples, and these are direction checks rather than statistical tests.
        For step 3, export the CSV and classify low vs high load with cross-validation split by condition block, not by window, and compare accuracy with chance (50%).
      </p>
    </Card>
  );
}
