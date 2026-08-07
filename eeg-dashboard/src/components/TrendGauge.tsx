interface Props {
  trendScore: number | null;
  trendAlarm: boolean;
  calibrating: boolean | null;
  skipped: boolean;
}

// CUSUM decision threshold in trend_detector.py (CUSUM_DECISION_SIGMA)
const DECISION_SIGMA = 5.0;

export default function TrendGauge({ trendScore, trendAlarm, calibrating, skipped }: Props) {
  const value = skipped ? null : trendScore;
  const pct = value !== null ? Math.min(100, Math.max(0, (value / DECISION_SIGMA) * 100)) : 0;
  const color = calibrating ? '#5a6673' : trendAlarm ? '#ff4d4f' : value !== null && value > DECISION_SIGMA * 0.5 ? '#f5a623' : '#2ecc71';

  return (
    <div className="panel risk-gauge">
      <div className="panel__header">
        <span>Personal Trend</span>
        <span className="risk-gauge__sublabel">baseline drift — minutes-scale early warning</span>
      </div>
      <div className="risk-gauge__value" style={{ color }}>
        {calibrating ? 'CALIBRATING' : value !== null ? `${value.toFixed(2)}σ` : '—'}
      </div>
      <div className="risk-gauge__track">
        <div className="risk-gauge__fill" style={{ width: `${pct}%`, background: color }} />
        <div className="risk-gauge__thresh" style={{ left: '100%' }} title={`alarm threshold ${DECISION_SIGMA}σ`} />
      </div>
      <div className="risk-gauge__scale">
        <span>0σ</span>
        <span>alarm at {DECISION_SIGMA}σ</span>
      </div>
    </div>
  );
}
