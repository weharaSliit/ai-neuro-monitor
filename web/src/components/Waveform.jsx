import { memo, useMemo } from 'react';
import Chart from './Chart';

// Processed, size-bounded GSR wave / IBI sequence (backend already
// downsampled it -- never raw sensor data). Drawn with the shared Chart, so
// it gets the same pinned axis, sideways scroll and hover read-out as every
// other chart. Same p5-p95 clamp as the app, so one spike can't flatten it.
function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

function Waveform({ title, hint, values, color, unit = '', height = 160 }) {
  const { rows, lo, hi } = useMemo(() => {
    if (!values || values.length < 2) return { rows: [], lo: 0, hi: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    let l = percentile(sorted, 0.05); let h = percentile(sorted, 0.95);
    if (h <= l) { l -= 1; h += 1; }
    const pad = (h - l) * 0.12; l -= pad; h += pad;
    return { rows: values.map((v) => ({ date: null, values: [Math.min(h, Math.max(l, v))] })), lo: l, hi: h };
  }, [values]);

  const last = values?.length ? values[values.length - 1] : null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="between">
        <span className="subtitle">{title}</span>
        <b>{last != null ? `${last.toFixed(1)}${unit}` : '—'}</b>
      </div>
      <p className="caption" style={{ margin: '2px 0 8px' }}>{hint}</p>
      {rows.length ? (
        <>
          <Chart rows={rows} series={[{ name: title, color }]} height={height} suffix={unit} minGap={4} area={false} />
          <p className="caption" style={{ margin: '4px 0 0' }}>Range {lo.toFixed(1)} – {hi.toFixed(1)}{unit}</p>
        </>
      ) : (
        <div className="chart-empty" style={{ height }}>Waiting for a window with this data — only new sessions carry it.</div>
      )}
    </div>
  );
}

export default memo(Waveform);
