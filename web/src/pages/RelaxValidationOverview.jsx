import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, ref } from 'firebase/database';
import { useAuth } from '../auth/AuthContext';
import { Card, CardHead, Spinner } from '../components/ui';
import { db } from '../lib/firebase';
import { isRelaxationAdmin, mean, normaliseSessions } from '../lib/relaxEvidence';
import './relaxValidationOverview.css';

const REFRESH_MS = 30000;
const VALIDATION_USER_IDS = ['ojani_jayasinghe', 'mithula', 'wehara', 'unagalle', 'mpuser6'];

function techniqueName(id) {
  return id ? id.replace(/_/g, ' ') : 'Not recorded';
}

function formatDate(seconds) {
  if (!Number.isFinite(seconds)) return 'Not recorded';
  return new Date(seconds * 1000).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function BarChart({ items, valueLabel, maxValue, format = (value) => String(value) }) {
  if (!items.length) return <p className="body">No saved values are available for this chart.</p>;
  const scale = maxValue || Math.max(...items.map((item) => item.value || 0), 1);
  return (
    <div className="rvo-bars">
      {items.map((item) => (
        <div className="rvo-bar-row" key={item.label}>
          <span title={item.label}>{item.label}</span>
          <div className="rvo-track" role="img" aria-label={`${item.label}: ${format(item.value)}`}>
            <div className="rvo-fill" style={{ width: `${Math.max(0, Math.min(100, ((item.value || 0) / scale) * 100))}%` }} />
          </div>
          <b>{format(item.value)}</b>
          {item.note && <small>{item.note}</small>}
        </div>
      ))}
      {valueLabel && <p className="caption rvo-axis-note">{valueLabel}</p>}
    </div>
  );
}

function ValidationTrend({ rows }) {
  const points = rows
    .filter((row) => Number.isFinite(row.recovery))
    .map((row, index) => ({ row, index, value: Math.max(0, Math.min(100, row.recovery)) }));
  if (points.length < 2) {
    return <p className="body">At least two saved recovery results are needed to show a trend.</p>;
  }

  const width = 720;
  const height = 250;
  const pad = { left: 42, right: 18, top: 14, bottom: 32 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (index / (points.length - 1)) * chartWidth;
  const y = (value) => pad.top + (1 - value / 100) * chartHeight;
  const path = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`
  ).join(' ');
  const ticks = [0, 25, 50, 75, 100];

  return (
    <svg className="rvo-chart" viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label="Recovery percentage across saved Relaxation Guide validation results">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="rvo-grid" />
          <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="rvo-axis-label">{tick}%</text>
        </g>
      ))}
      <path d={path} className="rvo-trend-line" />
      {points.map(({ row, value }, index) => (
        <circle
          key={`${row.userId}-${row.key}`}
          cx={x(index)}
          cy={y(value)}
          r="5"
          className={row.measured ? 'rvo-point measured' : 'rvo-point estimated'}
        >
          <title>{`${row.userId}: ${value.toFixed(1)}% recovery · ${row.measured ? 'measured' : 'estimated'}`}</title>
        </circle>
      ))}
      <text x={pad.left} y={height - 8} className="rvo-axis-label">Earlier</text>
      <text x={width - pad.right} y={height - 8} textAnchor="end" className="rvo-axis-label">Later</text>
    </svg>
  );
}

function RewardTrend({ rows }) {
  const points = rows
    .filter((row) => Number.isFinite(row.reward))
    .map((row, index) => ({ row, value: Math.max(0, Math.min(1, row.reward)), index }));
  if (points.length < 2) return <p className="body">At least two saved rewards are needed to show a trend.</p>;

  const width = 720;
  const height = 230;
  const pad = { left: 42, right: 18, top: 14, bottom: 30 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (index / (points.length - 1)) * chartWidth;
  const y = (value) => pad.top + (1 - value) * chartHeight;
  const path = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`
  ).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg className="rvo-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reward across saved validation results">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="rvo-grid" />
          <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="rvo-axis-label">{tick.toFixed(2)}</text>
        </g>
      ))}
      <path d={path} className="rvo-trend-line reward" />
      {points.map(({ row, value }, index) => (
        <circle key={`${row.userId}-${row.key}`} cx={x(index)} cy={y(value)} r="4.5" className="rvo-point reward">
          <title>{`${row.userId}: reward ${value.toFixed(3)}`}</title>
        </circle>
      ))}
      <text x={pad.left} y={height - 7} className="rvo-axis-label">Earlier</text>
      <text x={width - pad.right} y={height - 7} textAnchor="end" className="rvo-axis-label">Later</text>
    </svg>
  );
}

