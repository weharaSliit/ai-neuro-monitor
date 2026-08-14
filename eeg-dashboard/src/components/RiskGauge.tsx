interface Props {
  risk: number | null;
  alertThresh: number;
  skipped: boolean;
  confidence: number | null;
}

function confidenceLabel(confidence: number | null): { text: string; color: string } {
  if (confidence === null) return { text: 'confidence: —', color: '#5a6673' };
  const pct = Math.round(confidence * 100);
  const color = confidence >= 0.7 ? '#2ecc71' : confidence >= 0.4 ? '#f5a623' : '#ff4d4f';
  return { text: `confidence: ${pct}%`, color };
}

export default function RiskGauge({ risk, alertThresh, skipped, confidence }: Props) {
  const value = skipped ? null : risk;
  const pct = value !== null ? Math.min(100, Math.max(0, value * 100)) : 0;
  const threshPct = Math.min(100, Math.max(0, alertThresh * 100));
  const color =
    value === null ? '#555' : value >= alertThresh ? '#ff4d4f' : value > alertThresh * 0.6 ? '#f5a623' : '#2ecc71';
  const conf = confidenceLabel(skipped ? null : confidence);

  return (
    <div className="panel risk-gauge">
      <div className="panel__header">
        <span>Short-Term Risk (SpiralLSTM)</span>
        <span className="risk-gauge__sublabel">~10s look-ahead</span>
      </div>
      <div className="risk-gauge__value" style={{ color }}>
        {value !== null ? value.toFixed(3) : '—'}
      </div>
      <div className="risk-gauge__track">
        <div className="risk-gauge__fill" style={{ width: `${pct}%`, background: color }} />
        <div className="risk-gauge__thresh" style={{ left: `${threshPct}%` }} title={`alert threshold ${alertThresh.toFixed(2)}`} />
      </div>
      <div className="risk-gauge__scale">
        <span>0.0</span>
        <span>threshold {alertThresh.toFixed(2)}</span>
        <span>1.0</span>
      </div>
      <div
        className="risk-gauge__confidence"
        style={{ color: conf.color }}
        title="Model's own uncertainty in this risk estimate (MC-Dropout, 15 samples) — not a measure of overall system accuracy, which is separately modest (AUC ≈0.63)."
      >
        {conf.text}
      </div>
    </div>
  );
}
