import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardHead, Spinner } from './ui';
import { findTechnique } from '../lib/techniques';
import {
  BASELINE_MARGIN, excessArea, mean, naturalCurve, spearman, useUserEvidence,
} from '../lib/relaxEvidence';
import './relaxEvidence.css';

// Admin evidence view for the Relaxation guide: what the intervention system did for every user,
// read live from Firebase (recommendations, stress during the session, loop decisions, results,
// and what the model has learned).

const FAMILY = {
  guided_meditation: 'Guided meditation & breathwork',
  breathing_garden: 'Breathing garden',
  cognitive_destress: 'Cognitive de-stress',
};
const techName = (id) => (id ? (FAMILY[id] || findTechnique(id)?.title || id.replace(/_/g, ' ')) : '—');

const C = {
  brand: '#6E68B2', normal: '#5E935A', warn: '#E8A238', stress: '#E56B4E', muted: '#989294',
  physio: '#E56B4E', pheno: '#3B82F6', sys: '#6E68B2', man: '#E8A238',
};
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v)}%`);
const dec = (v, n = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(n));
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDur = (sec) => {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60); const s = Math.round(sec % 60);
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
};

// ── tiny SVG charts ────────────────────────────────────────────────────────
const W = 640; const PAD = { l: 38, r: 12, t: 14, b: 26 };

function Axes({ h, xTicks, yTicks, xFmt }) {
  const ih = h - PAD.t - PAD.b;
  return (
    <g>
      {yTicks.map((y) => (
        <g key={y}>
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih * (1 - y)} y2={PAD.t + ih * (1 - y)} className="rev-grid" />
          <text x={PAD.l - 6} y={PAD.t + ih * (1 - y) + 4} textAnchor="end" className="rev-tick">{y.toFixed(2).replace(/0$/, '')}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={t.x} x={t.px} y={h - 8} textAnchor="middle" className="rev-tick">{xFmt(t.x)}</text>
      ))}
    </g>
  );
}

function LineChart({ series, markers = [], height = 250, xFmt = (v) => v, xLabel }) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <p className="rev-empty">Not enough readings yet to draw a line.</p>;
  const xMin = Math.min(...all.map((p) => p.x)); const xMax = Math.max(...all.map((p) => p.x));
  const span = xMax - xMin || 1;
  const ih = height - PAD.t - PAD.b; const iw = W - PAD.l - PAD.r;
  const px = (x) => PAD.l + ((x - xMin) / span) * iw;
  const py = (y) => PAD.t + ih * (1 - Math.max(0, Math.min(1, y)));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ x: xMin + span * f, px: px(xMin + span * f) }));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="rev-svg" role="img">
        <Axes h={height} xTicks={xTicks} yTicks={[0, 0.25, 0.5, 0.75, 1]} xFmt={xFmt} />
        {series.map((s) => s.band && (
          <rect key={`${s.name}-b`} x={PAD.l} width={iw} y={py(s.band[1])} height={Math.abs(py(s.band[0]) - py(s.band[1]))} fill={s.color} opacity="0.1" />
        ))}
        {series.map((s) => (s.points.length > 1 || s.dots) && (
          <g key={s.name}>
            {s.points.length > 1 && !s.dots && (
              <polyline fill="none" stroke={s.color} strokeWidth={s.width || 2.4} strokeDasharray={s.dash || ''}
                strokeLinejoin="round" points={s.points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} />
            )}
            {s.dots && s.points.map((p, i) => <circle key={i} cx={px(p.x)} cy={py(p.y)} r="4" fill={p.color || s.color} />)}
          </g>
        ))}
        {markers.map((m, i) => (
          <g key={i}>
            <line x1={px(m.x)} x2={px(m.x)} y1={PAD.t} y2={PAD.t + ih} stroke={m.color} strokeDasharray="3 3" opacity="0.8" />
            <text x={px(m.x)} y={PAD.t + 9 + (i % 3) * 10} textAnchor="middle" className="rev-mark" fill={m.color}>{m.label}</text>
          </g>
        ))}
      </svg>
      <div className="rev-legend">
        {series.map((s) => (
          <span key={s.name}><i style={{ background: s.color, borderTop: s.dash ? `2px dashed ${s.color}` : undefined }} />{s.name}</span>
        ))}
        {xLabel && <em>{xLabel}</em>}
      </div>
    </div>
  );
}

function Bars({ items, max, fmt = (v) => dec(v), height = 28 }) {
  if (!items.length) return <p className="rev-empty">No data yet.</p>;
  const top = max ?? Math.max(...items.map((i) => i.value || 0), 0.0001);
  return (
    <div className="rev-bars">
      {items.map((it) => (
        <div key={it.label} className="rev-bar-row" style={{ minHeight: height }}>
          <span className="rev-bar-label" title={it.label}>{it.label}</span>
          <div className="rev-bar-track">
            <div className="rev-bar-fill" style={{ width: `${Math.max(2, ((it.value || 0) / top) * 100)}%`, background: it.color || C.brand }} />
          </div>
          <span className="rev-bar-val">{fmt(it.value)}{it.sub ? <small> {it.sub}</small> : null}</span>
        </div>
      ))}
    </div>
  );
}

function Scatter({ points, xLabel, yLabel, height = 220 }) {
  if (points.length < 2) return <p className="rev-empty">Needs at least two finished sessions with a rating.</p>;
  const ih = height - PAD.t - PAD.b; const iw = W - PAD.l - PAD.r;
  const px = (x) => PAD.l + ((x - 1) / 4) * iw;
  const py = (y) => PAD.t + ih * (1 - y / 100);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="rev-svg">
        {[0, 25, 50, 75, 100].map((y) => (
          <g key={y}>
            <line x1={PAD.l} x2={W - PAD.r} y1={py(y)} y2={py(y)} className="rev-grid" />
            <text x={PAD.l - 6} y={py(y) + 4} textAnchor="end" className="rev-tick">{y}</text>
          </g>
        ))}
        {[1, 2, 3, 4, 5].map((x) => <text key={x} x={px(x)} y={height - 8} textAnchor="middle" className="rev-tick">{x}★</text>)}
        {points.map((p, i) => <circle key={i} cx={px(p.x)} cy={py(p.y)} r="5.5" fill={p.color} opacity="0.8" />)}
      </svg>
      <div className="rev-legend"><em>{xLabel} (x) · {yLabel} (y)</em></div>
    </div>
  );
}

// ── pieces ─────────────────────────────────────────────────────────────────
function liveInfo(session) {
  if (!session || !session.samples.length) return null;
  const last = session.samples[session.samples.length - 1];
  const ageSec = Date.now() / 1000 - last.t;
  return { last, ageSec, live: !session.hasResult && ageSec < 120 };
}

function LiveCard({ session }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []);
  const info = liveInfo(session);
  const lastCheck = session ? [...session.events].reverse().find((e) => e.type === 'loop_check') : null;
  return (
    <Card>
      <CardHead title="Live now" right={<Badge color={info?.live ? C.normal : C.muted} dot live={!!info?.live}>{info?.live ? 'Session running' : 'Idle'}</Badge>} />
      {!session ? <p className="rev-empty">No sessions logged for this user yet.</p> : (
        <div className="rev-kv">
          <div><span>Technique</span><b>{techName(session.technique)}</b></div>
          <div><span>Started by</span><b>{session.condition === 'system' ? 'Recommendation' : session.condition === 'manual' ? 'Chosen by user' : '—'}</b></div>
          <div><span>Latest stress score</span><b>{info ? dec(info.last.p) : '—'}</b></div>
          <div><span>Stream</span><b>{info?.last.src === 'physio' ? 'Ring / earbud' : info?.last.src === 'phenotyping' ? 'Phone behaviour' : '—'}</b></div>
          <div><span>Last reading</span><b>{info ? `${Math.round(info.ageSec)}s ago` : '—'}</b></div>
          <div><span>Loop decision</span><b>{lastCheck ? `${lastCheck.data?.action} (${fmtDur(lastCheck.data?.elapsed)})` : '—'}</b></div>
        </div>
      )}
    </Card>
  );
}

const EVENT_STYLE = {
  recommended: { label: 'R', color: C.brand },
  started: { label: 'S', color: C.normal },
  switched: { label: 'SW', color: '#8B5CF6' },
  finished: { label: 'F', color: C.muted },
  rated: { label: '★', color: C.warn },
};

function SessionTimeline({ sessions, value, onChange }) {
  const s = sessions.find((x) => x.key === value) || sessions[sessions.length - 1];
  if (!s) return null;
  const t0 = s.samples[0]?.t ?? s.startSec ?? 0;
  const rel = (t) => t - t0;
  const mSec = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;

  const physio = s.samples.filter((p) => p.src === 'physio').map((p) => ({ x: rel(p.t), y: p.p }));
  const pheno = s.samples.filter((p) => p.src !== 'physio').map((p) => ({ x: rel(p.t), y: p.p }));
  const duration = s.samples.length ? rel(s.samples[s.samples.length - 1].t) : 0;
  const s0 = mean(s.samples.slice(0, 3).map((p) => p.p));
  const natural = s0 != null && duration > 0
    ? naturalCurve(0, duration, s0, s.baseline).map((p) => ({ x: p.t, y: p.p })) : [];

  const markers = [];
  s.events.forEach((e) => {
    if (EVENT_STYLE[e.type]) markers.push({ x: rel(e.t), ...EVENT_STYLE[e.type] });
    if (e.type === 'loop_check' && e.data?.action && e.data.action !== 'continue') {
      markers.push({ x: rel(e.t), label: e.data.action === 'stop' ? 'STOP' : 'SWITCH?', color: e.data.action === 'stop' ? C.normal : C.warn });
    }
  });

  const series = [
    { name: 'Ring / earbud stress', color: C.physio, points: physio },
    { name: 'Phone behaviour stress', color: C.pheno, points: pheno },
    { name: 'Natural recovery (no technique)', color: C.muted, dash: '6 5', width: 1.8, points: natural },
    { name: 'Your baseline', color: C.normal, dash: '2 4', width: 1.4, band: [s.baseline, s.baseline + BASELINE_MARGIN], points: duration > 0 ? [{ x: 0, y: s.baseline }, { x: duration, y: s.baseline }] : [] },
  ];

  const ts = s.samples.map((p) => rel(p.t)); const ps = s.samples.map((p) => p.p);
  const aObs = ts.length > 1 ? excessArea(ts, ps, s.baseline) : null;
  const aNat = natural.length > 1 ? excessArea(natural.map((p) => p.x), natural.map((p) => p.y), s.baseline) : null;
  const beyond = aObs != null && aNat > 1e-9 ? (1 - aObs / aNat) * 100 : null;
  const comps = s.comps;
  const end = mean(s.samples.slice(-3).map((p) => p.p));

  return (
    <Card>
      <CardHead
        title="Session timeline"
        sub="Stress during the session, with what the system did and what natural recovery would have done."
        right={(
          <select className="rev-select" value={s.key} onChange={(e) => onChange(e.target.value)}>
            {[...sessions].reverse().map((x) => (
              <option key={x.key} value={x.key}>{fmtDate(x.startMs)} · {techName(x.technique)}</option>
            ))}
          </select>
        )}
      />
      <LineChart series={series} markers={markers} height={270} xFmt={mSec} xLabel="time since session start (m:ss) · R recommended, S started, F finished, ★ rated" />
      <div className="rev-chips">
        <span>Stress {dec(s0)} → {dec(end)}</span>
        <span>Beyond natural recovery {beyond == null ? '—' : `${beyond >= 0 ? '+' : ''}${Math.round(beyond)}%`}</span>
        <span>Time to baseline {comps ? fmtDur(comps.time_to_baseline) : '—'}</span>
        <span>Reward {dec(s.reward)}</span>
        <span>Rating {s.stars ? `${s.stars}★` : '—'}</span>
        <span>{s.condition === 'system' ? 'Recommended by system' : s.condition === 'manual' ? 'Chosen manually' : 'Condition unknown'}</span>
      </div>
      {comps && (
        <Bars
          items={[
            { label: 'Extra stress relief', value: comps.uplift, color: C.normal },
            { label: 'Speed', value: comps.speed, color: C.pheno },
            { label: 'User feedback', value: comps.rating, color: C.warn },
            { label: 'Short session', value: comps.effort, color: '#8B5CF6' },
          ]}
          max={1}
        />
      )}
      {!s.samples.length && <p className="rev-empty">This session has no stress readings (played on the web, or before logging was added).</p>}
    </Card>
  );
}

function SuggestionLog({ sessions, onPick }) {
  const rows = [...sessions].reverse();
  return (
    <Card>
      <CardHead title="Technique suggestions and outcomes" sub="Every recommendation: why it was chosen and what happened. Click a row to open its timeline." />
      <div className="rev-scroll">
        <table className="rev-table">
          <thead>
            <tr><th>When</th><th>Suggested</th><th>Played</th><th>Why</th><th>Level vs baseline</th><th>Reward</th><th>Recovery</th><th>★</th></tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const ctx = s.context;
              const diff = ctx && Number.isFinite(ctx.combined) && Number.isFinite(ctx.baseline) ? ctx.combined - ctx.baseline : null;
              return (
                <tr key={s.key} onClick={() => onPick(s.key)}>
                  <td>{fmtDate(s.startMs)}</td>
                  <td>{techName(s.recommended)}</td>
                  <td>{techName(s.technique)}{s.condition === 'manual' ? <small> (manual)</small> : null}</td>
                  <td className="rev-why">{s.reason || '—'}</td>
                  <td>{diff == null ? '—' : `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}${ctx?.slope_per_min > 0.02 ? ' ↑' : ctx?.slope_per_min < -0.02 ? ' ↓' : ' →'}`}</td>
                  <td>{dec(s.reward)}</td>
                  <td>{pct(s.recovery)}{s.measured ? '' : s.recovery != null ? '*' : ''}</td>
                  <td>{s.stars || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="caption" style={{ marginTop: 8 }}>* recovery estimated from feedback only (no live stress curve was recorded).</p>
    </Card>
  );
}

function Learning({ sessions, trust, modelObs }) {
  const done = sessions.filter((s) => Number.isFinite(s.reward));
  const pts = done.map((s, i) => ({ x: i + 1, y: s.reward, color: s.condition === 'system' ? C.sys : C.man }));
  const run = done.map((s, i) => {
    const w = done.slice(Math.max(0, i - 2), i + 1).map((x) => x.reward);
    return { x: i + 1, y: mean(w) };
  });
  const rec = done.filter((s) => Number.isFinite(s.recovery)).map((s, i) => ({ x: i + 1, y: s.recovery / 100 }));
  const counts = {};
  sessions.forEach((s) => { if (s.recommended) counts[s.recommended] = (counts[s.recommended] || 0) + 1; });

  return (
    <div className="grid grid-2">
      <Card>
        <CardHead title="Reward per session" sub="Is the system choosing better over time?" />
        <LineChart
          height={220}
          xFmt={(v) => `#${Math.round(v)}`}
          series={[
            { name: 'Reward (system = purple, manual = orange)', color: C.brand, points: pts, dots: true },
            { name: 'Running average (3)', color: C.normal, points: run },
          ]}
          xLabel="session number"
        />
      </Card>
      <Card>
        <CardHead title="Measured stress reduction per session" sub="Share of the extra stress that was removed (0 to 1)." />
        <LineChart height={220} xFmt={(v) => `#${Math.round(v)}`} series={[{ name: 'Stress reduced', color: C.pheno, points: rec }]} xLabel="session number" />
      </Card>
      <Card>
        <CardHead title="What the system suggested" sub="How often each technique was recommended." />
        <Bars items={Object.entries(counts).map(([t, n]) => ({ label: techName(t), value: n, color: C.brand })).sort((a, b) => b.value - a.value)} fmt={(v) => String(v)} />
      </Card>
      <Card>
        <CardHead title="What the model has learned" sub="Trust in each technique from past outcomes (0.5 = unknown) and how many observations back it." />
        <Bars
          items={trust.map((t) => ({ label: techName(t.technique), value: t.trust, sub: `${Math.round(t.trials * 10) / 10} trials`, color: t.trust >= 0.55 ? C.normal : t.trust <= 0.45 ? C.stress : C.muted })).sort((a, b) => b.value - a.value)}
          max={1}
        />
        {modelObs.length > 0 && (
          <p className="caption" style={{ marginTop: 8 }}>
            Continuous-model observations: {modelObs.map((m) => `${techName(m.technique)} ${m.n}`).join(' · ')}
          </p>
        )}
      </Card>
    </div>
  );
}

