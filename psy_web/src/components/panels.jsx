import { useMemo, useState } from 'react';
import { LineChart, fmtScore } from './charts';
import { requestRecalibration } from '../lib/firebase';
import { blockAligned, mindOrientedP } from '../lib/limits';
import {
  BATCH_SIZE, BIPOLAR_HIGHPASS_HZ, BLOCK_SEC, CLIP_UV, MQTT_TOPIC_EEG, MQTT_URL, POPULATION_HIGH_LOAD_P, RAW_WINDOW_SEC, SOURCE_FS, TARGET_FS, UV_PER_COUNT,
} from '../lib/config';
import {
  MODEL, explain, fmt, levelOf,
} from '../lib/model';


// ── small shared pieces ───────────────────────────────────────────
// A block judged against the calibrated limits every dashboard uses
// (lib/limits calibratedLimits; the Concept dashboard's Mind card): the model's
// own score vs the calibrated threshold, decided on the 0-1 fusion scale
// (own limit 0.50) so a score that falls under load is judged the right way.
// Without a calibration: the backend's effective threshold, else the population one.
export const blockScore = (b) => b?.raw_task_state_score ?? b?.task_state_score ?? null;
export function mindDecision(b, limits, profile) {
  const score = blockScore(b);
  const m = limits?.mind; const info = limits?.eegInfo;
  if (m) {
    const aligned = b ? blockAligned(b, info) : null;
    return { score, thr: m.threshold, baseline: m.baseline, personal: m.personal, calibrated: true,
      source: m.personal ? 'calibrated personal' : 'calibrated provisional',
      high: aligned == null ? null : aligned >= 0.5, level: levelOf(mindOrientedP(b, info), m.thresholdOriented) };
  }
  const thr = b?.effective_high_load_p ?? profile?.personal_high_load_p ?? POPULATION_HIGH_LOAD_P;
  const personal = profile?.personal_high_load_p != null && Math.abs(profile.personal_high_load_p - thr) < 1e-9;
  return { score, thr, baseline: null, personal, calibrated: false, source: personal ? 'personal' : 'population',
    high: score == null ? null : score >= thr, level: levelOf(score, thr) };
}

