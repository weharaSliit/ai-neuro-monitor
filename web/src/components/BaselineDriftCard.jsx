import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { COLORS } from '../lib/levels';
import { Card, CardHead, Badge, Seg } from './ui';
import Chart from './Chart';

// Web twin of StressApp/modules/shared/BaselineDriftCard.js -- same data
// (baseline.drift + drift-history + per-session averages), same visuals:
// a calm-vs-last-7-days comparison scale with the ±15 steady zone, a plain
// sentence, and an Each session / Each week chart against "Your calm" and
// the shift line.
const DRIFT_BAND = 15;
const MIN_RECENT = 10;
const SESSIONS_FOR_CHART = 8;

function ComparisonScale({ calm, recent }) {
  const lo = Math.max(0, calm - DRIFT_BAND);
  const hi = Math.min(100, calm + DRIFT_BAND);
  const inside = recent >= lo && recent <= hi;
  const recentColor = inside ? COLORS.brand : COLORS.warning;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ position: 'relative', height: 14, borderRadius: 7, background: COLORS.borderSoft }}>
        <div title="Normal range" style={{ position: 'absolute', top: 0, bottom: 0, left: `${lo}%`, width: `${hi - lo}%`, borderRadius: 7, background: COLORS.normal + '40' }} />
        <div title="Your calm level" style={{ position: 'absolute', top: -4, left: `calc(${calm}% - 2px)`, width: 4, height: 22, borderRadius: 2, background: COLORS.normal }} />
        <div title="Your last week" style={{ position: 'absolute', top: -1, left: `calc(${recent}% - 8px)`, width: 16, height: 16, borderRadius: 8, border: '3px solid #fff', background: recentColor, boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
      </div>
      <div className="between" style={{ marginTop: 4 }}><span className="caption">0%</span><span className="caption">50%</span><span className="caption">100%</span></div>
      <div className="legend">
        <span><i style={{ background: COLORS.normal, height: 10, width: 10, borderRadius: 5 }} />Your calm level</span>
        <span><i style={{ background: recentColor, height: 10, width: 10, borderRadius: 5 }} />Your last week</span>
        <span><i style={{ background: COLORS.normal + '40', height: 10, width: 16, borderRadius: 5 }} />Normal range</span>
      </div>
    </div>
  );
}

export default function BaselineDriftCard({ userId, ringCal }) {
  const [weeks, setWeeks] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [view, setView] = useState('session');

  useEffect(() => {
    if (!userId || !ringCal?.exists) return undefined;
    let cancelled = false;
    api.get(`/baseline/${userId}/drift-history`)
      .then((r) => { if (!cancelled) setWeeks(r.data?.weeks || []); })
      .catch(() => { if (!cancelled) setWeeks([]); });
    (async () => {
      try {
        const h = await api.get(`/history/${userId}`);
        const ids = Object.keys(h.data?.sessions || {}).sort().slice(-SESSIONS_FOR_CHART);
        const results = await Promise.all(ids.map((sid) => api.get(`/history/${userId}/${sid}`).then((r) => r.data).catch(() => null)));
        const pts = results.map((d) => {
          const preds = Object.values(d?.predictions || {}).filter((p) => p?.prob_stress != null && p.timestamp);
          if (!preds.length) return null;
          const mean = preds.reduce((s, p) => s + p.prob_stress, 0) / preds.length;
          const first = preds.map((p) => new Date(p.timestamp).getTime()).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b)[0];
          return first ? { date: new Date(first), values: [Math.round(mean * 100)] } : null;
        }).filter(Boolean).sort((a, b) => a.date - b.date);
        if (!cancelled) setSessions(pts);
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, ringCal?.exists]);

  const weekRows = useMemo(() => (weeks || [])
    .filter((w) => w.mean_prob_stress != null)
    .map((w) => ({ date: new Date(w.week_start), values: [Math.round(w.mean_prob_stress * 100)] })), [weeks]);

  if (!ringCal?.exists) return null;
  const d = ringCal?.drift || {};
  const checked = !!d.checked;
  const calm = d.original_resting_mean != null ? Math.round(d.original_resting_mean * 100) : null;
  const recent = d.recent_mean != null ? Math.round(d.recent_mean * 100) : null;
  const diff = calm != null && recent != null ? recent - calm : null;
  const drifted = !!d.drift_detected;

  // Plain words only -- no numbers or +/- jargon.
  let sentence;
  if (!checked) {
    sentence = 'Keep wearing your ring — after a few more readings we can compare your last week with your calm level.';
  } else if (!drifted) {
    sentence = 'Your last week looks like your calm level — all good.';
  } else if (diff > 0) {
    sentence = 'Your last week has been more stressed than your calm level. Recalibrating will keep your readings accurate.';
  } else {
    sentence = 'Your last week has been calmer than when you calibrated. Recalibrating will keep your readings accurate.';
  }

  const weekOk = weekRows.length >= 2;
  const showWeek = view === 'week' && weekOk;
  const rows = showWeek ? weekRows : (sessions || []);

  return (
    <Card>
      <CardHead
        title="Has your baseline changed?"
        right={<Badge color={!checked ? COLORS.textMuted : drifted ? COLORS.warning : COLORS.normal}>
          {!checked ? 'Too early' : drifted ? 'Changed' : 'All good'}</Badge>}
      />
      <p className="body">{sentence}</p>

      <div className="between" style={{ marginTop: 18, marginBottom: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>{showWeek ? 'Week by week' : 'Session by session'}</b>
        <Seg value={showWeek ? 'week' : 'session'} onChange={(v) => { if (v === 'session' || weekOk) setView(v); }}
          options={[{ value: 'session', label: 'Each session' }, { value: 'week', label: weekOk ? 'Each week' : 'Each week (soon)' }]} />
      </div>
      {rows.length >= 2 ? (
        // Shift line + calm line; zones off -- this isn't a stress limit.
        <Chart key={showWeek ? 'week' : 'session'} rows={rows} series={[{ name: 'Average', color: COLORS.brand }]}
          domain={[0, 100]} suffix="%" height={210}
          limit={calm != null ? Math.min(100, calm + DRIFT_BAND) : null} limitLabel="Too high"
          zones={false} limitColor={COLORS.warningDark} />
      ) : (
        <div className="chart-empty" style={{ height: 120 }}>
          {sessions === null ? 'Loading…' : 'Your chart appears after two sessions with the ring.'}
        </div>
      )}
      {calm != null && rows.length >= 2 && (
        <p className="caption" style={{ marginTop: 6 }}>Dots above the dashed line mean your readings have moved away from your calm level.</p>
      )}
    </Card>
  );
}