function Control({ sessions }) {
  const groups = ['system', 'manual'].map((c) => {
    const rows = sessions.filter((s) => s.condition === c && Number.isFinite(s.reward));
    return {
      c, n: rows.length,
      reward: mean(rows.map((s) => s.reward)),
      recovery: mean(rows.map((s) => s.recovery).filter(Number.isFinite)),
      ttb: mean(rows.map((s) => s.comps?.time_to_baseline).filter(Number.isFinite)),
    };
  });
  const pairs = sessions.filter((s) => Number.isFinite(s.stars) && Number.isFinite(s.recovery) && s.measured);
  const rho = spearman(pairs.map((s) => s.stars), pairs.map((s) => s.recovery));
  const colorOf = (c) => (c === 'system' ? C.sys : C.man);
  return (
    <div className="grid grid-2">
      <Card>
        <CardHead title="System recommendation vs user-chosen" sub="Within-user comparison. Needs several sessions in each group to mean anything." />
        <p className="caption">Mean reward</p>
        <Bars items={groups.map((g) => ({ label: g.c === 'system' ? 'Recommended' : 'Chosen by user', value: g.reward, sub: `n=${g.n}`, color: colorOf(g.c) }))} max={1} />
        <p className="caption" style={{ marginTop: 10 }}>Mean measured recovery (%)</p>
        <Bars items={groups.map((g) => ({ label: g.c === 'system' ? 'Recommended' : 'Chosen by user', value: g.recovery, sub: `n=${g.n}`, color: colorOf(g.c) }))} max={100} fmt={(v) => pct(v)} />
        <p className="caption" style={{ marginTop: 10 }}>Mean time to baseline (s, sessions that reached it)</p>
        <Bars items={groups.map((g) => ({ label: g.c === 'system' ? 'Recommended' : 'Chosen by user', value: g.ttb, sub: `n=${g.n}`, color: colorOf(g.c) }))} fmt={(v) => (v == null ? '—' : `${Math.round(v)}s`)} />
      </Card>
      <Card>
        <CardHead title="Measured recovery vs the user's rating" sub={`Do the stress curve and the user's feeling agree? ${rho == null ? 'Needs 3+ sessions.' : `Rank correlation ρ = ${rho.toFixed(2)} (n=${pairs.length}).`}`} />
        <Scatter points={pairs.map((s) => ({ x: s.stars, y: s.recovery, color: colorOf(s.condition) }))} xLabel="rating" yLabel="measured recovery %" />
      </Card>
    </div>
  );
}

