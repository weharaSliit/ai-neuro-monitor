import { useMemo, useState } from 'react';
import { BarList, LineChart, ScoreGauge } from './charts';
import { Card, KV, SessionPicker, Stat, Status, ago } from './panels';
import useRingStream from '../hooks/useRingStream';
import { useHealth } from '../hooks/useData';
import { usePhysioData, usePhysioPicker } from '../hooks/usePhysio';
import useCalibratedLimits from '../hooks/useCalibratedLimits';
import LimitsStrip from './LimitsStrip';
import {
  CALIBRATION_HARD_AGE_DAYS, CALIBRATION_SOFT_AGE_DAYS, GSR_CAL, MQTT_TOPIC_RING, MQTT_URL,
  PERSONAL_THRESHOLD_MIN_SEPARATION, PHYSIO_API_BASE, RAW_DECISION_THRESHOLD, RING_MSG_HZ, RING_SLIDE_SEC,
  RING_WINDOW_SEC, STRESS_DECISION_THRESHOLD,
} from '../lib/config';
import { FEATURE_GROUPS, FEATURE_HINTS, effectiveThreshold, normalised, parseNaive } from '../lib/ring';
import { fmt } from '../lib/model';

const clockMs = (ms) => (ms == null ? '—' : new Date(ms).toLocaleTimeString());
const pct = (v, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const yesNo = (v) => (v == null ? '—' : v ? 'Yes' : 'No');
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

const LEVEL_TEXT = { low: 'Calm', moderate: 'Elevated', high: 'Stressed' };
function stressLevel(p, thr) {
  if (p == null || thr == null) return null;
  if (p >= thr) return 'high';
  return p >= thr - 0.1 ? 'moderate' : 'low';
}

// ── data-source health ─────────────────────────────────────────────
function PhysioSources({ ring, data, health, picker, now }) {
  const live = ring.stats.lastPacketAt && now - ring.stats.lastPacketAt < 3000;
  const ringKind = ring.conn.state === 'connected' ? (live ? 'good' : 'warning') : ring.conn.state === 'error' ? 'critical' : 'warning';
  const seen = parseNaive(data.device?.last_seen, now);
  const devFresh = seen && now - seen < 15000;
  const latest = data.windows[data.windows.length - 1];
  const winFresh = latest?.t && now - latest.t < (RING_SLIDE_SEC * 3 + 15) * 1000;
  return (
    <div className="sources">
      <div className="source">
        <span className="source-name">Raw stream · MQTT</span>
        <Status kind={ringKind}>{ring.conn.state === 'connected' ? (live ? 'streaming' : 'connected, no messages') : ring.conn.state}</Status>
      </div>
      <div className="source">
        <span className="source-name">Ring · device heartbeat</span>
        <Status kind={!seen ? 'idle' : devFresh ? (data.device?.finger_detected ? 'good' : 'warning') : 'warning'}>
          {!seen ? 'never seen' : devFresh ? (data.device?.finger_detected ? 'online · finger on' : 'online · no finger') : `last seen ${ago(seen, now)}`}
        </Status>
      </div>
      <div className="source">
        <span className="source-name">Results · Firebase</span>
        <Status kind={!picker.sessionId ? 'idle' : winFresh ? 'good' : latest ? 'warning' : 'idle'}>
          {!picker.sessionId ? 'no session' : winFresh ? 'live windows' : latest ? `last window ${ago(latest.t, now)}` : 'no windows yet'}
        </Status>
      </div>
      <div className="source">
        <span className="source-name">Ring API · /health</span>
        <Status kind={health.error ? 'critical' : health.data ? 'good' : 'idle'}>
          {health.error ? health.error : health.data ? `${health.data.status} · ${health.latencyMs} ms` : 'checking…'}
        </Status>
      </div>
    </div>
  );
}

// ── 1. live raw signals ───────────────────────────────────────────
function RawRingPanel({ ring, now }) {
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
    <Card title="Live ring signals" subtitle={`Last ${RING_WINDOW_SEC}s straight from wearable 01 over MQTT (raw readings are never stored)`}
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
      <p className="caption">
        The bridge sends the last {RING_WINDOW_SEC}s to the model every {RING_SLIDE_SEC}s. Windows with too much movement or too few clean beats are rejected and never stored.
      </p>
    </Card>
  );
}