function UserComparison({ rows }) {
  const users = useMemo(() => {
    const groups = new Map(VALIDATION_USER_IDS.map((userId) => [userId, []]));
    rows.forEach((row) => {
      groups.get(row.userId)?.push(row);
    });
    return [...groups.entries()].map(([userId, validations]) => ({
      userId,
      count: validations.length,
      recovery: mean(validations.map((row) => row.recovery).filter(Number.isFinite)),
      measuredCount: validations.filter((row) => row.measured).length,
    })).sort((a, b) => (b.recovery ?? -1) - (a.recovery ?? -1));
  }, [rows]);

  return (
    <div className="rvo-user-bars">
      {users.map((user) => (
        <div className="rvo-user-row" key={user.userId}>
          <span title={user.userId}>{user.userId}</span>
          {user.count ? (
            <>
              <div className="rvo-track" aria-label={`Average recovery for ${user.userId}`}>
                <div className="rvo-fill" style={{ width: `${Math.max(0, Math.min(100, user.recovery || 0))}%` }} />
              </div>
              <b>{formatNumber(user.recovery, 1)}%</b>
              <small>{user.count} result{user.count === 1 ? '' : 's'} · {user.measuredCount} measured</small>
            </>
          ) : <small className="rvo-no-data">No saved results</small>}
        </div>
      ))}
    </div>
  );
}

function TechniqueAnalysis({ rows }) {
  const techniques = useMemo(() => {
    const groups = new Map();
    rows.forEach((row) => {
      const id = row.technique || row.recommended;
      if (!id) return;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(row);
    });
    return [...groups.entries()].map(([id, validations]) => ({
      id,
      count: validations.length,
      recovery: mean(validations.map((row) => row.recovery).filter(Number.isFinite)),
      reward: mean(validations.map((row) => row.reward).filter(Number.isFinite)),
    })).sort((a, b) => b.count - a.count || (b.recovery ?? -1) - (a.recovery ?? -1));
  }, [rows]);

  return (
    <div className="rvo-techniques">
      {techniques.length === 0 ? <p className="body">No technique IDs were saved with these results.</p> : (
        <>
          <BarChart
            items={techniques.map((item) => ({
              label: techniqueName(item.id),
              value: item.count,
              note: `avg recovery ${formatNumber(item.recovery, 1)}% · avg reward ${formatNumber(item.reward, 3)}`,
            }))}
            valueLabel="Bar length = number of saved validation results for the technique."
          />
          <p className="caption rvo-footnote">
            The most-used technique is listed first. Recovery is shown alongside frequency so usage alone is not mistaken for effectiveness.
            A saved recommendation is used only when the played technique was not recorded.
          </p>
        </>
      )}
    </div>
  );
}

function RewardComponents({ rows }) {
  const components = [
    ['uplift', 'Stress relief vs natural recovery'],
    ['speed', 'Speed to baseline'],
    ['rating', 'User rating'],
    ['effort', 'Short-session effort'],
  ].map(([key, label]) => {
    const values = rows.map((row) => row.comps?.[key]).filter(Number.isFinite);
    return { label, value: mean(values), count: values.length };
  }).filter((item) => Number.isFinite(item.value));

  return (
    <>
      <BarChart
        items={components.map((item) => ({ ...item, note: `${item.count} session${item.count === 1 ? '' : 's'}` }))}
        maxValue={1}
        format={(value) => formatNumber(value, 2)}
        valueLabel="Mean component score (0–1), as recorded by the reward calculation."
      />
      <p className="caption rvo-footnote">
        Components appear only for sessions that saved reward-component details; missing values are not inferred.
      </p>
    </>
  );
}

