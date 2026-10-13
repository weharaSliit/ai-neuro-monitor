import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, limitToLast, orderByKey, query, ref } from 'firebase/database';
import { db } from '../lib/firebase';
import { api, eegApi } from '../lib/api';
import { useLivePointer } from '../hooks/useLive';
import {
  COLORS, DEFAULT_EEG_THRESHOLD, DEFAULT_RING_THRESHOLD, LEVEL_COLOR, OVERALL_WORDS, fusionKeyToMs,
  levelOf, sortedWindowKeys, timeAgo,
} from '../lib/levels';
import { Badge, Card, CardHead, Spinner } from '../components/ui';

// All users at a glance: calibration state of both devices and each
// person's latest fused session. Click a row for that session's windows.
const USERS_REFRESH_MS = 30000;
const SPARK_POINTS = 40;

const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

// One user's latest fusion session (fusion_en/{uid}/{sid}), read once --
// only the last session key, not the whole tree.
async function latestFusionSession(uid) {
  const snap = await get(query(ref(db, `fusion_en/${uid}`), orderByKey(), limitToLast(1)));
  const val = snap.val();
  if (!val) return null;
  const [sid, windows] = Object.entries(val)[0];
  return windows && typeof windows === 'object' ? { sid, windows } : null;
}

function summarise(session) {
  if (!session) return null;
  const keys = sortedWindowKeys(session.windows);
  const rows = keys.map((k) => ({ key: Number(k), ms: fusionKeyToMs(k), ...session.windows[k] }));
  const fused = rows.filter((w) => w.fused_probability != null);
  const last = fused[fused.length - 1] || null;
  const withAny = rows.filter((w) => w.prob_eeg != null || w.prob_hrv_gsr != null);
  const both = withAny.filter((w) => w.prob_eeg != null && w.prob_hrv_gsr != null).length;
  return {
    sid: session.sid,
    rows,
    last,
    lastMs: rows.length ? rows[rows.length - 1].ms : null,
    spark: fused.slice(-SPARK_POINTS).map((w) => w.fused_probability),
    sparkThr: last?.fused_threshold ?? null,
    bothShare: withAny.length ? both / withAny.length : null,
    nWindows: withAny.length,
  };
}

// Mind limit: personal-score threshold from the latest calibration, plus
// the onboarding responsiveness check (EEG left out of fusion if failed).
function mindLimit(cal) {
  if (!cal) return { value: null, word: 'Unknown', color: COLORS.textMuted };
  if (cal.eeg_responsive === false) {
    return { value: cal.personal_high_load_p, word: 'Not responsive · excluded', color: COLORS.stress };
  }
  if (cal.personal_high_load_p != null) {
    return { value: cal.personal_high_load_p, word: cal.eeg_responsive ? 'Personal · checked' : 'Personal', color: COLORS.normal };
  }
  return { value: cal.population_high_load_p ?? DEFAULT_EEG_THRESHOLD, word: 'Standard', color: COLORS.textMuted };
}

function bodyLimit(cal) {
  if (!cal) return { value: null, word: 'Unknown', color: COLORS.textMuted };
  if (cal.personal_stress_threshold != null) return { value: cal.personal_stress_threshold, word: 'Personal', color: COLORS.normal };
  return { value: DEFAULT_RING_THRESHOLD, word: cal.exists ? 'Baseline only' : 'Standard', color: COLORS.textMuted };
}