// ── 2. stress prediction ──────────────────────────────────────────
function StressPanel({ data, thr, now }) {
  const ws = data.windows;
  const shown = ws[ws.length - 1];
  if (!shown) {
    return (
      <Card title="Stress prediction" subtitle="XGBoost Normal/Stress model on 60s of HRV, skin conductance and movement">
        <div className="chart-empty" style={{ height: 200 }}>
          No stored windows for this session yet. The bridge posts every {RING_SLIDE_SEC}s once the user is calibrated and the ring has a stable reading.
        </div>
      </Card>
    );
  }
  const level = stressLevel(shown.prob_stress, thr.value);
  const q = shown.quality;
  const points = ws.map((w) => ({ x: w.t, y: w.prob_stress ?? null, w }));
  return (
    <Card title="Stress prediction" subtitle="XGBoost Normal/Stress model on 60s of HRV, skin conductance and movement"
      right={<span className="muted">window {shown.window_idx} · {ago(shown.t, now)}</span>}>
      <div className="task-grid">
        <div className="gauge-box">
          <ScoreGauge value={shown.prob_stress} threshold={thr.value} level={level} label="prob_stress" />
          <div className={`level-pill lvl-${level || 'none'}`}>{level ? LEVEL_TEXT[level] : 'No result'}</div>
        </div>
        <KV rows={[
          ['Model label', `${shown.prediction ?? '—'} · ${shown.label || '—'}`, 'app.py: prob_stress > effective threshold'],
          ['prob_stress / prob_normal', `${fmt(shown.prob_stress, 3)} / ${fmt(shown.prob_normal, 3)}`],
          ['Effective threshold', `${fmt(thr.value, 4)} (${thr.source})`],
          ['Confidence', pct(q?.confidence), 'max(prob_normal, prob_stress)'],
          ['Signal quality', q ? `${pct(q.signal_quality)}` : '—', 'Mean of beat density, beat stability, GSR contact and stillness'],
          ['Usable for retraining', yesNo(q?.eligible_for_retrain)],
          ['Baseline ratio', fmt(shown.baseline_ratio, 2), 'Written by the deployed API'],
          ['Model', 'XGBoost binary · LOSO accuracy 0.851'],
        ]} />
        <div className="alerts">
          <h3>Flags</h3>
          <div className="alert-row">
            <Status kind={shown.trending_toward_stress ? 'warning' : 'idle'}>Trending toward stress: {shown.trending_toward_stress ? 'ON' : 'off'}</Status>
          </div>
          <div className="alert-row">
            <Status kind={shown.baseline_stale ? 'warning' : 'good'}>Baseline {shown.baseline_stale ? 'stale' : 'current'}</Status>
          </div>
          <div className="alert-row">
            <Status kind={q?.signal_quality == null ? 'idle' : q.signal_quality >= 0.7 ? 'good' : 'warning'}>
              Signal {q?.signal_quality == null ? 'unknown' : q.signal_quality >= 0.7 ? 'good' : 'weak'}
            </Status>
          </div>
          <p className="caption">&quot;Trending&quot; comes from feature direction over the last few windows (predictor.py StressStateMachine), separate from the label.</p>
        </div>
      </div>
      <h3 className="section-title">prob_stress per window</h3>
      <LineChart points={points} height={200} yDomain={[0, 1]} dots ariaLabel="prob_stress per window"
        refLines={[{ y: thr.value, label: `threshold ${thr.value.toFixed(2)}` }]}
        xFormat={clockMs} yFormat={(v) => v.toFixed(2)}
        tooltip={({ w }) => (
          <>
            <b>prob_stress {fmt(w.prob_stress, 3)}</b>
            <span>window {w.window_idx} · {clockMs(w.t)}</span>
            <span>{w.label}{w.trending_toward_stress ? ' · trending' : ''}</span>
            {w.quality && <span>quality {pct(w.quality.signal_quality)}</span>}
          </>
        )} />
      <p className="caption">The threshold line is the user&apos;s current one; earlier windows may have been judged against an older one.</p>
    </Card>
  );
}

// ── 3. latest window's processed signals ───────────────────────────
function WavePanel({ data }) {
  const w = data.windows[data.windows.length - 1];
  const gsr = Array.isArray(w?.wave_gsr) ? w.wave_gsr : [];
  const ibi = Array.isArray(w?.ibi_sequence) ? w.ibi_sequence : [];
  return (
    <Card title="Signals the model saw" subtitle={w ? `Window ${w.window_idx} (${clockMs(w.t)}): processed, not raw` : 'Latest window'}>
      <div className="grid-2">
        <div>
          <h3>Filtered skin conductance (µS)</h3>
          <LineChart points={gsr.map((y, i) => ({ x: (i / Math.max(1, gsr.length - 1)) * RING_WINDOW_SEC, y }))} height={170}
            xFormat={(v) => `${Math.round(v)}s`} yFormat={(v) => v.toFixed(2)} ariaLabel="Filtered GSR for the latest window"
            emptyText="No GSR wave stored for this window" />
        </div>
        <div>
          <h3>Beat-to-beat intervals (ms)</h3>
          <LineChart points={ibi.map((y, i) => ({ x: i + 1, y }))} height={170} dots
            xFormat={(v) => `#${Math.round(v)}`} yFormat={(v) => v.toFixed(0)} ariaLabel="IBI sequence for the latest window"
            emptyText="No IBI sequence stored for this window" />
        </div>
      </div>
      <p className="caption">Tachogram: each point is one heartbeat interval. Steady small swings = healthy variability; flat or jumpy = stress or a poor PPG reading.</p>
    </Card>
  );
}

