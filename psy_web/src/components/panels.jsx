import { useMemo, useState } from 'react';
import {
  BarList, LineChart, ScaleSwitch, ScoreGauge, autoScoreScale, fmtScore, log10Safe,
} from './charts';
import { useFirebaseValue } from '../hooks/useData';
import { requestRecalibration } from '../lib/firebase';
import { blockAligned, mindOrientedP } from '../lib/limits';
import {
  BATCH_SIZE, BIPOLAR_HIGHPASS_HZ, BLOCK_SEC, CLIP_UV, EEG_API_BASE, MQTT_TOPIC_EEG, MQTT_TOPIC_STATUS,
  CALIBRATION_SETTLE_SEC, MIN_USABLE_REST_BLOCKS, MQTT_URL, N_CALIBRATION_BLOCKS, POPULATION_HIGH_LOAD_P, RAW_WINDOW_SEC, SOURCE_FS, TARGET_FS,
  TASK_STATE_LABEL_THRESHOLD, UV_PER_COUNT,
} from '../lib/config';
import {
  BANDS, FEATURE_GROUPS, LEVEL_WORDS, MODEL, explain, fmt, levelOf, modelLabelText, previewGain, previewScore,
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

// ── 2. task state ──────────────────────────────────────────────────
export function TaskStatePanel({ sessionData, profile, now, limits }) {
  const { blocks } = sessionData;
  const latest = blocks[blocks.length - 1];
  const lastScored = [...blocks].reverse().find((b) => b.task_state_score != null);
  const shown = latest && !latest.skipped ? latest : lastScored;
  // Calibrated baseline / threshold (the same on every dashboard), see mindDecision().
  const dec = mindDecision(shown, limits, profile);
  const { thr, level } = dec;

  // Chart scale: 'log' is picked automatically when every score is tiny
  // (wearable02 often sits around 0.001, a flat line on a 0..1 axis).
  const [scalePick, setScalePick] = useState(null);
  const autoScale = autoScoreScale(blocks.map(blockScore));
  const scale = scalePick || autoScale;
  const scored = blocks.filter((b) => blockScore(b) != null);
  const muRest = dec.baseline ?? sessionData.calibration?.mu_rest;
  const chart = useMemo(() => {
    // x = block number, not time: a re-run can overwrite an early window key
    // with a later timestamp, so time isn't monotonic across windows.
    const base = (f) => blocks.map((b) => ({ x: b.window, y: f(b), b }));
    const refs = [{ y: thr, label: `threshold ${fmtScore(thr)}` }, { y: TASK_STATE_LABEL_THRESHOLD, label: 'label cut 0.5' }];
    const restLabel = dec.calibrated ? `baseline ${fmtScore(muRest)}` : 'own rest';
    if (scale === 'log') {
      return {
        points: base((b) => log10Safe(blockScore(b))),
        refLines: [...refs, ...(muRest > 0 ? [{ y: muRest, label: restLabel }] : [])].map((r) => ({ ...r, y: Math.log10(r.y) })),
        yFormat: (v) => fmtScore(10 ** v),
      };
    }
    if (scale === 'zoom') {
      return { points: base(blockScore), refLines: [], yFormat: fmtScore };
    }
    if (scale === 'z') {
      return {
        points: base((b) => b.task_state_z ?? null),
        refLines: [{ y: 0.84, label: 'high load z 0.84' }, { y: 0, label: 'own rest z 0' }],
        yFormat: (v) => v.toFixed(2),
      };
    }
    return { points: base(blockScore), refLines: [...refs, ...(dec.calibrated && muRest != null ? [{ y: muRest, label: restLabel }] : [])],
      yDomain: [0, 1], yFormat: (v) => v.toFixed(2) };
  }, [blocks, scale, thr, muRest, dec.calibrated]);
  const range = scored.length
    ? [Math.min(...scored.map(blockScore)), Math.max(...scored.map(blockScore))] : null;

  // Preview of blocks stored before this session had an amplitude gain:
  // what the backend scores them at the session's gain (model.js previewGain).
  const pg = useMemo(() => previewGain(sessionData), [sessionData]);
  const preview = useMemo(() => {
    if (!pg) return null;
    const pts = blocks.map((b) => ({ x: b.window, y: previewScore(b, pg.gain), b }));
    const vals = pts.map((p) => p.y).filter((v) => v != null);
    if (!vals.length) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    // Own-rest level at this gain: the calibration's when it measured the gain,
    // else the median preview score (blocks assumed mostly rest).
    const mu = pg.muRest ?? sorted[Math.floor(sorted.length / 2)];
    const limit = Math.min(1, mu + 0.84 * 0.161);    // decision.py PERSONAL_K_ALERT x PERSONAL_SIGMA_PRIOR
    const last = [...pts].reverse().find((p) => p.y != null);
    return { pts, mu, limit, last, lo: sorted[0], hi: sorted[sorted.length - 1], n: vals.length };
  }, [pg, blocks]);

  return (
    <Card
      title="Task state"
      subtitle="Cognitive-load score from the last 25s block (not a validated stress probability)"
      right={latest && <span className="muted">block #{latest.window} · {ago(latest.timestamp_end * 1000, now)}</span>}
    >
      {!blocks.length ? (
        <div className="chart-empty" style={{ height: 200 }}>
          No scored blocks for this session yet. The bridge sends one block every {BLOCK_SEC}s after calibrating.
        </div>
      ) : (
        <>
          <div className="task-grid">
            <div className="gauge-box">
              <ScoreGauge value={dec.score} threshold={thr} level={level} />
              <div className={`level-pill lvl-${level || 'none'}`}>
                {level ? LEVEL_WORDS[level] : 'No score'}
              </div>
              {latest?.skipped && (
                <p className="caption warn-text">
                  ▲ The latest block was rejected by the quality gate
                  {lastScored ? `, so this shows block #${lastScored.window}` : ''}.
                </p>
              )}
            </div>
            <KV rows={[
              ['Task label (model)', modelLabelText(shown?.task_state_label), `firebase_sync.py: int(score >= ${TASK_STATE_LABEL_THRESHOLD})`],
              ['Decision vs threshold', dec.high == null ? '—' : dec.high ? 'High task state' : 'Low task state'],
              ['Threshold in use', `${fmtScore(thr)} (${dec.source})`, dec.calibrated ? limits.mind.source : 'no calibration: backend / population threshold'],
              ['Calibrated baseline', dec.baseline == null ? '—' : fmtScore(dec.baseline)],
              ...(dec.calibrated && shown?.effective_high_load_p != null ? [['Backend live threshold', fmt(shown.effective_high_load_p, 4), 'effective_high_load_p stored with the block']] : []),
              ['Trend (last 3)', shown?.task_state_trend || '—'],
              ['Model confidence', shown?.model_confidence == null ? '—' : `${(shown.model_confidence * 100).toFixed(0)}%`, '|p − 0.5| × 2'],
              ['Signal quality', latest ? `${fmt(latest.eeg_quality_score, 0)}/100 (${latest.eeg_quality_flag ? 'trusted' : 'rejected'})` : '—'],
              ...(preview ? [['Score at amplitude gain (preview)', `${preview.last.y.toFixed(3)} (block #${preview.last.x}, ${pg.gain.toFixed(1)}×)`,
                'What the updated backend gives this block: its stored features re-scored at the session amplitude gain']] : []),
              ['Amplitude gain', shown?.amplitude_gain == null ? '—' : shown.amplitude_gain === 1 ? '1× (signal in training range)' : `${shown.amplitude_gain.toFixed(1)}× (signal rescaled before the model)`,
                'Per-session gain from the rest calibration: training SD / this session\'s rest SD. Applied only when the rest signal is below the SAM40 range.'],
              ['Baseline degraded', yesNo(shown?.baseline_degraded)],
              ['Model', `${shown?.model_version || MODEL.model_version} · LOSO AUC ${shown?.model_accuracy ?? '—'}`],
            ]} />
            <div className="alerts">
              <h3>Decision flags</h3>
              {[
                ['high_load_alert', 'High-load alert'],
                ['micro_break_recommended', 'Micro-break recommended'],
                ['fatigue_warning', 'Fatigue warning'],
                ['cooldown_logged', 'Cooldown logged'],
              ].map(([k, label]) => (
                <div key={k} className="alert-row">
                  <Status kind={shown?.[k] ? (k === 'cooldown_logged' ? 'good' : 'critical') : 'idle'}>
                    {label}: {shown?.[k] ? 'ON' : 'off'}
                  </Status>
                </div>
              ))}
              <p className="caption">Persistence-gated over consecutive blocks (sam40/decision.py), so a single high block doesn't trigger an alert on its own.</p>
            </div>
          </div>
          <div className="chart-head">
            <h3 className="section-title">{scale === 'z' ? 'Distance from own rest per block (z)' : 'Score per block'}</h3>
            <ScaleSwitch value={scale} onChange={setScalePick} options={[
              ['log', 'Log', 'Log scale: small scores and the threshold both visible'],
              ['zoom', 'Zoom', 'Fit the axis to the scores only'],
              ['full', '0–1', 'Full probability range'],
              ['z', 'Personal z', '(score − own rest) / σ; high load at z ≥ 0.84'],
            ]} />
          </div>
          <LineChart
            points={chart.points}
            height={200}
            yDomain={chart.yDomain}
            dots
            ariaLabel={scale === 'z' ? 'Personal z per block' : 'Task-state score per block'}
            refLines={chart.refLines}
            xFormat={(v) => `#${Math.round(v)}`}
            yFormat={chart.yFormat}
            tooltip={({ b }) => (
              <>
                <b>{b.task_state_score == null ? 'Skipped (quality gate)' : `score ${fmtScore(b.task_state_score)}`}</b>
                {b.task_state_z != null && <span>z {b.task_state_z >= 0 ? '+' : ''}{b.task_state_z.toFixed(3)} vs own rest</span>}
                <span>block #{b.window} · {clock(b.timestamp_end)}</span>
                <span>quality {fmt(b.eeg_quality_score, 0)}/100</span>
                {b.task_state_label != null && <span>label {b.task_state_label}</span>}
              </>
            )}
          />
          <p className="caption">
            Gaps in the line are blocks the quality gate rejected. Hover a point to see the block.
            {scale === 'log' && ' Log scale: each grid step is a factor of 10.'}
            {scale === 'zoom' && range && ` Axis fitted to the scores (${fmtScore(range[0])}–${fmtScore(range[1])}); the threshold ${fmt(thr, 3)} is ${range[1] < thr ? 'above this range' : 'shown by the colour above'}.`}
            {scale === 'z' && ' z stays near 0 while the score stays at this person\'s resting level.'}
          </p>
          {preview && (
            <div className="preview-box">
              <div className="chart-head">
                <h3 className="section-title">Preview: score per block at amplitude gain {pg.gain.toFixed(1)}×</h3>
                <span className="muted">{preview.n} block(s) · {fmtScore(preview.lo)}–{fmtScore(preview.hi)}</span>
              </div>
              <LineChart
                points={preview.pts}
                height={200}
                yDomain={[0, 1]}
                dots
                ariaLabel="Preview score per block at the session amplitude gain"
                refLines={[{ y: preview.limit, label: `limit ${preview.limit.toFixed(2)}` }, { y: preview.mu, label: `own rest ${preview.mu.toFixed(2)}` }]}
                xFormat={(v) => `#${Math.round(v)}`}
                yFormat={(v) => v.toFixed(2)}
                tooltip={({ b, y }) => (
                  <>
                    <b>{y == null ? 'no preview' : `preview ${y.toFixed(3)}`}</b>
                    <span>stored {fmtScore(b.task_state_score)} · block #{b.window}</span>
                    {y != null && <span>z {((y - preview.mu) / 0.161 >= 0 ? '+' : '')}{((y - preview.mu) / 0.161).toFixed(2)} vs own rest</span>}
                  </>
                )}
              />
              <p className="caption">
                These blocks were scored before this session had an amplitude gain. The preview re-scores each block&apos;s stored
                features at {pg.gain.toFixed(1)}× ({pg.source === 'calibration'
                  ? `measured by this session's calibration, rest SD ${fmt(pg.restStd, 2)} µV`
                  : `estimated from the blocks' median SD ${fmt(pg.restStd, 2)} µV`}): powers × g², log powers + ln g², amplitudes × g;
                band shares, ratios and shape features unchanged. It is what the updated backend gives them. Rest level and limit:
                {pg.muRest != null ? ' from the calibration.' : ' estimated from these blocks (assumed mostly rest).'} Blocks recorded
                from now on are scored at the gain directly.
              </p>
            </div>
          )}
          {range && range[1] < 0.01 && (
            <p className="caption warn-text">
              ▲ Every score is below 0.01, far under anything in the SAM40 training data. The model&apos;s strongest features are
              absolute power, so a signal much smaller than SAM40&apos;s (block SD about 6 µV) drives the score to ~0.
              {(shown?.amplitude_gain ?? 1) === 1
                ? (preview ? ' These blocks were scored before the session had an amplitude gain; the preview below shows their scores at the gain.'
                  : ' This session has no amplitude gain: it was calibrated before the gain existed, or with the API not yet redeployed. Recalibrate after redeploying.')
                : ' An amplitude gain is applied, so the signal may be too small even after rescaling (flat or disconnected input).'}
            </p>
          )}
        </>
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

function RecalibrateBar({ picker, raw, now }) {
  const sid = picker?.sessionId;
  const live = sid && sid === picker.liveSession;
  const req = useFirebaseValue(sid ? `eeg_recalibration/${sid}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const streaming = raw.stats.lastPacketAt && now - raw.stats.lastPacketAt < 5000;
  const active = req?.status === 'requested' || req?.status === 'capturing';
  const stale = req?.status === 'requested' && req.requested_at && now / 1000 - req.requested_at > RECAL_STALE_SEC;

  const onClick = async () => {
    if (!window.confirm(
      `Recalibrate session ${sid}?\n\nThe current resting baseline is discarded. The bridge settles for `
      + `${CALIBRATION_SETTLE_SEC / 60} min, then records ${N_CALIBRATION_BLOCKS} new rest blocks `
      + `(${Math.round((N_CALIBRATION_BLOCKS * BLOCK_SEC) / 60 * 10) / 10} min). Sit still, eyes open, breathe normally and relax `
      + 'until it finishes. Blocks recorded before this stay as they are.',
    )) return;
    setBusy(true); setError(null);
    try { await requestRecalibration(sid, picker.userId); } catch (e) { setError(e?.message || String(e)); }
    setBusy(false);
  };

  let text = null; let kind = 'idle';
  if (req?.status) {
    kind = req.status === 'done' ? (req.baseline_degraded ? 'warning' : 'good') : req.status === 'superseded' ? 'idle' : 'warning';
    text = RECAL_TEXT[req.status] || req.status;
    if (req.status === 'capturing') text += ` (${req.blocks_captured ?? 0}/${req.blocks_needed ?? N_CALIBRATION_BLOCKS} blocks)`;
    if (req.status === 'done') text += `: ${req.outcome || 'ok'}, ${req.usable_blocks ?? 0} usable block(s)${req.baseline_degraded ? ', degraded baseline' : ''}`;
    if (stale) { text = 'Requested, but the bridge hasn\'t picked it up: is mqtt_bridge.py running (and redeployed)?'; kind = 'critical'; }
  }
  const when = req?.updated_at || req?.requested_at;

  return (
    <div className="recal-bar">
      <button type="button" className="btn" onClick={onClick} disabled={!live || busy || (active && !stale)}
        title={!live ? 'Only the live session the bridge is serving can be recalibrated' : undefined}>
        {busy ? 'Sending…' : active && !stale ? 'Recalibrating…' : 'Recalibrate'}
      </button>
      <div className="recal-status">
        {!sid ? <span className="muted">Pick a session first.</span>
          : !live ? <span className="muted">This isn&apos;t the live session, so it can&apos;t be recalibrated. Turn on &quot;Follow live session&quot;.</span>
            : text ? <Status kind={kind}>{text}{when ? ` · ${ago(when * 1000, now)}` : ''}</Status>
              : <span className="muted">Discards this session&apos;s baseline and records {N_CALIBRATION_BLOCKS} new rest blocks.{!streaming ? ' No live EEG is arriving right now.' : ''}</span>}
        {req?.status === 'capturing' && req.last_reason && <span className="caption warn-text">▲ {req.last_reason}</span>}
        {error && <span className="caption warn-text">▲ Couldn&apos;t send the request: {error}</span>}
      </div>
    </div>
  );
}

export function CalibrationPanel({ sessionData, profile, raw, now, picker, limits }) {
  const c = sessionData.calibration;
  const t = sessionData.threshold;
  const streaming = raw.stats.lastPacketAt && now - raw.stats.lastPacketAt < 5000;

  let phase; let kind;
  if (!c) {
    phase = streaming ? `Waiting for the bridge: ${CALIBRATION_SETTLE_SEC / 60} min settle, then ${N_CALIBRATION_BLOCKS} rest blocks (~${Math.round((CALIBRATION_SETTLE_SEC + N_CALIBRATION_BLOCKS * BLOCK_SEC) / 60)} min)` : 'Not calibrated yet';
    kind = 'idle';
  } else if (c.status === 'capturing') { phase = 'API is processing calibration blocks'; kind = 'warning'; } else if (c.status === 'ok') { phase = 'Calibrated'; kind = 'good'; } else if (c.status === 'degraded') { phase = 'Calibrated with a degraded baseline'; kind = 'warning'; } else { phase = `Calibration ${c.status || 'unknown'}`; kind = 'critical'; }

  const steps = [
    { label: 'Settling', desc: `First ${CALIBRATION_SETTLE_SEC / 60} min discarded, plus the first rest block. Electrodes and amplifier settle.` },
    { label: 'Resting baseline', desc: `${N_CALIBRATION_BLOCKS} rest blocks (~4 min), natural breathing, eyes open; ≥ ${MIN_USABLE_REST_BLOCKS} must clear the quality gate` },
    { label: 'Personal baseline', desc: 'Mean rest score → μ_rest; high-load limit = μ_rest + 0.84σ' },
    { label: 'High-load check', desc: 'Optional 8-min task, then 3-min recovery rest: task must sit ≥ 0.5σ above rest' },
  ];
  const done = !c ? 0 : c.status === 'capturing' ? 2 : 3 + (t?.status === 'ok' || profile?.personal_high_load_p != null ? 1 : 0);

  return (
    <Card title="Calibration" subtitle="Per-session resting baseline plus a per-user personal threshold"
      right={<Status kind={kind}>{phase}</Status>}>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.label} className={i < done ? 'done' : i === done ? 'current' : ''}>
            <span className="step-dot">{i < done ? '✓' : i + 1}</span>
            <div><strong>{s.label}</strong><span className="muted">{s.desc}</span></div>
          </li>
        ))}
      </ol>
      <RecalibrateBar picker={picker} raw={raw} now={now} />
      {limits?.mind ? (
        <p className="caption">In use on every dashboard: baseline <b>{fmtScore(limits.mind.baseline)}</b>, high-load threshold <b>{fmtScore(limits.mind.threshold)}</b> ({limits.mind.source}
          {limits.mind.statusText && !limits.mind.personal ? `; ${limits.mind.statusText}` : ''}{limits.mind.fromSid ? `; calibration from ${limits.mind.fromSid}` : ''}). The records below are what the backend stored.</p>
      ) : null}
      <div className="cal-grid">
        <div>
          <h3>This session: calibration_result</h3>
          {c ? (
            <KV rows={[
              ['Status', c.status],
              ['Usable blocks', c.n_blocks ?? '—'],
              ['Resting score', fmt(c.resting_calibrated_p, 4), 'Mean model probability over the relax blocks'],
              ['Baseline shift', fmt(c.baseline_shift, 4), 'Subtracted from every raw score: task_state_score = raw − shift'],
              ['Thresholds personalised', yesNo(c.thresholds_personalized)],
              ['Reused stored profile', yesNo(c.skip_ahead_used)],
              ['Personal high_load_p', fmt(c.personal_high_load_p, 4)],
              ['Degraded', yesNo(c.baseline_degraded)],
              ['Amplitude gain', c.amplitude_gain == null ? '—' : `${fmt(c.amplitude_gain, 2)}×${c.rest_std_uv != null ? ` (rest SD ${fmt(c.rest_std_uv, 2)} µV)` : ''}`,
                'Every block of the session is multiplied by this before features are computed; 1 = signal already in the SAM40 range'],
              ...(c.score != null ? [['Best block quality', fmt(c.score, 1)]] : []),
              ['Updated', c.updated_at ? `${clock(c.updated_at)} (${ago(c.updated_at * 1000, now)})` : '—'],
            ]} />
          ) : <p className="muted">No calibration result written for this session.</p>}
        </div>
        <div>
          <h3>This session: threshold_result</h3>
          {t ? (
            <KV rows={[
              ['Status', t.status],
              ['Personal high_load_p', fmt(t.personal_high_load_p, 4)],
              ['Resting mean', fmt(t.resting_mean, 4)],
              ['Task mean', fmt(t.task_mean, 4)],
              ['Task blocks', t.n_task_blocks ?? '—'],
            ]} />
          ) : <p className="muted">The threshold task hasn't run in this session.</p>}
        </div>
        <div>
          <h3>User profile: user_profiles/…/eeg</h3>
          {profile ? (
            <KV rows={[
              ['Baseline shift', fmt(profile.baseline_shift, 4)],
              ['Personalised', yesNo(profile.thresholds_personalized)],
              ['Calibrated', profile.calibrated_at ? `${new Date(profile.calibrated_at * 1000).toLocaleString()} (${ago(profile.calibrated_at * 1000, now)})` : '—'],
              ['Personal high_load_p', fmt(profile.personal_high_load_p, 4)],
              ['Population high_load_p', fmt(POPULATION_HIGH_LOAD_P, 4)],
            ]} />
          ) : <p className="muted">No stored profile for this user.{limits?.mind ? ` The calibrated threshold ${fmtScore(limits.mind.threshold)} applies.` : ` The population threshold ${POPULATION_HIGH_LOAD_P.toFixed(4)} applies.`}</p>}
        </div>
      </div>
    </Card>
  );
}

// ── 4. extracted features ──────────────────────────────────────────
export function FeaturesPanel({ sessionData, profile }) {
  const { blocks } = sessionData;
  const withFeat = blocks.filter((b) => b.features_eeg?.bipolar);
  const latest = withFeat[withFeat.length - 1];
  const prev = withFeat[withFeat.length - 2];
  const f = latest?.features_eeg?.bipolar;
  const p = prev?.features_eeg?.bipolar;
  const ex = useMemo(() => explain(f), [f]);
  const [showAll, setShowAll] = useState(false);

  const wave = latest?.wave_uv;
  const wavePoints = useMemo(
    () => (wave ? wave.map((y, i) => ({ x: (i / wave.length) * BLOCK_SEC, y })) : []),
    [wave],
  );
  const shift = latest?.task_state_score != null && ex ? ex.rawScore - latest.task_state_score : null;
  // The applied shift is this session's calibration_result.baseline_shift
  // (or the reused profile's). Scores clamp at 0/1, so only compare
  // unclamped ones.
  const expectedShift = sessionData.calibration?.baseline_shift ?? profile?.baseline_shift;
  const shiftMatches = shift != null && expectedShift != null
    && latest.task_state_score > 0 && latest.task_state_score < 1
    ? Math.abs(shift - expectedShift) < 1e-3 : null;

  const contrib = ex ? [...ex.rows].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)) : [];
  const shownContrib = showAll ? contrib : contrib.slice(0, 8);
  const maxC = contrib.length ? Math.abs(contrib[0].contribution) : 1;

  return (
    <Card title="Extracted features"
      subtitle={latest ? `Block #${latest.window} · ${clock(latest.timestamp_end)}${latest.skipped ? ' · rejected by the quality gate, so features are shown but the block wasn’t scored' : ''}` : 'Waiting for the first processed block'}>
      {!latest ? <div className="chart-empty" style={{ height: 160 }}>No feature records in this session yet.</div> : (
        <>
          <div className="feat-top">
            <div>
              <h3>Preprocessed signal ({TARGET_FS} Hz, {BIPOLAR_HIGHPASS_HZ}–45 Hz, ±{CLIP_UV} µV)</h3>
              <LineChart points={wavePoints} height={170} ariaLabel="Filtered EEG for the latest block"
                xFormat={(v) => `${v.toFixed(0)}s`} yFormat={(v) => v.toFixed(0)}
                emptyText="This block carries no waveform preview."
                tooltip={(pt) => <><b>{pt.y.toFixed(1)} µV</b><span>t = {pt.x.toFixed(1)}s</span></>} />
              <p className="caption">The model input after detrending, despiking, resampling, the notch and band-pass filters and the clamp. Downsampled to {wave?.length ?? 0} points.</p>
            </div>
            <div>
              <h3>Relative band power</h3>
              <BarList
                rows={BANDS.map((b) => ({ label: b.label, sub: b.sub, value: f[`${b.key}_rel_power`] }))}
                max={1}
                format={(v) => `${(v * 100).toFixed(1)}%`}
              />
              <p className="caption">θ/α {fmt(f.theta_alpha_ratio)} · β/α {fmt(f.beta_alpha_ratio)} · θ/β {fmt(f.theta_beta_ratio)}</p>
            </div>
          </div>

          {ex && (
            <>
              <h3 className="section-title">Why this score: per-feature contribution to the model</h3>
              <p className="caption">
                contribution = coef × (x − μ) / σ, using the deployed model&apos;s own scaler and coefficients ({MODEL.source.split('/').pop()}).
                Recomputed raw p = <b>{ex.rawScore.toFixed(4)}</b>
                {latest.task_state_score != null && <> → stored task_state_score <b>{latest.task_state_score.toFixed(4)}</b> (implied baseline shift {fmt(shift, 4)})</>}.
              </p>
              {shiftMatches != null && (
                <p className="caption">
                  <Status kind={shiftMatches ? 'good' : 'warning'}>
                    {shiftMatches
                      ? `Matches the calibration baseline_shift (${fmt(expectedShift, 4)}), so the browser reproduces the backend's score from the stored features.`
                      : `Doesn't match the calibration baseline_shift (${fmt(expectedShift, 4)}). The deployed model may differ from the local .joblib.`}
                  </Status>
                </p>
              )}
              <div className="contrib" role="list">
                {shownContrib.map((r) => (
                  <div key={r.name} className="contrib-row" role="listitem"
                    title={`x=${fmt(r.x)}  z=${r.z.toFixed(2)}  coef=${r.coef.toFixed(3)}`}>
                    <span className="contrib-name">{r.name}</span>
                    <span className="contrib-track">
                      <span className={`contrib-bar ${r.contribution >= 0 ? 'pos' : 'neg'}`}
                        style={{ width: `${(Math.abs(r.contribution) / maxC) * 50}%` }} />
                    </span>
                    <span className="contrib-val">{r.contribution >= 0 ? '+' : ''}{r.contribution.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="contrib-legend">
                <span><i className="sw pos" /> pushes toward high task state</span>
                <span><i className="sw neg" /> pushes toward low task state</span>
                <button type="button" className="link" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? 'Show top 8' : `Show all ${contrib.length}`}
                </button>
              </div>
            </>
          )}

          <h3 className="section-title">All 29 features</h3>
          <div className="feat-groups">
            {FEATURE_GROUPS.map((g) => (
              <table key={g.title} className="feat-table">
                <caption>{g.title}</caption>
                <thead><tr><th>Feature</th><th>Value</th><th>Δ prev</th></tr></thead>
                <tbody>
                  {g.keys.map((k) => {
                    const d = p && f[k] != null && p[k] != null ? f[k] - p[k] : null;
                    return (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="num">{fmt(f[k])}</td>
                        <td className={`num ${d == null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>
                          {d == null ? '—' : `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${fmt(Math.abs(d))}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ── 5. block log ───────────────────────────────────────────────────
export function BlockLog({ sessionData }) {
  const rows = [...sessionData.blocks].reverse().slice(0, 40);
  return (
    <Card title="Block log" subtitle="One row per 25s block the API processed (newest first, last 40)">
      {!rows.length ? <p className="muted">No blocks yet.</p> : (
        <div className="table-scroll">
          <table className="log">
            <thead>
              <tr>
                <th>#</th><th>End time</th><th>Quality</th><th>Score</th><th>Label</th>
                <th>Threshold</th><th>Trend</th><th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.window} className={b.skipped ? 'skipped' : ''}>
                  <td className="num">{b.window}</td>
                  <td>{clock(b.timestamp_end)}</td>
                  <td>
                    <Status kind={b.eeg_quality_flag ? 'good' : 'warning'}>
                      {fmt(b.eeg_quality_score, 0)} {b.eeg_quality_flag ? 'trusted' : 'rejected'}
                    </Status>
                  </td>
                  <td className="num">{b.task_state_score == null ? 'skipped' : b.task_state_score.toFixed(3)}</td>
                  <td>{b.task_state_label == null ? '—' : b.task_state_label === 1 ? '1 high' : '0 low'}</td>
                  <td className="num">{fmt(b.effective_high_load_p, 3)}</td>
                  <td>{b.task_state_trend || '—'}</td>
                  <td>
                    {[b.high_load_alert && 'high-load', b.micro_break_recommended && 'break', b.fatigue_warning && 'fatigue', b.baseline_degraded && 'degraded-baseline']
                      .filter(Boolean).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── 6. API / sources detail ────────────────────────────────────────
export function ApiPanel({ health, picker, now }) {
  return (
    <Card title="API and data sources" subtitle="What this page reads. It never writes anything.">
      <div className="api-grid">
        <div>
          <h3>GET {EEG_API_BASE}/health</h3>
          <p className="caption">{health.at ? `Checked ${ago(health.at, now)}` : 'Checking…'}{health.latencyMs != null ? ` · ${health.latencyMs} ms` : ''}{health.error ? ` · ${health.error}` : ''}</p>
          <pre className="json">{health.data ? JSON.stringify(health.data, null, 2) : health.error ? `Unreachable: ${health.error}\n(Render free tier can take ~30s to cold-start)` : '…'}</pre>
        </div>
        <div>
          <h3>Sources</h3>
          <ul className="sources-list">
            <li><b>Raw samples</b>: MQTT <code>{MQTT_TOPIC_EEG}</code> + <code>{MQTT_TOPIC_STATUS}</code> via <code>{MQTT_URL}</code>. The raw signal isn&apos;t stored in Firebase.</li>
            <li><b>Per-block results</b>: <code>psychological/{picker.userId || '{uid}'}/{picker.sessionId || '{sid}'}/{'{window}'}</code>, written by <code>/predict</code></li>
            <li><b>Calibration</b>: <code>…/calibration_result</code>, <code>…/threshold_result</code>, <code>user_profiles/{picker.userId || '{uid}'}/eeg</code></li>
            <li><b>Live pointer</b>: <code>psychological/current_user_id</code> and <code>current_session_id</code>, the session mqtt_bridge.py is posting under</li>
          </ul>
          <h3>Signal chain</h3>
          <p className="caption">
            ADS1292R CH2 (T7−T8), gain 8, 250 SPS → ESP32-C3 sends up to {BATCH_SIZE} samples per message → EMQX → mqtt_bridge.py accumulates {BLOCK_SEC}s
            ({BLOCK_SEC * SOURCE_FS} samples) → POST /predict → preprocess → quality gate → 29 features → logistic regression →
            task_state_score = raw p − baseline_shift → label and decision flags → Firebase.
          </p>
        </div>
      </div>
    </Card>
  );
}