export function ago(ms, now) {
  if (ms == null) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const clock = (sec) => (sec == null ? '—' : new Date(sec * 1000).toLocaleTimeString());
const yesNo = (v) => (v == null ? '—' : v ? 'Yes' : 'No');

const STATUS_ICON = { good: '●', warning: '▲', critical: '■', idle: '○' };
export function Status({ kind = 'idle', children }) {
  return <span className={`status status-${kind}`}><i aria-hidden="true">{STATUS_ICON[kind]}</i>{children}</span>;
}

export function Card({ title, subtitle, right, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function KV({ rows }) {
  return (
    <dl className="kv">
      {rows.map(([k, v, hint]) => (
        <div key={k} title={hint}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

// ── header: data-source health + session picker ────────────────────
export function SourcesBar({ raw, health, picker, sessionData, now }) {
  const mqttKind = raw.conn.state === 'connected'
    ? (raw.stats.lastPacketAt && now - raw.stats.lastPacketAt < 5000 ? 'good' : 'warning')
    : raw.conn.state === 'error' ? 'critical' : 'warning';
  const mqttText = raw.conn.state === 'connected'
    ? (raw.stats.lastPacketAt && now - raw.stats.lastPacketAt < 5000 ? 'streaming' : 'connected, no samples')
    : raw.conn.state;
  const latest = sessionData.blocks[sessionData.blocks.length - 1];
  const fbFresh = latest?.timestamp_end && now / 1000 - latest.timestamp_end < BLOCK_SEC * 2 + 15;
  const apiKind = health.error ? 'critical' : health.data ? 'good' : 'idle';
  const inApi = picker.sessionId && health.data?.active_sessions?.includes(picker.sessionId);

  return (
    <div className="sources">
      <div className="source">
        <span className="source-name">Raw stream · MQTT</span>
        <Status kind={mqttKind}>{mqttText}</Status>
      </div>
      <div className="source">
        <span className="source-name">Results · Firebase</span>
        <Status kind={!picker.sessionId ? 'idle' : fbFresh ? 'good' : 'warning'}>
          {!picker.sessionId ? 'no session' : fbFresh ? 'live blocks' : latest ? `last block ${ago(latest.timestamp_end * 1000, now)}` : 'no blocks yet'}
        </Status>
      </div>
      <div className="source">
        <span className="source-name">EEG API · /health</span>
        <Status kind={apiKind}>
          {health.error ? health.error : health.data ? `${health.data.status} · ${health.latencyMs} ms` : 'checking…'}
        </Status>
      </div>
      <div className="source">
        <span className="source-name">Session on API</span>
        <Status kind={!picker.sessionId ? 'idle' : inApi ? 'good' : 'warning'}>
          {!picker.sessionId ? '—' : inApi ? 'calibrated & active' : 'not held by server'}
        </Status>
      </div>
    </div>
  );
}

export function SessionPicker({ picker }) {
  return (
    <div className="picker">
      <label className="toggle">
        <input type="checkbox" checked={picker.follow} onChange={(e) => picker.setFollow(e.target.checked)} />
        Follow live session
      </label>
      <label>
        <span>User</span>
        <select value={picker.userId || ''} onChange={(e) => picker.choose({ userId: e.target.value || null, sessionId: null })}>
          <option value="">— select —</option>
          {[...new Set([...(picker.userId ? [picker.userId] : []), ...picker.users])].map((u) => (
            <option key={u} value={u}>{u}{u === picker.liveUser ? ' (live)' : ''}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Session</span>
        <select value={picker.sessionId || ''} onChange={(e) => picker.choose({ userId: picker.userId, sessionId: e.target.value || null })}>
          <option value="">— select —</option>
          {[...new Set([...(picker.sessionId ? [picker.sessionId] : []), ...picker.sessions])].map((s) => (
            <option key={s} value={s}>{s}{s === picker.liveSession ? ' (live)' : ''}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

// ── pipeline overview: each stage with its own live evidence ───────
export function PipelineStrip({ raw, health, sessionData, picker, now, limits }) {
  const latest = sessionData.blocks[sessionData.blocks.length - 1];
  const hbAge = raw.status.heartbeatAt ? now - raw.status.heartbeatAt : null;
  const drdy = raw.status.heartbeat?.drdy_ok;
  const pktFresh = raw.stats.lastPacketAt && now - raw.stats.lastPacketAt < 5000;
  const nFeat = latest?.features_eeg?.bipolar ? Object.values(latest.features_eeg.bipolar).filter((v) => v != null).length : 0;
  const ex = explain(latest?.features_eeg?.bipolar);
  const dec = mindDecision(latest, limits);

  const stages = [
    {
      name: 'Wearable 02', detail: 'ADS1292R · T7–T8 bipolar · 250 SPS',
      kind: hbAge == null ? 'idle' : hbAge < 12000 && drdy ? 'good' : 'warning',
      value: hbAge == null ? 'no heartbeat' : `DRDY ${drdy ? 'ok' : 'stopped'} · ${ago(raw.status.heartbeatAt, now)}`,
    },
    {
      name: 'MQTT (EMQX)', detail: `up to ${BATCH_SIZE} samples / message`,
      kind: pktFresh ? 'good' : raw.conn.state === 'connected' ? 'warning' : 'idle',
      value: raw.rate ? `${raw.rate.toFixed(0)} samples/s` : 'idle',
    },
    {
      name: 'Bridge → API', detail: `${BLOCK_SEC}s blocks → /calibrate, /predict`,
      kind: health.data && picker.sessionId && health.data.active_sessions?.includes(picker.sessionId) ? 'good' : health.data ? 'warning' : 'idle',
      value: health.data ? `${health.data.active_sessions?.length ?? 0} active session(s)` : (health.error || '…'),
    },
    {
      name: 'Preprocess', detail: `detrend · despike · ${TARGET_FS} Hz · ${BIPOLAR_HIGHPASS_HZ}–45 Hz · ±${CLIP_UV} µV`,
      kind: latest?.wave_uv ? 'good' : 'idle',
      value: latest?.wave_uv ? `${latest.wave_uv.length}-pt preview` : '—',
    },
    {
      name: 'Quality gate', detail: 'amplitude · SNR · Itakura · delta plausibility',
      kind: !latest ? 'idle' : latest.eeg_quality_flag ? 'good' : 'warning',
      value: !latest ? '—' : `${fmt(latest.eeg_quality_score, 0)}/100 · ${latest.eeg_quality_flag ? 'trusted' : 'rejected'}`,
    },
    {
      name: 'Features', detail: '29 bipolar spectral/Hjorth/time',
      kind: nFeat === 29 ? 'good' : nFeat ? 'warning' : 'idle',
      value: nFeat ? `${nFeat}/29 extracted` : '—',
    },
    {
      name: 'Model', detail: `LogReg · ${MODEL.model_version} · AUC ${latest?.model_accuracy ?? 0.706}`,
      kind: ex ? 'good' : 'idle',
      value: ex ? `raw p = ${ex.rawScore.toFixed(3)}` : '—',
    },
    {
      name: 'Decision', detail: `score vs ${dec.calibrated ? 'the calibrated' : 'the personal/population'} threshold`,
      kind: dec.score == null ? 'idle' : dec.high ? 'critical' : 'good',
      value: dec.score == null ? (latest?.skipped ? 'skipped' : '—')
        : `${fmtScore(dec.score)} ${dec.high ? 'above' : 'below'} ${fmtScore(dec.thr)}`,
    },
  ];

  return (
    <ol className="pipeline" aria-label="Processing pipeline">
      {stages.map((s, i) => (
        <li key={s.name} className={`stage stage-${s.kind}`}>
          <span className="stage-step">{i + 1}</span>
          <strong>{s.name}</strong>
          <span className="stage-detail">{s.detail}</span>
          <Status kind={s.kind}>{s.value}</Status>
        </li>
      ))}
    </ol>
  );
}

// ── 1. raw reading ─────────────────────────────────────────────────
export function RawPanel({ raw, now }) {
  const [unit, setUnit] = useState('uv');
  const [removeDc, setRemoveDc] = useState(true);
  const { samples, stats } = raw;

  const { points, mean, min, max } = useMemo(() => {
    if (!samples.length) return { points: [], mean: null, min: null, max: null };
    const t1 = samples[samples.length - 1].millis;
    const vals = samples.map((s) => (unit === 'uv' ? s.uv : s.code));
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const off = removeDc ? m : 0;
    let mn = Infinity; let mx = -Infinity;
    const pts = samples.map((s, i) => {
      const y = vals[i] - off;
      if (y < mn) mn = y; if (y > mx) mx = y;
      return { x: (s.millis - t1) / 1000, y, code: s.code, uv: s.uv, millis: s.millis };
    });
    return { points: pts, mean: m, min: mn, max: mx };
  }, [samples, unit, removeDc]);

  const last = samples[samples.length - 1];
  const unitLabel = unit === 'uv' ? 'µV' : 'counts';
  const hb = raw.status.heartbeat;

  return (
    <Card
      title="Raw reading"
      subtitle={`Unfiltered T7–T8 differential straight from the device, last ${RAW_WINDOW_SEC}s (${MQTT_TOPIC_EEG})`}
      right={(
        <div className="seg">
          <button type="button" className={unit === 'uv' ? 'on' : ''} onClick={() => setUnit('uv')}>µV</button>
          <button type="button" className={unit === 'code' ? 'on' : ''} onClick={() => setUnit('code')}>ADC code</button>
          <label className="toggle small">
            <input type="checkbox" checked={removeDc} onChange={(e) => setRemoveDc(e.target.checked)} />
            Remove DC
          </label>
        </div>
      )}
    >
      <div className="stats">
        <Stat label="Latest" value={last ? (unit === 'uv' ? `${last.uv.toFixed(1)} µV` : last.code.toLocaleString()) : '—'}
          sub={last ? `code ${last.code.toLocaleString()} × ${UV_PER_COUNT} µV` : undefined} />
        <Stat label="Sample rate" value={raw.rate ? `${raw.rate.toFixed(1)} Hz` : '—'} sub={`nominal ${SOURCE_FS} Hz`} />
        <Stat label="Packets" value={stats.packets.toLocaleString()} sub={`${stats.samples.toLocaleString()} samples`} />
        <Stat label="Gaps" value={stats.gaps.toLocaleString()} sub={`~${stats.missing.toLocaleString()} samples missing`} />
        <Stat label="Last packet" value={ago(stats.lastPacketAt, now)} sub={stats.malformed ? `${stats.malformed} malformed` : 'all parsed'} />
        <Stat label="Device uptime" value={hb ? `${Math.floor(hb.uptime_ms / 60000)}m ${Math.floor(hb.uptime_ms / 1000) % 60}s` : '—'}
          sub={raw.status.online?.mode || 'heartbeat every 5s'} />
        <Stat label="Link (last 5 s)"
          value={hb?.rssi == null ? '—' : `${hb.rssi} dBm`}
          sub={hb?.rssi == null ? 'needs the diagnostics firmware'
            : `${hb.rssi < -75 ? 'weak Wi-Fi · ' : ''}glitches ${hb.glitches} · missed DRDY ${hb.missed_drdy} · publish retries ${hb.pub_drops}`
              + (hb.queued == null ? '' : ` · queued ${hb.queued}${hb.queue_drops ? ` · LOST ${hb.queue_drops} batches` : ''}`)} />
        <Stat label="Electrodes (lead-off)"
          value={hb?.loff_in2p == null ? '—' : (hb.loff_in2p > 0.5 || hb.loff_in2n > 0.5 || hb.loff_rld > 0.5)
            ? <Status kind="critical">{[hb.loff_in2p > 0.5 && 'IN2P', hb.loff_in2n > 0.5 && 'IN2N', hb.loff_rld > 0.5 && 'bias']
              .filter(Boolean).join(' + ')} off</Status>
            : <Status kind="good">{hb.loff_rld == null ? 'both on' : 'all 3 on'}</Status>}
          sub={hb?.loff_in2p == null ? 'needs the lead-off firmware'
            : `off: IN2P ${Math.round(hb.loff_in2p * 100)}% · IN2N ${Math.round(hb.loff_in2n * 100)}%`
              + (hb.loff_rld == null ? '' : ` · bias ${Math.round(hb.loff_rld * 100)}%`)
              + ' of last 5 s. Detects fully-off electrodes only, not poor contact.'} />
      </div>
      <LineChart
        points={points}
        height={220}
        ariaLabel="Raw EEG signal"
        xFormat={(v) => `${v.toFixed(0)}s`}
        yFormat={(v) => (unit === 'uv' ? v.toFixed(Math.abs(v) < 10 ? 1 : 0) : Math.round(v).toLocaleString())}
        emptyText={raw.conn.state === 'connected'
          ? 'Connected to the broker. Waiting for wearable02 to publish (is it powered and on WiFi?)'
          : `Connecting to ${MQTT_URL}…`}
        tooltip={(p) => (
          <>
            <b>{p.uv.toFixed(2)} µV</b>
            <span>code {p.code.toLocaleString()}</span>
            <span>device t = {p.millis.toLocaleString()} ms</span>
          </>
        )}
      />
      <p className="caption">
        {mean != null && <>Window mean {unit === 'uv' ? `${mean.toFixed(1)} µV` : Math.round(mean).toLocaleString()}{removeDc ? ' (subtracted)' : ''} · range {fmt(min, 1)} to {fmt(max, 1)} {unitLabel}. </>}
        This is the raw ADC signal before any of the backend preprocessing.
      </p>
      {stats.lastPayload && (
        <details className="payload">
          <summary>Last MQTT payload (wire format <code>millis,code;…</code>)</summary>
          <code>{stats.lastPayload}</code>
        </details>
      )}
    </Card>
  );
}

// ── 3. calibration ─────────────────────────────────────────────────
// Recalibrate button: writes eeg_recalibration/{session}; the EEG bridge
// picks it up within ~10 s and captures fresh rest blocks (see
// requestRecalibration()). Only offered for the session the bridge is
// actually serving -- a request for any other session would never be seen.
const RECAL_TEXT = {
  requested: 'Requested: waiting for the bridge (checks every 10 s)',
  capturing: 'Recalibrating: sit still and relax',
  done: 'Recalibration finished',
  superseded: 'Cancelled: the app started a new session',
};
const RECAL_STALE_SEC = 120;   // "requested" this long with no pickup = bridge isn't running

// ── 6. API / sources detail ────────────────────────────────────────