function Spark({ values, threshold, width = 120, height = 30 }) {
  if (!values || values.length < 2) return <span className="muted-cell">—</span>;
  const x = (i) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v) => height - 2 - Math.min(1, Math.max(0, v)) * (height - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg className="spark" width={width} height={height} role="img" aria-label="Recent fused stress">
      {threshold != null && <line className="spark-thr" x1="0" x2={width} y1={y(threshold)} y2={y(threshold)} />}
      <path d={d} fill="none" stroke={COLORS.brand} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function Limit({ limit }) {
  return (
    <div className="thr">
      <b>{pct(limit.value)}</b>
      <Badge color={limit.color}>{limit.word}</Badge>
    </div>
  );
}

const COLUMNS = [
  { key: 'name', label: 'User', get: (r) => (r.name || r.uid).toLowerCase() },
  { key: 'sessions', label: 'Sessions', get: (r) => r.sessions ?? -1 },
  { key: 'active', label: 'Last reading', get: (r) => r.fusion?.lastMs ?? 0 },
  { key: 'mind', label: 'Mind limit', get: (r) => mindLimit(r.eegCal).value ?? -1 },
  { key: 'body', label: 'Body limit', get: (r) => bodyLimit(r.ringCal).value ?? -1 },
  { key: 'fused', label: 'Latest fused', get: (r) => r.fusion?.last?.fused_probability ?? -1 },
  { key: 'trend', label: 'Recent fused', get: null },
  { key: 'both', label: 'Both signals', get: (r) => r.fusion?.bothShare ?? -1 },
];

export default function UsersOverview() {
  const navigate = useNavigate();
  const pointer = useLivePointer();
  const [users, setUsers] = useState(null);
  const [details, setDetails] = useState({});
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'active', dir: -1 });
  const [selected, setSelected] = useState(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await api.get('/users');
        const list = res.data?.users || {};
        if (cancelled) return;
        setUsers(list);
        const uids = Object.keys(list);
        const loaded = await Promise.all(uids.map(async (uid) => {
          const enc = encodeURIComponent(uid);
          const [eegCal, ringCal, session] = await Promise.all([
            eegApi.get(`/admin/calibration/${enc}`).then((r) => r.data).catch(() => null),
            api.get(`/admin/baseline/${enc}`).then((r) => r.data).catch(() => null),
            latestFusionSession(uid).catch(() => null),
          ]);
          return [uid, { eegCal, ringCal, fusion: summarise(session) }];
        }));
        if (!cancelled) setDetails(Object.fromEntries(loaded));
      } catch {
        if (!cancelled) setUsers((u) => u || {});
      } finally { inFlight.current = false; }
    };
    load();
    const id = setInterval(load, USERS_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const col = COLUMNS.find((c) => c.key === sort.key);
    return Object.entries(users || {})
      .map(([uid, r]) => ({ uid, name: r?.name, sessions: r?.session_count, ...(details[uid] || {}) }))
      .filter((r) => !q || `${r.uid} ${r.name || ''}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = col.get(a); const vb = col.get(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
      });
  }, [users, details, search, sort]);

  const sel = rows.find((r) => r.uid === selected) || null;
  const loadingDetails = users && Object.keys(details).length === 0 && Object.keys(users).length > 0;

  const header = (c) => (
    <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
      {c.get ? (
        <button className="th-sort" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}>
          {c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
        </button>
      ) : c.label}
    </th>
  );

  return (
    <div className="stack">
      <Card>
        <CardHead title="All users" sub="Calibration of both devices and each person's latest fused session · click a row for details"
          right={<input className="search" placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} />} />
        {!users ? <Spinner /> : (
          <div className="users-scroll">
            <table className="data users">
              <thead><tr>{COLUMNS.map(header)}</tr></thead>
              <tbody>
                {rows.map((r) => {
                  const last = r.fusion?.last;
                  const level = levelOf(last?.fused_probability, last?.fused_threshold);
                  const live = r.uid === pointer.userId;
                  return (
                    <tr key={r.uid} tabIndex={0} className={`clickable ${r.uid === selected ? 'sel' : ''}`}
                      onClick={() => setSelected(r.uid === selected ? null : r.uid)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r.uid === selected ? null : r.uid); } }}>
                      <td>
                        <div className="name-cell">{r.name || r.uid}</div>
                        <span className="caption">@{r.uid}</span>{' '}
                        {live && <Badge color={COLORS.normal} dot live>Live</Badge>}
                      </td>
                      <td>{r.sessions ?? '—'}</td>
                      <td>{r.fusion?.lastMs ? timeAgo(r.fusion.lastMs) : <span className="muted-cell">{loadingDetails ? '…' : 'never'}</span>}</td>
                      <td><Limit limit={mindLimit(r.eegCal)} /></td>
                      <td><Limit limit={bodyLimit(r.ringCal)} /></td>
                      <td>{last
                        ? <Badge color={LEVEL_COLOR[level] || COLORS.brand} dot>{pct(last.fused_probability)} · {OVERALL_WORDS[level] || '—'}</Badge>
                        : <span className="muted-cell">—</span>}</td>
                      <td><Spark values={r.fusion?.spark} threshold={r.fusion?.sparkThr} /></td>
                      <td>{r.fusion?.bothShare != null
                        ? <span title={`${r.fusion.nWindows} windows with a reading`}>{pct(r.fusion.bothShare)}</span>
                        : <span className="muted-cell">—</span>}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={COLUMNS.length} className="muted-cell">No users match.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {sel && (
        <Card>
          <CardHead title={`${sel.name || sel.uid} · latest session`}
            sub={sel.fusion ? `${sel.fusion.sid} · ${sel.fusion.nWindows} windows with a reading (25 s each)` : 'No fused session yet'}
            right={<button className="btn ghost sm" onClick={() => navigate(`/clinical/${encodeURIComponent(sel.uid)}`)}>Open in Clinical →</button>} />
          {sel.fusion?.rows.length ? (
            <div className="window-table">
              <table className="data">
                <thead>
                  <tr>
                    <th>Time</th><th>Mind (EEG)</th><th>Mind limit</th><th>Body (HRV/GSR)</th><th>Body limit</th>
                    <th>Fused</th><th>Fused limit</th><th>Result</th><th>Agreement</th><th>EEG left out because</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sel.fusion.rows].reverse()
                    .filter((w) => w.prob_eeg != null || w.prob_hrv_gsr != null || w.eeg_excluded_reason)
                    .map((w) => (
                      <tr key={w.key}>
                        <td>{new Date(w.ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                        <td>{w.prob_eeg != null ? pct(w.prob_eeg) : <span className="muted-cell">—</span>}</td>
                        <td className={w.threshold_eeg == null ? 'muted-cell' : ''}>{pct(w.threshold_eeg)}</td>
                        <td>{w.prob_hrv_gsr != null ? pct(w.prob_hrv_gsr) : <span className="muted-cell">—</span>}</td>
                        <td className={w.threshold_hrv_gsr == null ? 'muted-cell' : ''}>{pct(w.threshold_hrv_gsr)}</td>
                        <td>{pct(w.fused_probability)}</td>
                        <td className={w.fused_threshold == null ? 'muted-cell' : ''}>{pct(w.fused_threshold)}</td>
                        <td>{w.fused_label == null ? <span className="muted-cell">—</span>
                          : <Badge color={w.fused_label === 1 ? COLORS.stress : COLORS.normal}>{w.fused_label === 1 ? 'High' : 'Normal'}</Badge>}</td>
                        <td className={!w.modality_concordance || w.modality_concordance === 'insufficient_data' ? 'muted-cell' : ''}>
                          {w.modality_concordance === 'insufficient_data' ? 'one signal' : (w.modality_concordance || '—')}</td>
                        <td className={w.eeg_excluded_reason ? '' : 'muted-cell'}>{(w.eeg_excluded_reason || '—').replace(/_/g, ' ')}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : <p className="body">No fused windows for this user yet.</p>}
        </Card>
      )}
    </div>
  );
}