// ── 4. calibration ────────────────────────────────────────────────
function CalibrationPanel({ data, thr, now }) {
  const b = data.baseline;
  const t = data.thresholds;
  const updated = b?.updated_at ? Date.parse(b.updated_at) : null;
  const ageDays = updated ? (now - updated) / 86400000 : null;
  const ageKind = ageDays == null ? 'critical' : ageDays > CALIBRATION_HARD_AGE_DAYS ? 'critical' : ageDays > CALIBRATION_SOFT_AGE_DAYS ? 'warning' : 'good';
  const rest = Array.isArray(t?.resting_scores) ? t.resting_scores : [];
  const restMean = mean(rest);
  return (
    <Card title="Calibration" subtitle="Personal resting baseline and stress threshold (per user, not per session)">
      <div className="grid-2">
        <div>
          <KV rows={[
            ['Personal baseline', <Status key="b" kind={ageKind}>{!b ? 'none: calibrate first' : `set ${ago(updated, now)}`}</Status>],
            ['Renewal', ageDays == null ? '—' : ageDays > CALIBRATION_HARD_AGE_DAYS ? 'required (over 30 days)' : ageDays > CALIBRATION_SOFT_AGE_DAYS ? 'suggested (over 7 days)' : 'not needed yet'],
            ['Baseline features', b ? Object.keys(b).filter((k) => b[k]?.mean != null).length : '—'],
            ['Sessions since baseline', b?.session_count ?? '—'],
            ['Resting scores', rest.length ? rest.map((v) => fmt(v, 3)).join(', ') : 'none'],
            ['Resting mean prob_stress', fmt(restMean, 3)],
            ['Calibrated baseline', thr.baseline == null ? '—' : `${fmt(thr.baseline, 4)} (median of the resting scores)`],
            ['Personal threshold', t?.personal_stress_threshold != null ? `${fmt(t.personal_stress_threshold, 4)} (set ${t.threshold_updated_at ? ago(Date.parse(t.threshold_updated_at), now) : '—'})` : 'not set'],
            ['Threshold in use', `${fmt(thr.value, 4)} (${thr.source})`],
          ]} />
        </div>
        <div>
          <h3>How the threshold is chosen</h3>
          <ol className="sources-list">
            <li><b>Personal</b>: midpoint of the user&apos;s resting and task prob_stress means, only if they differ by at least {PERSONAL_THRESHOLD_MIN_SEPARATION} (onboarding task).</li>
            <li><b>Population</b> {STRESS_DECISION_THRESHOLD}: baseline-normalised model, from pooled LOSO on WESAD.</li>
            <li><b>Raw model</b> {RAW_DECISION_THRESHOLD}: only before a baseline exists; the bridge doesn&apos;t post windows for uncalibrated users.</li>
          </ol>
          <p className="caption">
            Features are compared with this baseline before the model sees them: skin-conductance features as a ratio to the baseline mean,
            heart and movement features as a z-score. Renewal follows the shared {CALIBRATION_SOFT_AGE_DAYS}/{CALIBRATION_HARD_AGE_DAYS}-day rule.
          </p>
        </div>
      </div>
    </Card>
  );
}

