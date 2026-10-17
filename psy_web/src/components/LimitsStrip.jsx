import { fmtScore } from './charts';

// The calibrated baseline and high-load threshold in use for mind, body and
// fused -- the same values as the Concept dashboard's cards (lib/limits
// calibratedLimits), shown on every dashboard so they all agree.
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Cell({ title, color, v, empty }) {
  return (
    <div className="ls-cell" style={{ borderTopColor: color }}>
      <span className="sd-card-title">{title}</span>
      {!v ? <span className="sd-card-note">{empty}</span> : (
        <>
          <div className="cd-cal">
            <div><span>Calibrated baseline</span><b>{v.baseline == null ? '—' : fmtScore(v.baseline)}</b>
              <em>{v.baseFused == null ? '' : `${v.baseFused.toFixed(2)} on the 0–1 scale`}</em></div>
            <div><span>High-load threshold</span><b>{v.threshold == null ? '—' : fmtScore(v.threshold)}</b>
              <em>{v.threshold == null ? '' : '0.50 on the 0–1 scale'}</em></div>
          </div>
          <span className="sd-card-note">{v.source}{v.at ? ` · ${clock(v.at)}` : ''}
            {v.statusText && !v.personal ? ` · ${v.statusText}` : ''}{v.fromSid ? ` · from ${v.fromSid}` : ''}</span>
        </>
      )}
    </div>
  );
}

export default function LimitsStrip({ limits, show = ['mind', 'body', 'fused'] }) {
  if (!limits) return null;
  const cells = {
    mind: <Cell key="mind" title="MIND (EEG)" color="var(--c1)" v={limits.mind} empty="No EEG calibration yet." />,
    body: <Cell key="body" title="BODY (HRV + GSR)" color="var(--c2)" v={limits.body} empty="No ring calibration yet." />,
    fused: <Cell key="fused" title="FUSED" color="var(--c7)" v={limits.fused.baseline == null && !limits.mind && !limits.body ? null : limits.fused}
      empty="Needs a mind or body calibration." />,
  };
  return (
    <section className="limits-strip" aria-label="Calibrated baseline and threshold in use">
      <p className="ls-head">Calibrated limits in use <span className="muted">· the same on every dashboard</span></p>
      <div className="ls-grid">{show.map((k) => cells[k])}</div>
    </section>
  );
}
