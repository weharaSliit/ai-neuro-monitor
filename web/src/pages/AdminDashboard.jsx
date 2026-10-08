import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, eegApi, DEVICE_ID } from '../lib/api';
import { COLORS, levelOf, LEVEL_COLOR, DEFAULT_RING_THRESHOLD, timeAgo } from '../lib/levels';
import { useDeviceStatus, useFirebaseValue, useLivePointer } from '../hooks/useLive';
import { useEegBlocks, useFusion, useRingHistory } from '../hooks/useStreams';
import { Card, CardHead, Badge, LiveBadge, Seg, Spinner, Avatar } from '../components/ui';
import Chart, { toRows } from '../components/Chart';
import Waveform from '../components/Waveform';

const USERS_REFRESH_MS = 25000;
const SLOW_REFRESH_MS = 45000;

// All 23 window features extract_features.py computes (FEATURE_COLS).
const RING_FEATURES = [
  ['AVNN', 'AVNN (mean RR)', ' ms'], ['MeanHR', 'Mean heart rate', ' bpm'], ['SDHR', 'Heart-rate SD', ' bpm'],
  ['pNN20', 'pNN20', ''], ['SD1', 'Short-term HRV (SD1)', ' ms'], ['SCL_mean', 'Skin conductance level', ' µS'],
  ['SCL_slope', 'SCL slope', ''], ['EDA_mean', 'EDA mean', ' µS'], ['EDA_slope', 'EDA slope', ''],
  ['EDA_std', 'EDA SD', ' µS'], ['SCR_count', 'SCR count', ''], ['SCR_amp_mean', 'SCR amplitude', ' µS'],
  ['SCR_width_mean', 'SCR width', ' s'], ['EDA_q10', 'EDA p10', ' µS'], ['EDA_q75', 'EDA p75', ' µS'],
  ['EDA_q90', 'EDA p90', ' µS'], ['EDA_range', 'EDA range', ' µS'], ['deriv1_std', '1st derivative SD', ''],
  ['deriv2_mean', '2nd derivative mean', ''], ['wavelet_d1_energy', 'Wavelet D1 energy', ''],
  ['wavelet_d3_energy', 'Wavelet D3 energy', ''], ['ACC_mean', 'Accelerometer mean', ' g'], ['ACC_std', 'Accelerometer SD', ' g'],
];
const EEG_FEATURES = [
  ['delta_rel_power', 'δ Delta', '#64748b'], ['theta_rel_power', 'θ Theta', '#7c3aed'],
  ['alpha_rel_power', 'α Alpha', '#2563eb'], ['beta_rel_power', 'β Beta', '#16a34a'],
  ['gamma_rel_power', 'γ Gamma', '#ea580c'], ['ptp', 'Peak-to-peak', '#db2777'],
  ['theta_beta_ratio', 'θ/β ratio', '#d97706'], ['spectral_entropy', 'Spectral entropy', '#0d9488'],
];
const PHENO_FEATURES = [
  ['avg_dwell', 'Key hold time', ' ms'], ['avg_flight', 'Key pause time', ' ms'],
  ['scroll_velocity', 'Scroll speed', ' px/s'], ['tilt_angle', 'Device tilt', '°'], ['cpm', 'Typing pace', ' cpm'],
];

function Kpi({ icon, tint, value, label }) {
  return (
    <Card className="kpi">
      <div className="ico" style={{ background: tint + '1C' }}>{icon}</div>
      <div><b>{value}</b><span className="caption">{label}</span></div>
    </Card>
  );
}

// Readable values: ISO timestamps -> "8 Oct, 14:58", yes/no for booleans,
// sensible decimals for numbers.
function fmtValue(key, v) {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (typeof v === 'number') {
    if (/(_at|timestamp)$/.test(key) && v > 1e9) return new Date(v < 1e11 ? v * 1000 : v).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1);
  }
  return String(v);
}

