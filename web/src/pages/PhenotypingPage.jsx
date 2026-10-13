import { useEffect, useMemo, useState } from 'react';
import { limitToLast, onValue, orderByKey, query, ref } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { useFirebaseValue, useNow } from '../hooks/useLive';
import { COLORS, timeAgo } from '../lib/levels';
import { Badge, Card, CardHead, Stat } from '../components/ui';
import Chart, { toRows } from '../components/Chart';

// Web counterpart of the app's Phenotyping hub (PhenotypingScreen.js).
// The phone collects the behaviour (typing, scrolling, app switching) with
// its accessibility sensor; a browser cannot, so this page shows what the
// phone has already stored under phenotyping/*/{userId}.
const FRESH_MS = 90 * 1000;

// Last N children of a path, keyed order, as [[key, value], ...].
function useLastChildren(path, n) {
  const [rows, setRows] = useState(undefined);
  useEffect(() => {
    if (!path) { setRows(undefined); return undefined; }
    const q = query(ref(db, path), orderByKey(), limitToLast(n));
    return onValue(q, (snap) => {
      const v = snap.val();
      setRows(v ? Object.entries(v).sort((a, b) => a[0].localeCompare(b[0])) : []);
    }, () => setRows([]));
  }, [path, n]);
  return rows;
}