function SessionTypeComparison({ rows }) {
  const types = [
    { key: 'system', label: 'System recommended' },
    { key: 'manual', label: 'User chosen' },
  ].map(({ key, label }) => {
    const group = rows.filter((row) => row.condition === key);
    return {
      label,
      count: group.length,
      recovery: mean(group.map((row) => row.recovery).filter(Number.isFinite)),
      reward: mean(group.map((row) => row.reward).filter(Number.isFinite)),
    };
  });

  return (
    <div className="rvo-compare">
      {types.map((type) => (
        <div className="rvo-compare-item" key={type.label}>
          <b>{type.label}</b>
          <span>{type.count} validations</span>
          <span>Average recovery <strong>{formatNumber(type.recovery, 1)}{Number.isFinite(type.recovery) ? '%' : ''}</strong></span>
          <span>Average reward <strong>{formatNumber(type.reward, 3)}</strong></span>
        </div>
      ))}
      <p className="caption rvo-footnote">Unknown or unrecorded session types are excluded from this comparison.</p>
    </div>
  );
}

function RatingDistribution({ rows }) {
  const ratings = [1, 2, 3, 4, 5].map((rating) => ({
    label: `${rating} star${rating === 1 ? '' : 's'}`,
    value: rows.filter((row) => row.stars === rating).length,
  }));
  return <BarChart items={ratings} valueLabel="Number of saved user ratings." format={(value) => String(value)} />;
}

function Kpi({ title, value, note }) {
  return (
    <Card className="rvo-kpi">
      <span className="caption">{title}</span>
      <b>{value}</b>
      {note && <small>{note}</small>}
    </Card>
  );
}

