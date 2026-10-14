import { useMemo, useState } from 'react';
import { BarList, LineChart, ScoreGauge } from './charts';
import {
  BATCH_SIZE, BIPOLAR_HIGHPASS_HZ, BLOCK_SEC, CLIP_UV, EEG_API_BASE, MQTT_TOPIC_EEG, MQTT_TOPIC_STATUS,
  MQTT_URL, N_CALIBRATION_BLOCKS, POPULATION_HIGH_LOAD_P, RAW_WINDOW_SEC, SOURCE_FS, TARGET_FS,
  TASK_STATE_LABEL_THRESHOLD, UV_PER_COUNT,
} from '../lib/config';
import {
  BANDS, FEATURE_GROUPS, LEVEL_WORDS, MODEL, explain, fmt, levelOf, modelLabelText,
} from '../lib/model';

// ── small shared pieces ───────────────────────────────────────────
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
export function PipelineStrip({ raw, health, sessionData, picker, now }) {
  const latest = sessionData.blocks[sessionData.blocks.length - 1];
  const hbAge = raw.status.heartbeatAt ? now - raw.status.heartbeatAt : null;
  const drdy = raw.status.heartbeat?.drdy_ok;
  const pktFresh = raw.stats.lastPacketAt && now - raw.stats.lastPacketAt < 5000;
  const nFeat = latest?.features_eeg?.bipolar ? Object.values(latest.features_eeg.bipolar).filter((v) => v != null).length : 0;
  const ex = explain(latest?.features_eeg?.bipolar);
  const thr = latest?.effective_high_load_p;

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
      name: 'Decision', detail: 'score vs personal/population threshold',
      kind: latest?.task_state_score == null ? 'idle' : latest.task_state_score >= thr ? 'critical' : 'good',
      value: latest?.task_state_score == null ? (latest?.skipped ? 'skipped' : '—')
        : `${latest.task_state_score.toFixed(3)} ${latest.task_state_score >= thr ? '≥' : '<'} ${fmt(thr, 3)}`,
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
export function TaskStatePanel({ sessionData, profile, now }) {
  const { blocks } = sessionData;
  const latest = blocks[blocks.length - 1];
  const lastScored = [...blocks].reverse().find((b) => b.task_state_score != null);
  const shown = latest && !latest.skipped ? latest : lastScored;
  const thr = shown?.effective_high_load_p ?? profile?.personal_high_load_p ?? POPULATION_HIGH_LOAD_P;
  const personal = profile?.personal_high_load_p != null && Math.abs(profile.personal_high_load_p - thr) < 1e-9;
  const level = levelOf(shown?.task_state_score, thr);

  // x = block number, not time: a re-run can overwrite an early window key
  // with a later timestamp, so time isn't monotonic across windows.
  const points = blocks.map((b) => ({
    x: b.window, y: b.task_state_score ?? null, b,
  }));

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
              <ScoreGauge value={shown?.task_state_score ?? null} threshold={thr} level={level} />
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
              ['Decision vs threshold', shown?.task_state_score == null ? '—' : shown.task_state_score >= thr ? 'High task state' : 'Low task state'],
              ['Effective threshold', `${fmt(thr, 4)} (${personal ? 'personal' : 'population'})`],
              ['Trend (last 3)', shown?.task_state_trend || '—'],
              ['Model confidence', shown?.model_confidence == null ? '—' : `${(shown.model_confidence * 100).toFixed(0)}%`, '|p − 0.5| × 2'],
              ['Signal quality', latest ? `${fmt(latest.eeg_quality_score, 0)}/100 (${latest.eeg_quality_flag ? 'trusted' : 'rejected'})` : '—'],
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
          <h3 className="section-title">Score per block</h3>
          <LineChart
            points={points}
            height={200}
            yDomain={[0, 1]}
            dots
            ariaLabel="Task-state score per block"
            refLines={[{ y: thr, label: `threshold ${thr.toFixed(2)}` }, { y: TASK_STATE_LABEL_THRESHOLD, label: 'label cut 0.5' }]}
            xFormat={(v) => `#${Math.round(v)}`}
            yFormat={(v) => v.toFixed(2)}
            tooltip={({ b }) => (
              <>
                <b>{b.task_state_score == null ? 'Skipped (quality gate)' : `score ${b.task_state_score.toFixed(3)}`}</b>
                <span>block #{b.window} · {clock(b.timestamp_end)}</span>
                <span>quality {fmt(b.eeg_quality_score, 0)}/100</span>
                {b.task_state_label != null && <span>label {b.task_state_label}</span>}
              </>
            )}
          />
          <p className="caption">Gaps in the line are blocks the quality gate rejected. Hover a point to see the block.</p>
        </>
      )}
    </Card>
  );
}

// ── 3. calibration ─────────────────────────────────────────────────
export function CalibrationPanel({ sessionData, profile, raw, now }) {
  const c = sessionData.calibration;
  const t = sessionData.threshold;
  const streaming = raw.stats.lastPacketAt && now - raw.stats.lastPacketAt < 5000;

  let phase; let kind;
  if (!c) {
    phase = streaming ? `Waiting for the bridge to finish capturing ${N_CALIBRATION_BLOCKS} relax blocks (${N_CALIBRATION_BLOCKS * BLOCK_SEC}s)` : 'Not calibrated yet';
    kind = 'idle';
  } else if (c.status === 'capturing') { phase = 'API is processing calibration blocks'; kind = 'warning'; } else if (c.status === 'ok') { phase = 'Calibrated'; kind = 'good'; } else if (c.status === 'degraded') { phase = 'Calibrated with a degraded baseline'; kind = 'warning'; } else { phase = `Calibration ${c.status || 'unknown'}`; kind = 'critical'; }

  const steps = [
    { label: 'Settling', desc: 'Block 1 (0–25s) is never used. The electrodes are still settling.' },
    { label: 'Relax capture', desc: `Blocks 2–${N_CALIBRATION_BLOCKS} must clear the quality gate (QUESTIONABLE or better)` },
    { label: 'Baseline', desc: 'Resting score → baseline_shift (SEM-checked)' },
    { label: 'Personal threshold', desc: 'Optional 8-min task: rest vs task → personal high_load_p' },
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
          ) : <p className="muted">No stored profile for this user. The population threshold {POPULATION_HIGH_LOAD_P.toFixed(4)} applies.</p>}
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