// ── 5. features ───────────────────────────────────────────────────
function FeaturesPanel({ data }) {
  const ws = data.windows;
  const w = ws[ws.length - 1];
  const b = data.baseline;
  const feats = w?.features || {};
  const keys = Object.keys(feats);
  const [pick, setPick] = useState('SCL_mean');
  const pickKey = keys.includes(pick) ? pick : keys[0];
  const trend = useMemo(() => ws.map((x) => ({ x: x.t, y: x.features?.[pickKey] ?? null })), [ws, pickKey]);
  if (!w) return null;
  const grouped = FEATURE_GROUPS.map((g) => ({ ...g, keys: keys.filter(g.test).sort() }));
  const other = keys.filter((k) => !FEATURE_GROUPS.some((g) => g.test(k)));
  if (other.length) grouped.push({ name: 'Other', keys: other.sort() });
  const devRows = keys.map((k) => {
    const n = normalised(k, feats[k], b?.[k]);
    const dev = n.kind === 'z' ? Math.abs(n.v) : n.kind === 'ratio' ? Math.abs(n.v - 1) * 3 : null;   // ratio 1.33 ≈ 1 SD
    return { k, n, dev };
  }).filter((r) => r.dev != null).sort((a, c) => c.dev - a.dev).slice(0, 8);

  return (
    <Card title="Extracted features" subtitle={`${keys.length} features from window ${w.window_idx}, compared with the personal baseline`}>
      <div className="grid-2">
        <div className="table-scroll">
          <table className="feat-table">
            <thead><tr><th>Feature</th><th>Value</th><th>Baseline mean ± sd</th><th>Model input</th></tr></thead>
            {grouped.filter((g) => g.keys.length).map((g) => (
              <tbody key={g.name}>
                <tr><td colSpan={4} className="muted"><b>{g.name}</b></td></tr>
                {g.keys.map((k) => {
                  const base = b?.[k]; const n = normalised(k, feats[k], base);
                  return (
                    <tr key={k} title={FEATURE_HINTS[k]}>
                      <td>{k}</td>
                      <td className="num">{fmt(feats[k], 3)}</td>
                      <td className="num">{base ? `${fmt(base.mean, 3)} ± ${fmt(base.std, 3)}` : '—'}</td>
                      <td className="num">{n.v == null ? '—' : n.kind === 'z' ? `z ${n.v >= 0 ? '+' : ''}${n.v.toFixed(2)}` : n.kind === 'ratio' ? `×${n.v.toFixed(2)}` : `Δ ${fmt(n.v, 3)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
        <div>
          <h3>Furthest from baseline</h3>
          <BarList rows={devRows.map((r) => ({
            label: r.k, value: r.dev, hint: FEATURE_HINTS[r.k],
            sub: r.n.kind === 'z' ? ` z ${r.n.v.toFixed(1)}` : ` ×${r.n.v.toFixed(2)}`,
          }))} format={(v) => v.toFixed(1)} />
          <p className="caption">Heart and movement: |z|. Skin conductance: |ratio − 1| × 3, so ×1.33 reads like one standard deviation.</p>
          <h3 className="section-title">
            Feature over the session{' '}
            <select value={pickKey} onChange={(e) => setPick(e.target.value)} aria-label="Feature to plot">
              {[...keys].sort().map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </h3>
          <LineChart points={trend} height={170} dots xFormat={clockMs} yFormat={(v) => fmt(v, 3)} ariaLabel={`${pickKey} per window`}
            refLines={b?.[pickKey]?.mean != null ? [{ y: b[pickKey].mean, label: 'baseline' }] : []} />
        </div>
      </div>
    </Card>
  );
}

// ── 6. window log ─────────────────────────────────────────────────
function WindowLog({ data }) {
  const rows = [...data.windows].reverse().slice(0, 40);
  return (
    <Card title="Window log" subtitle={`One row per stored window (newest first, last 40). Session window count: ${data.session?.window_count ?? '—'}`}>
      {!rows.length ? <p className="muted">No windows yet.</p> : (
        <div className="table-scroll">
          <table className="log">
            <thead>
              <tr><th>#</th><th>Time</th><th>prob_stress</th><th>Label</th><th>Confidence</th><th>Quality</th><th>HR</th><th>SCL µS</th><th>SCRs</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w._key}>
                  <td className="num">{w.window_idx}</td>
                  <td>{clockMs(w.t)}</td>
                  <td className="num">{fmt(w.prob_stress, 3)}</td>
                  <td>{w.label || '—'}</td>
                  <td className="num">{pct(w.quality?.confidence)}</td>
                  <td>
                    <Status kind={w.quality?.signal_quality == null ? 'idle' : w.quality.signal_quality >= 0.7 ? 'good' : 'warning'}>{pct(w.quality?.signal_quality)}</Status>
                  </td>
                  <td className="num">{fmt(w.features?.MeanHR, 0)}</td>
                  <td className="num">{fmt(w.features?.SCL_mean, 2)}</td>
                  <td className="num">{fmt(w.features?.SCR_count, 1)}</td>
                  <td>{[w.trending_toward_stress && 'trending', w.baseline_stale && 'stale baseline', w.quality?.eligible_for_retrain && 'retrain-ok'].filter(Boolean).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── 7. API and sources ────────────────────────────────────────────
function ApiPanel({ health, picker, ring, now }) {
  const u = picker.userId || '{uid}'; const s = picker.sessionId || '{sid}';
  return (
    <Card title="API and data sources" subtitle="What this page reads. It never writes anything.">
      <div className="api-grid">
        <div>
          <h3>GET {PHYSIO_API_BASE}/health</h3>
          <p className="caption">{health.at ? `Checked ${ago(health.at, now)}` : 'Checking…'}{health.latencyMs != null ? ` · ${health.latencyMs} ms` : ''}</p>
          <pre className="json">{health.data ? JSON.stringify(health.data, null, 2) : health.error ? `Unreachable: ${health.error}\n(Render free tier can take ~30s to cold-start)` : '…'}</pre>
          <h3>Latest MQTT message</h3>
          <pre className="json">{ring.stats.lastPayload || '…'}</pre>
        </div>
        <div>
          <h3>Sources</h3>
          <ul className="sources-list">
            <li><b>Raw readings</b>: MQTT <code>{MQTT_TOPIC_RING}</code> via <code>{MQTT_URL}</code>. Not stored in Firebase.</li>
            <li><b>Per-window results</b>: <code>physiological/predictions/{u}/{s}</code> and <code>prediction_quality/{u}/{s}</code>, written by <code>/predict</code></li>
            <li><b>Calibration</b>: <code>physiological/baselines/{u}</code>, <code>personal_thresholds/{u}</code></li>
            <li><b>Device</b>: <code>physiological/devices/wearable01</code> (bridge heartbeat, every 5s)</li>
            <li><b>Live pointer</b>: <code>fusion_en/current_user_id</code> and <code>current_session_id</code>, which the ring bridge follows</li>
            <li><b>Into fusion</b>: each window is also written to <code>fusion_en/{u}/{s}</code> as <code>prob_hrv_gsr</code>; see the fusion engine monitor</li>
          </ul>
          <h3>Signal chain</h3>
          <p className="caption">
            MAX30102 PPG (beat intervals), Grove GSR and MPU6050 on an ESP32 → one JSON message every 200 ms → EMQX → mqtt_bridge.py keeps the last {RING_WINDOW_SEC}s
            and posts every {RING_SLIDE_SEC}s → POST /predict → movement and beat-quality checks → 23 features → normalised against the personal baseline
            → XGBoost → prob_stress vs threshold → Firebase.
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function PhysioView({ now, onBack, openFusion }) {
  const picker = usePhysioPicker();
  const data = usePhysioData(picker.userId, picker.sessionId);
  const ring = useRingStream();
  const health = useHealth(30000, PHYSIO_API_BASE);
  // The calibrated baseline / threshold every dashboard uses (lib/limits calibratedLimits);
  // without a ring calibration, the stored personal or population threshold.
  const limits = useCalibratedLimits(picker.userId, picker.sessionId);
  const fallback = effectiveThreshold(data.thresholds, data.baseline);
  const body = limits.body;
  const thr = body?.threshold != null
    ? { value: body.threshold, source: body.personal ? 'calibrated personal midpoint' : 'population (calibration not separated)', baseline: body.baseline }
    : { ...fallback, baseline: null };
  return (
    <div className="page">
      <header className="top">
        <div>
          <div className="view-links">
            <button type="button" className="back-link" onClick={onBack}>← Wearable 02 EEG monitor</button>
            <button type="button" className="back-link" onClick={openFusion}>Fusion engine monitor →</button>
          </div>
          <p className="eyebrow">MindPulse · physiological component · technical view</p>
          <h1>Wearable 01 HRV + GSR monitor</h1>
          <p className="muted">
            Live heart-rate variability, skin conductance and movement from the ring, through calibration, feature extraction and the stress model.
            Read-only: this page doesn&apos;t write to Firebase or the API.
          </p>
        </div>
        <SessionPicker picker={picker} />
      </header>

      <LimitsStrip limits={limits} />
      <PhysioSources ring={ring} data={data} health={health} picker={picker} now={now} />
      {data.loading ? <p className="muted">Loading ring windows…</p> : null}
      <RawRingPanel ring={ring} now={now} />
      <StressPanel data={data} thr={thr} now={now} />
      <WavePanel data={data} />
      <CalibrationPanel data={data} thr={thr} now={now} />
      <FeaturesPanel data={data} />
      <WindowLog data={data} />
      <ApiPanel health={health} picker={picker} ring={ring} now={now} />

      <footer className="muted foot">
        prob_stress estimates autonomic arousal from the body; the fusion engine combines it with the EEG cognitive-load score.
      </footer>
    </div>
  );
}