export default function RelaxValidationOverview() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.userId;
  const allowed = isRelaxationAdmin(userId);
  const [rows, setRows] = useState([]);
  const [readErrors, setReadErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (!allowed) {
      setRows([]);
      setReadErrors([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      setRefreshing(true);
      try {
        const results = await Promise.all(VALIDATION_USER_IDS.map(async (uid) => {
          try {
            const [evidenceSnap, backendSnap] = await Promise.all([
              get(ref(db, `relaxation_evidence/${uid}`)),
              get(ref(db, `relaxation_intervention/${uid}`)),
            ]);
            const sessions = normaliseSessions(evidenceSnap.val(), backendSnap.val());
            return { uid, sessions, error: null };
          } catch (error) {
            return { uid, sessions: [], error: error?.message || 'Firebase read failed' };
          }
        }));
        if (cancelled) return;

        const nextRows = results.flatMap(({ uid, sessions }) =>
          sessions
            .filter((session) => session.hasResult)
            .map((session) => ({ ...session, userId: uid }))
        ).sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
        setRows(nextRows);
        setReadErrors(results.filter((result) => result.error).map(({ uid, error }) => `${uid}: ${error}`));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
        inFlight = false;
      }
    };

    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      `${row.userId} ${techniqueName(row.technique)}`.toLowerCase().includes(q)
    );
  }, [filter, rows]);

  const recoveryValues = rows.map((row) => row.recovery).filter(Number.isFinite);
  const rewardValues = rows.map((row) => row.reward).filter(Number.isFinite);
  const ratingValues = rows.map((row) => row.stars).filter(Number.isFinite);
  const measuredCount = rows.filter((row) => row.measured).length;
  const baselineResults = rows.filter((row) => typeof row.reachedBaseline === 'boolean');
  const baselineRate = baselineResults.length
    ? (baselineResults.filter((row) => row.reachedBaseline).length / baselineResults.length) * 100
    : null;

  if (!allowed) {
    return (
      <div className="stack">
        <Card>
          <CardHead title="Validation results" />
          <p className="body">This overview is available to the Relaxation Guide admin account.</p>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => navigate('/relax')}>Back to Relaxation Guide</button>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack rvo">
      <div className="greet">
        <span className="micro">Relaxation guide · admin overview</span>
        <h1 className="display" style={{ marginTop: 4 }}>Real-user validation results</h1>
        <p className="body">Read-only summary of saved session outcomes across users. Data refreshes every 30 seconds.</p>
        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/relax')}>Back to Relaxation Guide</button>
          <span className="caption">{refreshing ? 'Refreshing…' : 'Latest saved results'}</span>
        </div>
      </div>

      {loading ? (
        <Card><Spinner /></Card>
      ) : (
        <>
          {readErrors.length > 0 && (
            <Card>
              <p className="body" style={{ color: 'var(--stress-dark)' }}>
                Some user records could not be read: {readErrors.join(' · ')}
              </p>
            </Card>
          )}

          <div className="rvo-kpis">
            <Kpi title="Saved validations" value={rows.length} note="Finished sessions with a saved outcome" />
            <Kpi title="Participants" value={VALIDATION_USER_IDS.length} note="Restricted to the five selected users" />
            <Kpi title="Average recovery" value={recoveryValues.length ? `${formatNumber(mean(recoveryValues), 1)}%` : '—'} note="Measured and estimated outcomes" />
            <Kpi title="Average reward" value={rewardValues.length ? formatNumber(mean(rewardValues), 3) : '—'} note="Backend learning reward (0–1)" />
            <Kpi title="Reached baseline" value={baselineRate == null ? '—' : `${formatNumber(baselineRate, 0)}%`} note={baselineRate == null ? 'Not present in saved results' : `${baselineResults.length} results with status recorded`} />
            <Kpi title="Average user rating" value={ratingValues.length ? `${formatNumber(mean(ratingValues), 1)} / 5` : '—'} note={`${ratingValues.length} results with a rating`} />
            <Kpi title="Measured outcomes" value={rows.length ? `${formatNumber((measuredCount / rows.length) * 100, 0)}%` : '—'} note={`${measuredCount} of ${rows.length} results used measured data`} />
          </div>

          {rows.length === 0 ? (
            <Card>
              <CardHead title="No validation results found" />
              <p className="body">
                No completed outcomes were found under the Relaxation Guide validation records.
                Results appear here after a session writes its reward or recovery outcome.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid grid-2 rvo-charts">
                <Card>
                  <CardHead title="Recovery trend" sub="Each point is one saved validation, ordered from earlier to later." />
                  <ValidationTrend rows={rows} />
                  <div className="rvo-legend">
                    <span><i className="measured" /> Measured from stress samples</span>
                    <span><i className="estimated" /> Estimated / not measured</span>
                  </div>
                </Card>
                <Card>
                  <CardHead title="Average recovery by user" sub="Compare saved validation outcomes; estimated outcomes are included." />
                  <UserComparison rows={rows} />
                </Card>
                <Card>
                  <CardHead title="Techniques used to recover" sub="Frequency, average recovery, and average reward for each technique." />
                  <TechniqueAnalysis rows={rows} />
                </Card>
                <Card>
                  <CardHead title="Reward trend" sub="Reward reflects the saved combined outcome score from 0 to 1." />
                  <RewardTrend rows={rows} />
                </Card>
                <Card>
                  <CardHead title="Reward score components" sub="Average saved contribution scores where available." />
                  <RewardComponents rows={rows} />
                </Card>
                <Card>
                  <CardHead title="System recommendation vs user choice" sub="Compare saved recovery and reward for each session type." />
                  <SessionTypeComparison rows={rows} />
                </Card>
                <Card>
                  <CardHead title="User rating distribution" sub="How many saved validation sessions received each rating." />
                  <RatingDistribution rows={rows} />
                </Card>
              </div>

              <Card>
                <CardHead title="All validation records" sub={`${filteredRows.length} of ${rows.length} saved results`} />
                <label className="rvo-filter">
                  <span>Filter by user or technique</span>
                  <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="e.g. user ID or breathing" />
                </label>
                <div className="rvo-table-wrap">
                  <table className="rvo-table">
                    <thead>
                      <tr>
                        <th>User</th><th>Date</th><th>Technique</th><th>Rating</th>
                        <th>Recovery</th><th>Reward</th><th>Result source</th><th>Reached baseline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...filteredRows].reverse().map((row) => (
                        <tr key={`${row.userId}-${row.key}`}>
                          <td>{row.userId}</td>
                          <td>{formatDate(row.startSec)}</td>
                          <td>{techniqueName(row.technique)}</td>
                          <td>{Number.isFinite(row.stars) ? `${row.stars} / 5` : '—'}</td>
                          <td>{Number.isFinite(row.recovery) ? `${formatNumber(row.recovery, 1)}%` : '—'}</td>
                          <td>{formatNumber(row.reward, 3)}</td>
                          <td>{row.measured ? 'Measured' : 'Estimated / unavailable'}</td>
                          <td>{row.reachedBaseline == null ? 'Not recorded' : row.reachedBaseline ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                      {filteredRows.length === 0 && <tr><td colSpan="8">No records match this filter.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <p className="caption rvo-footnote">
                  “Measured” means the saved outcome used a stress trajectory. Other recovery values may be estimated from feedback.
                  A dash means the source record did not include that field.
                </p>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