// Window keys look like 20260829_093012.
function keyToDate(k) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(k || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

function zOf(v, mean, std) {
  if (v == null || !mean || !std) return 0;
  return Math.abs((v - mean) / std);
}
const zColor = (z) => (z > 2 ? COLORS.stress : z > 1 ? COLORS.warning : COLORS.normal);

function statusFrom(calibrated, pred) {
  if (!calibrated) return { word: 'Learning you', color: COLORS.brand, icon: '⚖️' };
  if (pred) {
    const label = String(pred.label || '').toLowerCase();
    const score = Number(pred.stress_score || 0);
    if (pred.is_anomaly || score > 0.85 || label.includes('high')) return { word: 'Stressed', color: COLORS.stress, icon: '😰' };
    if (score > 0.6 || label.includes('pre')) return { word: 'Rising', color: COLORS.warning, icon: '😐' };
    if (score > 0.4) return { word: 'A bit tense', color: COLORS.warning, icon: '😕' };
  }
  return { word: 'Calm', color: COLORS.normal, icon: '😊' };
}

export default function PhenotypingPage() {
  const { user } = useAuth();
  const userId = user?.userId;
  const now = useNow(15000);

  const profile = useFirebaseValue(userId ? `phenotyping/users/${userId}` : null);
  const baselines = profile?.baselines || null;
  const preds = useLastChildren(userId ? `phenotyping/predictions/${userId}` : null, 50);
  const logs = useLastChildren(userId ? `phenotyping/data_logs/${userId}` : null, 20);
  const loading = profile === undefined || preds === undefined || logs === undefined;

  // ── Prediction history ──
  const predList = useMemo(() => (preds || [])
    .map(([, v]) => v)
    .filter((v) => v && v.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)), [preds]);
  const latestPred = predList[predList.length - 1] || null;
  const predAgeMs = latestPred ? now - new Date(latestPred.timestamp).getTime() : null;

  // ── Learning phase (7 days) ──
  const calib = useMemo(() => {
    const created = profile?.created_at ? new Date(profile.created_at) : null;
    if (!created || Number.isNaN(created.getTime())) return null;
    const day = Math.min(Math.floor(Math.max(0, now - created.getTime()) / 86400000) + 1, 99);
    const isCalibrated = !!profile?.is_calibrated;
    return { day, isCalibrated, phase: isCalibrated ? 'active' : day <= 7 ? 'learning' : 'awaiting' };
  }, [profile, now]);
  const status = statusFrom(calib?.isCalibrated, latestPred);

  // ── Phone-habit windows ──
  const winList = useMemo(() => (logs || []).map(([k, v]) => ({ k, date: keyToDate(k), ...v })), [logs]);
  const win = winList[winList.length - 1] || null;
  const winAge = win?.date ? now - win.date.getTime() : null;
  const moving = win?.data_valid === false;

  const signals = useMemo(() => {
    if (!win) return [];
    const bl = baselines || {};
    const learning = !calib?.isCalibrated;
    const perMin = (w) => Math.min((w.app_switch_rate || 0) * 60, 10);
    const series = (get) => toRows(winList
      .filter((w) => w.date && get(w) > 0)
      .map((w) => ({ date: w.date, value: Number(get(w).toFixed(1)) })));
    const dwellZ = learning ? 0 : zOf(win.avg_dwell, bl.avg_dwell?.mean || 135, bl.avg_dwell?.std || 15);
    const scrollZ = learning ? 0 : zOf(win.scroll_velocity, bl.scroll_velocity?.mean || 450, bl.scroll_velocity?.std || 200);
    const sw = perMin(win);
    const swZ = sw > 4 ? 3 : sw > 2.5 ? 1.5 : 0;
    return [
      { id: 'dwell', icon: '⌨️', title: 'Keyboard patterns', sub: 'Typing rhythm and key-press duration',
        value: `${Math.round(win.avg_dwell || 0)} ms`, z: dwellZ, base: bl.avg_dwell?.mean, rows: series((w) => w.avg_dwell || 0), unit: ' ms' },
      { id: 'scroll', icon: '📜', title: 'Screen scrolling', sub: 'Scroll speed and frequency',
        value: `${Math.round(win.scroll_velocity || 0)} px/s`, z: scrollZ, base: bl.scroll_velocity?.mean, rows: series((w) => w.scroll_velocity || 0), unit: ' px/s' },
      { id: 'switch', icon: '📱', title: 'Screen activity', sub: 'How often you switch apps',
        value: `${sw.toFixed(1)} /min`, z: swZ, base: null, rows: series(perMin), unit: ' /min' },
    ];
  }, [win, winList, baselines, calib]);

  const scoreRows = useMemo(() => toRows(predList.map((p) => ({
    date: new Date(p.timestamp),
    value: Math.round(Number(p.stress_score || 0) * 100),
  }))), [predList]);

  const hasData = !!(win || latestPred || profile);

  if (loading) return <div className="spinner" />;

  return (
    <div className="stack">
      <div className="greet">
        <span className="micro">Digital phenotyping</span>
        <h1 className="display" style={{ marginTop: 4 }}>Your phone habits</h1>
        <p className="body" style={{ marginTop: 4 }}>
          How you type, scroll and switch apps can reflect how stressed you are. Your phone collects this quietly in the background and the results appear here.
        </p>
      </div>

      {!hasData && (
        <Card>
          <CardHead title="No phone data yet" />
          <p className="body">
            Phone behaviour can only be collected by the MindPulse app on your Android phone. A website cannot see your typing or scrolling.
          </p>
          <ol className="steps-list">
            <li>Install the MindPulse app and sign in with this same account ({userId}).</li>
            <li>Open <b>Phenotyping</b> in the app and switch the behaviour sensor on.</li>
            <li>Use your phone normally. After about 7 days it learns your own baseline, then results show up here.</li>
          </ol>
        </Card>
      )}

      {hasData && (
        <>
          <div className="grid grid-hero">
            <Card>
              <CardHead
                title="Phone-behaviour status"
                right={calib?.isCalibrated && latestPred
                  ? <Badge color={predAgeMs < FRESH_MS ? COLORS.normal : '#989294'} dot live={predAgeMs < FRESH_MS}>
                      {predAgeMs < FRESH_MS ? 'Live' : `Last reading ${timeAgo(new Date(latestPred.timestamp).getTime())}`}
                    </Badge>
                  : null}
              />
              <div className="row" style={{ gap: 14, alignItems: 'center' }}>
                <div className="tech-icon big" style={{ background: `${status.color}22` }}>{status.icon}</div>
                <div>
                  <h2 className="display" style={{ color: status.color }}>{status.word}</h2>
                  <p className="body">
                    {calib?.isCalibrated
                      ? (latestPred ? `Stress score ${Math.round(Number(latestPred.stress_score || 0) * 100)}%` : 'Waiting for the first reading')
                      : calib?.phase === 'awaiting' ? 'Finishing your personal baseline'
                      : calib ? `Learning your normal pattern · day ${Math.min(calib.day, 7)} of 7`
                      : 'Turn the sensor on in the app to start learning'}
                  </p>
                </div>
              </div>
              {calib && !calib.isCalibrated && (
                <div style={{ marginTop: 16 }}>
                  <div className="progress"><span style={{ width: `${Math.min(100, (Math.min(calib.day, 7) / 7) * 100)}%` }} /></div>
                  <p className="caption" style={{ marginTop: 6 }}>Colours stay neutral until your own baseline is ready, so nothing is judged against an average.</p>
                </div>
              )}
              {latestPred?.is_anomaly && (
                <p className="error" style={{ marginTop: 14 }}>Your phone behaviour looks different from your usual pattern right now.</p>
              )}
            </Card>

            <Card>
              <CardHead title="Right now" sub={win?.date ? `Window ${timeAgo(win.date.getTime())}` : 'No window yet'} />
              <div className="kv">
                <Stat label="Typing" value={win ? Math.round(win.avg_dwell || 0) : null} unit="ms" tint={COLORS.brand} />
                <Stat label="Scrolling" value={win ? Math.round(win.scroll_velocity || 0) : null} unit="px/s" tint={COLORS.brand} />
                <Stat label="App switches" value={win ? Math.min((win.app_switch_rate || 0) * 60, 10).toFixed(1) : null} unit="/min" tint={COLORS.brand} />
                <Stat label="Movement" value={win ? (moving ? 'Moving' : 'Still') : null} tint={moving ? COLORS.warning : COLORS.normal} />
              </div>
              {winAge != null && winAge > FRESH_MS && (
                <p className="caption" style={{ marginTop: 12 }}>The sensor is idle when you are not using the phone, so this is normal.</p>
              )}
            </Card>
          </div>

          <Card>
            <CardHead title="Stress score over time" sub="From your phone behaviour only, higher means more stress" />
            <Chart rows={scoreRows} series={[{ name: 'Phone-behaviour stress', color: COLORS.brand }]}
                   domain={[0, 100]} suffix="%" zones={false} limit={null} empty="No readings yet" />
          </Card>

          {signals.length > 0 && (
            <div className="sig-grid">
              {signals.map((s) => (
                <Card key={s.id}>
                  <CardHead
                    title={`${s.icon} ${s.title}`}
                    sub={s.sub}
                    right={<b style={{ color: zColor(s.z), fontSize: 18 }}>{s.value}</b>}
                  />
                  {s.base != null && (
                    <p className="caption" style={{ marginBottom: 6 }}>Your calm baseline is about {Math.round(s.base)}{s.unit}</p>
                  )}
                  <Chart rows={s.rows} series={[{ name: s.title, color: zColor(s.z) }]} height={150}
                         suffix={s.unit} zones={false} limit={null} empty="No windows yet" />
                </Card>
              ))}
            </div>
          )}

          <Card className="flat">
            <p className="body">
              This data is collected by the app on your phone and is never read by the website. The values shown are timing summaries (how long keys are held, how fast you scroll, how often you switch apps).
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