function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function UserEvidence({ userId }) {
  const { sessions, trust, modelObs, loading, error } = useUserEvidence(userId);
  const [picked, setPicked] = useState(null);
  useEffect(() => { setPicked(null); }, [userId]);
  const latest = sessions[sessions.length - 1];
  const liveSession = [...sessions].reverse().find((s) => s.samples.length) || latest;

  if (loading) return <Card><Spinner /></Card>;
  return (
    <>
      {error && <Card><p className="body" style={{ color: C.stress }}>Could not read some data: {error}. Check the Firebase rules for the relaxation paths.</p></Card>}
      <div className="rev-userhead">
        <h2 className="title">{userId}</h2>
        <button className="btn" onClick={() => downloadJson(`relaxation-evidence-${userId}.json`, { userId, exportedAt: new Date().toISOString(), sessions, trust, modelObs })}>
          Download this user's data (JSON)
        </button>
      </div>
      <LiveCard session={liveSession} />
      {sessions.length === 0 ? (
        <Card><p className="body">No sessions yet for this user.</p></Card>
      ) : (
        <>
          <SessionTimeline sessions={sessions} value={picked || liveSession?.key} onChange={setPicked} />
          <SuggestionLog sessions={sessions} onPick={setPicked} />
          <Learning sessions={sessions} trust={trust} modelObs={modelObs} />
          <Control sessions={sessions} />
        </>
      )}
    </>
  );
}

export default function RelaxEvidence({ userId }) {
  if (!userId) return <Card><p className="body">Sign in to see your relaxation evidence.</p></Card>;
  return (
    <div className="stack rev">
      <Card>
        <p className="body">
          Evidence view for your account. Read live from the database: what the intervention system recommended to you, your stress
          readings during each session, the loop's decisions, the measured results, and what the model has learned about you.
          Sessions started from the mobile app are logged in full; sessions played on this web page are logged too.
        </p>
      </Card>
      <UserEvidence key={userId} userId={userId} />
    </div>
  );
}