function KV({ obj, keys }) {
  const entries = (keys || Object.keys(obj || {}))
    .map((k) => [k, obj?.[k]])
    .filter(([, v]) => v != null && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'));
  if (!entries.length) return <p className="body">Nothing recorded yet.</p>;
  return (
    <div className="kv">
      {entries.map(([k, v]) => (
        <div key={k}><span>{k.replace(/_/g, ' ')}</span>
          <b>{fmtValue(k, v)}</b></div>
      ))}
    </div>
  );
}

function DistBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="distrow">
      <span className="subtitle" style={{ width: 64 }}>{label}</span>
      <div className="bg"><div className="fill" style={{ width: `${pct}%`, background: color }} /></div>
      <b style={{ color, width: 70, textAlign: 'right' }}>{value} ({pct.toFixed(0)}%)</b>
    </div>
  );
}

function parseKeyDate(key, w) {
  if (w?.timestamp) { const d = new Date(w.timestamp); if (!Number.isNaN(d.getTime())) return d; }
  if (/^\d{8}_\d{6}$/.test(key)) {
    return new Date(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8), +key.slice(9, 11), +key.slice(11, 13), +key.slice(13, 15));
  }
  return null;
}

// ── Detail tabs ───────────────────────────────────────────────────
function OverviewTab({ userId, liveSid, isLive }) {
  const fusion = useFusion(userId, liveSid);
  const rows = useMemo(() => fusion.rows.map((r) => ({
    date: r.date,
    values: [r.w.prob_eeg, r.w.prob_hrv_gsr, r.w.fused_probability].map((v) => (v != null ? Math.round(v * 100) : null)),
  })), [fusion.rows]);
  const l = fusion.latest || fusion.lastAny;
  return (
    <div className="stack">
      <Card>
        <CardHead title="Fusion — all modalities" sub="EEG, Ring (HRV+GSR) and fused probability, last 4 sessions + live"
          right={<LiveBadge online={isLive} offLabel="Not live" />} />
        <Chart rows={rows} domain={[0, 100]} suffix="%" height={280} series={[
          { name: 'Mind (EEG)', color: COLORS.eeg }, { name: 'Body (HRV+GSR)', color: COLORS.hrv }, { name: 'Fused', color: COLORS.brand },
        ]} />
      </Card>
      <Card>
        <CardHead title="Latest fusion window" sub={fusion.latestMs ? `Live · ${timeAgo(fusion.latestMs)}` : fusion.lastAnyMs ? `Last seen ${timeAgo(fusion.lastAnyMs)}` : ''} />
        <KV obj={l} keys={['fused_probability', 'fused_threshold', 'fused_label', 'prob_eeg', 'threshold_eeg',
          'prob_hrv_gsr', 'threshold_hrv_gsr', 'stress_trend', 'stress_phase', 'stress_alert_message']} />
      </Card>
    </div>
  );
}

