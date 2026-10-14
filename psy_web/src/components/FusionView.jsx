import { useMemo, useState } from 'react';
import {
  BarList, MultiLineChart, ScaleSwitch, ScoreGauge, autoScoreScale, fmtScore, log10Safe,
} from './charts';
import { Card, KV, SessionPicker, Stat, Status, ago } from './panels';
import { FIREBASE_DB_URL } from '../lib/config';
import {
  ALIGNED_Z_CAP, EEG_BASIS_TEXT, EXTREME_PROB_EPS, MODALITIES, PHASE_TEXT, SATURATED_WEIGHT,
  breakdown, keyToMs,
} from '../lib/fusion';
import { fmt } from '../lib/model';

const WINDOW_SEC = 25;
const clockMs = (ms) => (ms == null ? '—' : new Date(ms).toLocaleTimeString());
const pct = (v, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const signed = (v, d = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}`);

const LEVEL_TEXT = { low: 'Normal', moderate: 'Elevated', high: 'High stress' };
function fusedLevel(p, thr) {
  if (p == null || thr == null) return null;
  if (p >= thr) return 'high';
  return p >= thr - 0.1 ? 'moderate' : 'low';
}

const lastWith = (windows, f) => [...windows].reverse().find((w) => w[f] != null) || null;

// ── data-source health ─────────────────────────────────────────────
function FusionSources({ windows, picker, now }) {
  const latest = windows[windows.length - 1];
  const eeg = lastWith(windows, 'prob_eeg');
  const hrv = lastWith(windows, 'prob_hrv_gsr');
  const fresh = (w) => w && now - keyToMs(w.key) < (WINDOW_SEC * 3 + 15) * 1000;
  const src = (name, w, liveText) => (
    <div className="source">
      <span className="source-name">{name}</span>
      <Status kind={!picker.sessionId ? 'idle' : fresh(w) ? 'good' : w ? 'warning' : 'idle'}>
        {!picker.sessionId ? 'no session' : fresh(w) ? liveText : w ? `last ${ago(keyToMs(w.key), now)}` : 'none this session'}
      </Status>
    </div>
  );
  return (
    <div className="sources">
      {src('Fusion windows · fusion_en', latest, 'live windows')}
      {src('Mind input · EEG', eeg, 'reporting')}
      {src('Body input · HRV + GSR', hrv, 'reporting')}
      <div className="source">
        <span className="source-name">Fusion scale · EEG policy</span>
        <Status kind={latest ? 'good' : 'idle'}>
          {latest ? `${latest.fused_scale || 'raw'} · ${latest.eeg_fusion_policy || eeg?.eeg_fusion_policy || '—'}` : '—'}
        </Status>
      </div>
    </div>
  );
}

// ── 1. current fused result ───────────────────────────────────────
function CurrentPanel({ windows, baseline, now }) {
  const shown = lastWith(windows, 'fused_probability');
  const latest = windows[windows.length - 1];
  if (!shown) {
    return (
      <Card title="Fused stress now" subtitle="Reliability-weighted combination of the mind and body readings">
        <div className="chart-empty" style={{ height: 200 }}>
          No fused windows for this session yet. fusion_live_session.py writes one every {WINDOW_SEC}s once either input reports.
        </div>
      </Card>
    );
  }
  const thr = shown.fused_threshold ?? 0.5;
  const level = fusedLevel(shown.fused_probability, thr);
  const elevated = shown.modality_elevated || {};
  const flags = [
    ...(shown.saturated_modalities || []).map((m) => `${m} saturated (kept at ${SATURATED_WEIGHT}× weight)`),
    ...(shown.implausible_modalities || []).map((m) => `${m} excluded (implausibly extreme)`),
  ];
  return (
    <Card
      title="Fused stress now"
      subtitle="Reliability-weighted combination of the mind and body readings"
      right={<span className="muted">window {shown.key} · {ago(keyToMs(shown.key), now)}</span>}
    >
      <div className="task-grid">
        <div className="gauge-box">
          <ScoreGauge value={shown.fused_probability} threshold={thr} level={level} label="fused" />
          <div className={`level-pill lvl-${level || 'none'}`}>{level ? LEVEL_TEXT[level] : 'No result'}</div>
          {latest && latest.key !== shown.key && (
            <p className="caption warn-text">▲ The newest window has no fused value yet, so this shows window {shown.key}.</p>
          )}
        </div>
        <KV rows={[
          ['Fused label', shown.fused_label == null ? '—' : shown.fused_label === 1 ? '1 · high stress' : '0 · normal'],
          ['Fused value / limit', `${fmt(shown.fused_probability, 3)} / ${fmt(thr, 3)}`, 'Aligned scale: every model\'s own limit maps to 0.5'],
          ['Relative index', signed(shown.fused_relative_index), 'Weighted distance from each model\'s own limit, in its own spreads (capped ±3)'],
          ['Raw-scale result', `${fmt(shown.fused_probability_raw, 3)} vs ${fmt(shown.fused_threshold_raw, 3)}`, 'Old rule, averaging raw model outputs'],
          ['Trend', shown.stress_trend || '—'],
          ['Phase', PHASE_TEXT[shown.stress_phase] || shown.stress_phase || '—'],
          ['Session baseline', baseline == null ? 'not yet (first 3 windows)' : fmt(baseline, 3)],
          ['Deviation from baseline', signed(shown.stress_deviation, 3)],
        ]} />
        <div className="alerts">
          <h3>Agreement</h3>
          <div className="alert-row">
            <Status kind={shown.modality_concordance === 'concordant' ? 'good' : shown.modality_concordance === 'discordant' ? 'warning' : 'idle'}>
              {shown.modality_concordance === 'concordant' ? 'Mind and body agree'
                : shown.modality_concordance === 'discordant' ? 'Mind and body disagree'
                  : 'Only one input this window'}
            </Status>
          </div>
          {MODALITIES.map((m) => (
            <div key={m.key} className="alert-row">
              <Status kind={elevated[m.key] == null ? 'idle' : elevated[m.key] ? 'critical' : 'good'}>
                {m.label}: {elevated[m.key] == null ? 'not fused' : elevated[m.key] ? 'above its limit' : 'below its limit'}
              </Status>
            </div>
          ))}
          {shown.stress_alert_message && <p className="caption warn-text">▲ {shown.stress_alert_message}</p>}
          {flags.map((f) => <p key={f} className="caption warn-text">▲ {f}</p>)}
          <p className="caption">Disagreement is not an error: load and arousal can move separately.</p>
        </div>
      </div>
    </Card>
  );
}

// ── 2. how the latest window was built ─────────────────────────────
function BreakdownPanel({ windows }) {
  const w = lastWith(windows, 'fused_probability');
  const b = useMemo(() => (w ? breakdown(w) : null), [w]);
  if (!w || !b) return null;
  const aligned = (w.fused_scale || 'raw') === 'aligned';
  const r = b.rows;
  const cell = (m, f) => (r[m].present ? f(r[m]) : '—');
  const rows = [
    ['Raw model output p', (x) => fmt(x.p, 4), 'EEG task-state score / HRV-GSR stress probability'],
    ['Its limit (threshold)', (x) => fmt(x.thr, 4), 'Personal limit if calibrated, else population'],
    ['Its spread (scale)', (x) => fmt(x.sc, 3), 'EEG: Personal Scale σ · HRV/GSR: personal threshold separation'],
    ['Distance from own limit, in spreads', (x) => `${signed(x.dist)}${x.capped ? ` (capped from ${signed(x.distRaw)})` : ''}${x.useZ ? ` = z ${signed(x.z)} − ${x.zAlert}` : ''}`,
      'EEG: log-odds z vs own rest (σ 0.55) minus the alert at 0.84 · HRV/GSR: (p − limit) / spread'],
    ['Aligned value σ(distance)', (x) => fmt(x.aligned, 3), 'Limit = 0.5; one spread above = 0.73'],
    ['Confidence max(p′, 1 − p′)', (x) => fmt(x.conf, 3)],
    ['Signal quality', (x) => `${fmt(x.q, 2)} → ${fmt(x.qNorm, 3)}`, 'EEG quality already includes its basis factor'],
    ['Saturation factor', (x) => (x.saturated ? `${SATURATED_WEIGHT} (saturated)` : '1')],
    ['Model prior (accuracy)', (x) => fmt(x.acc, 3)],
    ['Weight = quality × factor × confidence × prior', (x) => fmt(x.rawWeight, 4)],
    ['Share of the fused value', (x) => pct(x.weight, 1)],
    ['Contribution = aligned × share', (x) => fmt(x.aligned != null && x.weight != null ? x.aligned * x.weight : null, 3)],
  ];
  const match = b.fused != null && w.fused_probability != null && Math.abs(b.fused - w.fused_probability) < 2e-3;
  return (
    <Card title="How this window was fused" subtitle={`Window ${w.key}, step by step (${aligned ? 'aligned scale' : 'raw scale window: steps shown for comparison'})`}>
      <div className="table-scroll">
        <table className="log fusion-steps">
          <thead><tr><th>Step</th>{MODALITIES.map((m) => <th key={m.key}>{m.label}</th>)}</tr></thead>
          <tbody>
            {rows.map(([label, f, hint]) => (
              <tr key={label} title={hint}>
                <td>{label}</td>
                {MODALITIES.map((m) => <td key={m.key} className="num">{cell(m.key, f)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="stats" style={{ marginTop: 12 }}>
        <Stat label="Recomputed fused value" value={fmt(b.fused, 3)} sub="sum of contributions" />
        <Stat label="Stored fused value" value={fmt(w.fused_probability, 3)}
          sub={!aligned ? 'raw scale window' : match ? '✓ matches the engine' : '▲ differs (older engine version?)'} />
        <Stat label="EEG basis" value={EEG_BASIS_TEXT[w.eeg_basis] || (r.eeg.present ? '—' : 'EEG not fused')}
          sub={w.eeg_weight_factor != null ? `weight factor ${w.eeg_weight_factor}` : undefined} />
        <Stat label="Why EEG isn't fully trusted" value={w.eeg_untrusted_reason || (r.eeg.present ? 'it is' : '—')}
          sub={w.eeg_excluded_reason ? `excluded: ${w.eeg_excluded_reason}` : undefined} />
      </div>
      <h3 className="section-title">Weight share</h3>
      <BarList max={1} format={(v) => pct(v, 0)} rows={MODALITIES.map((m) => ({
        label: m.label, value: w[`${m.key}_weight`] ?? null,
        sub: r[m.key].present ? ` · p′ ${fmt(r[m.key].aligned, 2)}` : ' · not reporting',
      }))} />
      <p className="caption">
        A saturated output (below {EXTREME_PROB_EPS} or above {1 - EXTREME_PROB_EPS}) is clipped and kept at {SATURATED_WEIGHT}× weight;
        distances are capped at ±{ALIGNED_Z_CAP} spreads so no single reading pins the result.
      </p>
    </Card>
  );
}

// ── 3. timelines ──────────────────────────────────────────────────
function TimelinePanel({ windows }) {
  const points = useMemo(() => windows.map((w) => {
    const b = breakdown(w);
    return {
      x: keyToMs(w.key),
      eeg: w.eeg_aligned ?? (w.prob_eeg != null ? b.rows.eeg.aligned : null),
      hrv: w.hrv_gsr_aligned ?? (w.prob_hrv_gsr != null ? b.rows.hrv_gsr.aligned : null),
      fused: w.fused_probability ?? null,
      weeg: w.eeg_weight ?? null,
      whrv: w.hrv_gsr_weight ?? null,
      peeg: w.prob_eeg ?? null,
      phrv: w.prob_hrv_gsr ?? null,
      pfused: w.fused_probability_raw ?? null,
      teeg: w.threshold_eeg ?? null,
      thrv: w.threshold_hrv_gsr ?? null,
    };
  }), [windows]);
  // Raw outputs: log scale by default when EEG sits near 0 (a flat line on 0..1).
  const RAW_KEYS = ['peeg', 'teeg', 'phrv', 'thrv', 'pfused'];
  const [rawPick, setRawPick] = useState(null);
  const rawScale = rawPick || autoScoreScale(points.map((p) => p.peeg));
  const rawPoints = useMemo(() => (rawScale !== 'log' ? points : points.map((p) => {
    const q = { ...p };
    for (const k of RAW_KEYS) q[k] = log10Safe(p[k]);
    return q;
  })), [points, rawScale]);
  return (
    <Card title="Over the session" subtitle={`One point per ${WINDOW_SEC}s fusion window`}>
      <h3>On one shared scale (each model&apos;s own limit = 0.5)</h3>
      <MultiLineChart points={points} height={240} yDomain={[0, 1]} xFormat={clockMs} yFormat={(v) => v.toFixed(2)}
        ariaLabel="Aligned mind, body and fused values per window"
        refLines={[{ y: 0.5, label: 'limit 0.5' }]}
        series={[
          { key: 'eeg', label: 'Mind (EEG)', color: 'var(--c1)' },
          { key: 'hrv', label: 'Body (HRV + GSR)', color: 'var(--c2)' },
          { key: 'fused', label: 'Fused', color: 'var(--ink)', width: 2.5 },
        ]} />
      <p className="caption">Gaps are windows where that input didn&apos;t report. Mind values for older windows without a stored aligned value are recomputed with the current rule.</p>

      <h3 className="section-title">Weight share</h3>
      <MultiLineChart points={points} height={170} yDomain={[0, 1]} xFormat={clockMs} yFormat={(v) => pct(v)}
        ariaLabel="Weight share per window"
        series={[
          { key: 'weeg', label: 'Mind weight', color: 'var(--c1)' },
          { key: 'whrv', label: 'Body weight', color: 'var(--c2)' },
        ]} />

      <div className="chart-head">
        <h3 className="section-title">Raw model outputs and their own limits</h3>
        <ScaleSwitch value={rawScale} onChange={setRawPick} options={[
          ['log', 'Log', 'Log scale: tiny EEG scores and both limits visible'],
          ['full', '0–1', 'Full probability range'],
        ]} />
      </div>
      <MultiLineChart points={rawPoints} height={220} yDomain={rawScale === 'log' ? undefined : [0, 1]} xFormat={clockMs}
        yFormat={rawScale === 'log' ? (v) => fmtScore(10 ** v) : (v) => v.toFixed(2)}
        ariaLabel="Raw model outputs and thresholds per window"
        series={[
          { key: 'peeg', label: 'EEG p', color: 'var(--c1)' },
          { key: 'teeg', label: 'EEG limit', color: 'var(--c1)', dash: true, width: 1.5 },
          { key: 'phrv', label: 'HRV/GSR p', color: 'var(--c2)' },
          { key: 'thrv', label: 'HRV/GSR limit', color: 'var(--c2)', dash: true, width: 1.5 },
          { key: 'pfused', label: 'Fused (raw rule)', color: 'var(--muted)', width: 1.5 },
        ]} />
      <p className="caption">
        The two models output on different scales (EEG often near 0, HRV/GSR near its own limit), which is why fusion aligns them first.
        {rawScale === 'log' && ' Log scale: each grid step is a factor of 10.'}
      </p>
    </Card>
  );
}

// ── 4. session summary ────────────────────────────────────────────
function SummaryPanel({ data, now }) {
  const ws = data.windows;
  const fused = ws.filter((w) => w.fused_probability != null);
  const high = fused.filter((w) => w.fused_label === 1).length;
  const withEeg = ws.filter((w) => w.prob_eeg != null).length;
  const both = ws.filter((w) => w.prob_eeg != null && w.prob_hrv_gsr != null).length;
  const conc = fused.filter((w) => w.modality_concordance === 'concordant').length;
  const disc = fused.filter((w) => w.modality_concordance === 'discordant').length;
  const eegW = fused.map((w) => w.eeg_weight).filter((v) => v != null);
  const meanEegW = eegW.length ? eegW.reduce((a, v) => a + v, 0) / eegW.length : null;
  const sat = fused.filter((w) => (w.saturated_modalities || []).length).length;
  const startMs = data.started ? Date.parse(data.started) : null;
  return (
    <Card title="Session summary" subtitle={data.ended ? `Ended ${new Date(data.ended).toLocaleString()}` : 'Session in progress'}>
      <div className="stats">
        <Stat label="Windows" value={ws.length} sub={startMs ? `started ${ago(startMs, now)}` : undefined} />
        <Stat label="Fused" value={fused.length} sub={`${pct(fused.length ? high / fused.length : null)} high stress`} />
        <Stat label="With EEG" value={withEeg} sub={`${both} with both inputs`} />
        <Stat label="Mean mind weight" value={pct(meanEegW)} sub="across fused windows" />
        <Stat label="Agree / disagree" value={`${conc} / ${disc}`} sub="windows with both inputs" />
        <Stat label="Saturated EEG" value={sat} sub="kept at reduced weight" />
        <Stat label="Baseline" value={fmt(data.baseline, 3)} sub="mean of first 3 fused" />
      </div>
    </Card>
  );
}

// ── 5. window log ─────────────────────────────────────────────────
function WindowLog({ windows }) {
  const rows = [...windows].reverse().slice(0, 40);
  return (
    <Card title="Window log" subtitle="One row per fusion window (newest first, last 40)">
      {!rows.length ? <p className="muted">No windows yet.</p> : (
        <div className="table-scroll">
          <table className="log">
            <thead>
              <tr>
                <th>Time</th><th>EEG p</th><th>HRV/GSR p</th><th>EEG′</th><th>HRV′</th>
                <th>EEG w</th><th>HRV w</th><th>Fused</th><th>Label</th><th>Phase</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.key} className={w.fused_probability == null ? 'skipped' : ''}>
                  <td title={`window ${w.key}`}>{clockMs(keyToMs(w.key))}</td>
                  <td className="num">{fmtScore(w.prob_eeg)}</td>
                  <td className="num">{fmt(w.prob_hrv_gsr, 3)}</td>
                  <td className="num">{fmt(w.eeg_aligned, 2)}</td>
                  <td className="num">{fmt(w.hrv_gsr_aligned, 2)}</td>
                  <td className="num">{pct(w.eeg_weight)}</td>
                  <td className="num">{pct(w.hrv_gsr_weight)}</td>
                  <td className="num">{fmt(w.fused_probability, 3)}</td>
                  <td>{w.fused_label == null ? '—' : w.fused_label === 1 ? 'High' : 'Normal'}</td>
                  <td>{PHASE_TEXT[w.stress_phase] || '—'}</td>
                  <td>
                    {[w.eeg_basis, w.modality_concordance === 'discordant' && 'disagree',
                      ...(w.saturated_modalities || []).map((m) => `${m} saturated`),
                      ...(w.implausible_modalities || []).map((m) => `${m} excluded`),
                      w.fused_scale === 'raw' && 'raw scale'].filter(Boolean).join(', ') || '—'}
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

// ── 6. sources ────────────────────────────────────────────────────
function FusionSourcesPanel({ picker, latest }) {
  const path = `${picker.userId || '{uid}'}/${picker.sessionId || '{sid}'}`;
  return (
    <Card title="Data sources and rule" subtitle="What this page reads. It never writes anything.">
      <div className="api-grid">
        <div>
          <h3>Sources</h3>
          <ul className="sources-list">
            <li><b>Fusion windows</b>: <code>fusion_en/{path}/{'{window}'}</code>, written by the EEG <code>/predict</code>, the HRV/GSR <code>/predict</code> and <code>fusion_live_session.py</code></li>
            <li><b>Session meta</b>: <code>fusion_en_sessions/{path}</code> (baseline, start, end)</li>
            <li><b>Live pointer</b>: <code>fusion_en_sessions/current_user_id</code> and <code>current_session_id</code></li>
            <li><b>Database</b>: <code>{FIREBASE_DB_URL}</code></li>
          </ul>
          <h3>Latest window (raw record)</h3>
          <pre className="json">{latest ? JSON.stringify(latest, null, 2) : '…'}</pre>
        </div>
        <div>
          <h3>Fusion rule (aligned scale)</h3>
          <p className="caption">
            For each input: distance d from its own limit in its own spreads, capped at ±{ALIGNED_Z_CAP}. HRV/GSR: d = (p − limit) / spread.
            EEG: d = z − 0.84, where z = (logit p − logit own-rest) / 0.55 (log-odds, so scores near 0 still move).
            Aligned value p′ = 1 / (1 + e<sup>−d</sup>), so
            every model&apos;s own limit sits at 0.5. Weight = signal quality × confidence max(p′, 1 − p′) × model prior
            (EEG 0.632 pooled AUC, HRV/GSR 0.851), with EEG quality scaled by its basis (calibrated 1, uncalibrated 0.5,
            not responsive 0.25) and saturated outputs by {SATURATED_WEIGHT}. Fused = Σ weight share × p′; high stress when fused ≥ 0.5.
          </p>
          <p className="caption">
            Trend and phase compare each window with the session&apos;s first three fused windows (baseline).
            EEG measures cognitive load, HRV/GSR autonomic arousal; the fused value combines both, it is not a clinical diagnosis.
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function FusionView({ picker, data, now, onBack }) {
  const latest = data.windows[data.windows.length - 1] || null;
  return (
    <div className="page">
      <header className="top">
        <div>
          <button type="button" className="back-link" onClick={onBack}>← Wearable 02 EEG monitor</button>
          <p className="eyebrow">MindPulse · fusion engine · technical view</p>
          <h1>Fusion engine monitor</h1>
          <p className="muted">
            How the mind (EEG) and body (HRV + GSR) readings combine into one stress result, window by window.
            Read-only: this page doesn&apos;t write to Firebase or the API.
          </p>
        </div>
        <SessionPicker picker={picker} />
      </header>

      <FusionSources windows={data.windows} picker={picker} now={now} />
      {data.loading && picker.sessionId ? <p className="muted">Loading fusion windows…</p> : null}

      <CurrentPanel windows={data.windows} baseline={data.baseline} now={now} />
      <BreakdownPanel windows={data.windows} />
      <TimelinePanel windows={data.windows} />
      <SummaryPanel data={data} now={now} />
      <WindowLog windows={data.windows} />
      <FusionSourcesPanel picker={picker} latest={latest} />
    </div>
  );
}