function RingTab({ userId }) {
  const ring = useRingHistory(userId, { admin: true, pollMs: 5000 });
  const [baseline, setBaseline] = useState(null);
  const [ema, setEma] = useState(null);
  const [feature, setFeature] = useState('MeanHR');
  const { ringOnline } = useDeviceStatus(userId);

  useEffect(() => {
    let cancelled = false;
    const load = () => Promise.all([
      api.get(`/admin/baseline/${userId}`).then((r) => r.data).catch(() => null),
      api.get(`/admin/ema/history/${userId}`).then((r) => r.data).catch(() => null),
    ]).then(([b, e]) => { if (!cancelled) { setBaseline(b); setEma(e); } });
    load();
    const id = setInterval(load, SLOW_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId]);

  const thr = baseline?.personal_stress_threshold ?? DEFAULT_RING_THRESHOLD;
  const prob = useMemo(() => toRows(ring.windows.filter((w) => w.prob_stress != null)
    .map((w) => ({ date: new Date(w.timestamp), value: Math.round(w.prob_stress * 100) }))), [ring.windows]);
  const feat = RING_FEATURES.find((f) => f[0] === feature);
  const featRows = useMemo(() => toRows(ring.windows.filter((w) => w.features?.[feature] != null)
    .map((w) => ({ date: new Date(w.timestamp), value: Number(w.features[feature]) }))), [ring.windows, feature]);
  const latest = ring.windows[ring.windows.length - 1];

  const dist = useMemo(() => {
    const d = { normal: 0, stress: 0 };
    (ring.perSession || []).forEach((s) => {
      const p = Object.values(s.predictions || {});
      if (!p.length) return;
      if (p.filter((x) => x.label === 'Stress').length > p.length / 2) d.stress += 1; else d.normal += 1;
    });
    return d;
  }, [ring.perSession]);
  const emaEntries = ema?.ema_history ? Object.values(ema.ema_history) : [];

  if (ring.loading) return <Spinner />;
  return (
    <div className="stack">
      <div className="grid grid-3">
        <Card><span className="micro">Ring device</span>
          <div className="between" style={{ marginTop: 8 }}><b>{DEVICE_ID}</b><LiveBadge online={ringOnline} /></div></Card>
        <Card><span className="micro">Personal threshold</span>
          <div style={{ marginTop: 8 }}><b style={{ fontSize: 22 }}>{(thr * 100).toFixed(1)}%</b>
            <span className="caption"> {baseline?.personal_stress_threshold != null ? 'calibrated' : 'population default'}</span></div></Card>
        <Card><span className="micro">Latest window</span>
          <div className="between" style={{ marginTop: 8 }}>
            <b>{latest ? `${Math.round(latest.prob_stress * 100)}%` : '—'}</b>
            {latest && <Badge color={LEVEL_COLOR[levelOf(latest.prob_stress, thr)]} dot>{latest.label}</Badge>}
          </div>
          <span className="caption">{latest ? timeAgo(new Date(latest.timestamp).getTime()) : ''}</span></Card>
      </div>

      <Card>
        <CardHead title="Stress probability" sub="Per window, last 4 sessions · dashed line = this user’s threshold" />
        <Chart rows={prob} series={[{ name: 'Stress', color: COLORS.brand }]} limit={Math.round(thr * 100)}
          limitLabel="Threshold" domain={[0, 100]} suffix="%" height={240} />
      </Card>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Processed signals" sub="Newest window (downsampled by the backend)" />
          <Waveform title="GSR wave" hint="Filtered skin-conductance trace" values={latest?.wave_gsr} color={COLORS.gsr} unit=" µS" />
          <Waveform title="IBI sequence" hint="Beat-to-beat intervals after R-peak detection" values={latest?.ibi_sequence} color={COLORS.hrv} unit=" ms" />
        </Card>
        <Card>
          <CardHead title="Feature trend" right={
            <select className="select" value={feature} onChange={(e) => setFeature(e.target.value)}>
              {RING_FEATURES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>} />
          <Chart key={feature} rows={featRows} series={[{ name: feat[1], color: COLORS.hrv }]} suffix={feat[2]} height={220} />
          <div style={{ marginTop: 16 }}>
            <span className="micro">Session outcome (majority vote)</span>
            <DistBar label="Normal" value={dist.normal} total={dist.normal + dist.stress} color={COLORS.normal} />
            <DistBar label="Stress" value={dist.stress} total={dist.normal + dist.stress} color={COLORS.stress} />
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Baseline & calibration" />
          <KV obj={baseline} />
        </Card>
        <Card>
          <CardHead title="Baseline adaptation history" sub={`${emaEntries.length} recalibration blends`} />
          {emaEntries.length ? (
            <div className="stack" style={{ gap: 10 }}>
              {emaEntries.slice(-4).reverse().map((e, i) => <KV key={i} obj={e} />)}
            </div>
          ) : <p className="body">No adaptation entries yet.</p>}
        </Card>
      </div>

      <Card>
        <CardHead title="Recent windows" />
        <table className="data">
          <thead><tr><th>Time</th><th>Prob.</th><th>Label</th><th>HR</th><th>SCL</th><th>SCR</th></tr></thead>
          <tbody>{[...ring.windows].reverse().slice(0, 10).map((w, i) => (
            <tr key={i}>
              <td>{new Date(w.timestamp).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
              <td>{Math.round(w.prob_stress * 100)}%</td>
              <td><Badge color={w.label === 'Stress' ? COLORS.stress : COLORS.normal}>{w.label}</Badge></td>
              <td>{w.features?.MeanHR != null ? Math.round(w.features.MeanHR) : '—'}</td>
              <td>{w.features?.SCL_mean != null ? w.features.SCL_mean.toFixed(2) : '—'}</td>
              <td>{w.features?.SCR_count ?? '—'}</td>
            </tr>))}</tbody>
        </table>
      </Card>
    </div>
  );
}

function EegTab({ userId, isLiveUser }) {
  const eegSid = useFirebaseValue('psychological/current_session_id');
  const eeg = useEegBlocks(userId, isLiveUser ? eegSid : null);
  const [calib, setCalib] = useState(null);
  const [feature, setFeature] = useState('alpha_rel_power');

  useEffect(() => {
    let cancelled = false;
    eegApi.get(`/admin/calibration/${userId}`).then((r) => { if (!cancelled) setCalib(r.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  const blocks = useMemo(() => eeg.blocks.filter((b) => !b.skipped), [eeg.blocks]);
  const latest = eeg.latest || blocks[blocks.length - 1];
  const thr = latest?.effective_high_load_p ?? calib?.personal_high_load_p ?? 0.7933;
  const score = useMemo(() => toRows(blocks.filter((b) => b.task_state_score != null)
    .map((b) => ({ date: new Date(b.timestamp_end * 1000), value: Math.round(b.task_state_score * 100) }))), [blocks]);
  const quality = useMemo(() => toRows(blocks.filter((b) => b.eeg_quality_score != null)
    .map((b) => ({ date: new Date(b.timestamp_end * 1000), value: Math.round(b.eeg_quality_score * 100) }))), [blocks]);
  const f = EEG_FEATURES.find((x) => x[0] === feature);
  const featRows = useMemo(() => toRows(blocks.filter((b) => b.features_eeg?.bipolar?.[feature] != null)
    .map((b) => ({ date: new Date(b.timestamp_end * 1000), value: b.features_eeg.bipolar[feature] }))), [blocks, feature]);

  return (
    <div className="stack">
      <div className="grid grid-3">
        <Card><span className="micro">Current state</span>
          <div style={{ marginTop: 8 }}>{latest
            ? <Badge color={latest.high_load_alert ? COLORS.stress : COLORS.normal} dot>{latest.high_load_alert ? 'High load (persistent)' : 'Relaxed'}</Badge>
            : <span className="caption">No blocks</span>}</div></Card>
        <Card><span className="micro">Personal high-load p</span>
          <div style={{ marginTop: 8 }}><b style={{ fontSize: 22 }}>{(thr * 100).toFixed(1)}%</b></div></Card>
        <Card><span className="micro">Signal quality</span>
          <div className="between" style={{ marginTop: 8 }}>
            <b style={{ fontSize: 22 }}>{latest?.eeg_quality_score != null ? `${Math.round(latest.eeg_quality_score * 100)}%` : '—'}</b>
            {latest && <Badge color={latest.eeg_quality_flag ? COLORS.normal : COLORS.warning}>{latest.eeg_quality_flag ? 'Good' : 'Poor'}</Badge>}
          </div></Card>
      </div>
      <Card>
        <CardHead title="Task-state score" sub="Per ~25s block · dashed line = effective high-load threshold" />
        <Chart rows={score} series={[{ name: 'Score', color: COLORS.eeg }]} limit={Math.round(thr * 100)}
          limitLabel="High-load p" domain={[0, 100]} suffix="%" height={240} />
      </Card>
      <div className="grid grid-2">
        <Card>
          <CardHead title="Bipolar feature" right={
            <select className="select" value={feature} onChange={(e) => setFeature(e.target.value)}>
              {EEG_FEATURES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>} />
          <Chart key={feature} rows={featRows} series={[{ name: f[1], color: f[2] }]} height={200} />
        </Card>
        <Card>
          <CardHead title="Signal quality" />
          <Chart rows={quality} series={[{ name: 'Quality', color: COLORS.normal }]} domain={[0, 100]} suffix="%" height={200} />
        </Card>
      </div>
      <div className="grid grid-2">
        <Card><CardHead title="EEG calibration" /><KV obj={calib} /></Card>
        <Card>
          <CardHead title="Recent sessions" />
          {eeg.sessions.length ? (
            <table className="data"><thead><tr><th>Session</th><th>Blocks</th><th>Last state</th></tr></thead>
              <tbody>{eeg.sessions.map((s) => (
                <tr key={s.sid}><td>{s.sid.replace('session_', '')}</td><td>{s.blocks}</td>
                  <td><Badge color={s.label === 1 ? COLORS.stress : COLORS.normal}>{s.label === 1 ? 'High load' : 'Low load'}</Badge></td></tr>))}
              </tbody></table>
          ) : <p className="body">No EEG sessions yet.</p>}
        </Card>
      </div>
    </div>
  );
}

function PhenoTab({ userId, name }) {
  const users = useFirebaseValue('phenotyping/users');
  const deviceId = useMemo(() => {
    if (!users) return userId;
    const hit = Object.entries(users).find(([dev, p]) => p?.name === name || p?.name === userId || dev === userId);
    return hit ? hit[0] : userId;
  }, [users, userId, name]);
  const preds = useFirebaseValue(deviceId ? `phenotyping/predictions/${deviceId}` : null);
  const logs = useFirebaseValue(deviceId ? `phenotyping/data_logs/${deviceId}` : null);
  const [feature, setFeature] = useState('avg_dwell');

  const scoreRows = useMemo(() => toRows(Object.values(preds || {})
    .filter((p) => p?.timestamp)
    .map((p) => {
      let v = null;
      if (typeof p.stress_score === 'number') v = Math.round(p.stress_score * 100);
      else if (typeof p.composite_z === 'number') v = Math.min(100, Math.max(5, Math.round((p.composite_z / 3) * 100)));
      return { date: new Date(p.timestamp), value: v };
    })
    .filter((p) => p.value != null && !Number.isNaN(p.date.getTime()))
    .sort((a, b) => a.date - b.date).slice(-60)), [preds]);

  const f = PHENO_FEATURES.find((x) => x[0] === feature);
  const featRows = useMemo(() => toRows(Object.entries(logs || {})
    .map(([k, w]) => ({ date: parseKeyDate(k, w), value: typeof w?.[feature] === 'number' && w[feature] > 0 ? Number(w[feature].toFixed(1)) : null }))
    .filter((p) => p.date && p.value != null)
    .sort((a, b) => a.date - b.date).slice(-60)), [logs, feature]);

  return (
    <div className="stack">
      <Card>
        <CardHead title="Phone stress score" sub={`Device ${deviceId}`} />
        <Chart rows={scoreRows} series={[{ name: 'Score', color: COLORS.stress }]} domain={[0, 100]} suffix="%" height={220}
          empty="No phone-behaviour predictions yet." />
      </Card>
      <Card>
        <CardHead title="Interaction features" right={
          <Seg value={feature} onChange={setFeature} options={PHENO_FEATURES.map(([k, l]) => ({ value: k, label: l }))} />} />
        <Chart key={feature} rows={featRows} series={[{ name: f[1], color: COLORS.brand }]} suffix={f[2]} height={200}
          empty="No typing/scroll logs yet." />
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { userId: routeUid } = useParams();
  const navigate = useNavigate();
  const [users, setUsers] = useState(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('overview');
  const pointer = useLivePointer();
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await api.get('/users');
        if (!cancelled) setUsers(res.data?.users || {});
      } catch {
        if (!cancelled) setUsers((u) => u || {});
      } finally { inFlight.current = false; }
    };
    load();
    const id = setInterval(load, USERS_REFRESH_MS);
    // Refresh as soon as the tab is looked at again (e.g. after registering
    // someone in another tab), not only on the 25s timer.
    window.addEventListener('focus', load);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('focus', load); };
  }, []);

  const entries = useMemo(() => Object.entries(users || {})
    .filter(([uid, r]) => !search || `${uid} ${r?.name || ''}`.toLowerCase().includes(search.toLowerCase()))
    // Live user first, then NEWEST accounts -- a just-registered user (0
    // sessions) used to sink to the bottom of a long list and look missing.
    .sort(([a, ra], [b, rb]) => {
      if (a === pointer.userId) return -1;
      if (b === pointer.userId) return 1;
      return (new Date(rb?.created_at || 0).getTime() || 0) - (new Date(ra?.created_at || 0).getTime() || 0);
    }), [users, search, pointer.userId]);

  const selected = routeUid ? decodeURIComponent(routeUid) : entries[0]?.[0];
  const selRecord = users?.[selected];
  const isLiveUser = !!selected && pointer.userId === selected;
  const totalSessions = Object.values(users || {}).reduce((s, r) => s + (r?.session_count ?? 0), 0);

  return (
    <>
      <div className="kpis">
        <Kpi icon="👥" tint={COLORS.brand} value={users ? Object.keys(users).length : '—'} label="Users" />
        <Kpi icon="🟢" tint={COLORS.normal} value={pointer.userId ? 1 : 0}
          label={pointer.userId ? `Live: ${users?.[pointer.userId]?.name || pointer.userId}` : 'Live now'} />
        <Kpi icon="🗂️" tint={COLORS.warning} value={totalSessions} label="Sessions" />
      </div>

      <div className="admin">
        <Card className="userlist">
          <input placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="items">
            {!users ? <Spinner /> : entries.map(([uid, r]) => (
              <button key={uid} className={`userrow ${uid === selected ? 'on' : ''}`}
                onClick={() => navigate(`/clinical/${encodeURIComponent(uid)}`)}>
                <Avatar name={r?.name || uid} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="name">{r?.name || uid}</div>
                  <div className="sub">@{uid} · {r?.session_count ?? 0} sessions{r?.created_at ? ` · joined ${timeAgo(new Date(r.created_at).getTime())}` : ''}</div>
                </div>
                {uid === pointer.userId && <Badge color={COLORS.normal} dot live>Live</Badge>}
              </button>
            ))}
            {users && !entries.length && <p className="body" style={{ padding: 10 }}>No users match.</p>}
          </div>
        </Card>

        <div style={{ minWidth: 0 }}>
          {selected ? (
            <>
              <div className="between" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                <div>
                  <h2 className="display">{selRecord?.name || selected}</h2>
                  <span className="caption">@{selected} {isLiveUser ? '· wearing the devices now' : ''}</span>
                </div>
                <Seg value={tab} onChange={setTab} options={[
                  { value: 'overview', label: 'Fusion' }, { value: 'ring', label: 'Ring' },
                  { value: 'eeg', label: 'EEG' }, { value: 'pheno', label: 'Phone' },
                ]} />
              </div>
              {tab === 'overview' && <OverviewTab key={selected} userId={selected} liveSid={isLiveUser ? pointer.sessionId : null} isLive={isLiveUser} />}
              {tab === 'ring' && <RingTab key={selected} userId={selected} />}
              {tab === 'eeg' && <EegTab key={selected} userId={selected} isLiveUser={isLiveUser} />}
              {tab === 'pheno' && <PhenoTab key={selected} userId={selected} name={selRecord?.name} />}
            </>
          ) : <Card><p className="body">Select a user.</p></Card>}
        </div>
      </div>
    </>
  );
}
