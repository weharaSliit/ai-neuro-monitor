// "Why this technique": the reason the Relaxation Guide gave, plus the context it used
// (same wording as the mobile app's WhyThisTechniqueCard).
const SLOPE_EPS = 0.02;
const AGREE_EPS = 0.15;

function chipsFor(rec) {
  const ctx = rec?.context;
  if (!ctx || ctx.ready === false) return [];
  const chips = [];
  if (Number.isFinite(ctx.combined) && Number.isFinite(ctx.baseline)) {
    const diff = ctx.combined - ctx.baseline;
    chips.push({
      key: 'level',
      label: diff > 0.02 ? `Stress +${diff.toFixed(2)} above your baseline` : 'Near your baseline',
      color: diff > 0.2 ? '#E56B4E' : diff > 0.02 ? '#E8A238' : '#5E935A',
    });
  }
  if (Number.isFinite(ctx.slope_per_min)) {
    if (ctx.slope_per_min > SLOPE_EPS) chips.push({ key: 'dir', label: '↑ Rising', color: '#E56B4E' });
    else if (ctx.slope_per_min < -SLOPE_EPS) chips.push({ key: 'dir', label: '↓ Falling', color: '#5E935A' });
    else chips.push({ key: 'dir', label: '→ Steady', color: '#3B82F6' });
  }
  if (ctx.has_both_streams && Number.isFinite(ctx.disagreement)) {
    chips.push(Math.abs(ctx.disagreement) < AGREE_EPS
      ? { key: 'streams', label: 'Body & phone agree', color: '#3B82F6' }
      : { key: 'streams', label: ctx.disagreement > 0 ? 'Body higher than phone' : 'Phone higher than body', color: '#8B5CF6' });
  } else {
    const used = rec?.streams_used;
    let label = 'One stream live';
    if (used?.phenotyping && !used?.physiological) label = 'Phone behaviour only';
    else if (used?.physiological && !used?.phenotyping) label = 'Body signals only';
    chips.push({ key: 'streams', label, color: '#989294' });
  }
  if (ctx.rise_alarm) chips.push({ key: 'alarm', label: 'Sustained rise detected', color: '#E56B4E' });
  const codes = rec?.reason_codes || [];
  if (codes.includes('learned_from_you')) chips.push({ key: 'learn', label: 'Based on your history', color: '#5E935A' });
  else if (codes.includes('still_learning')) chips.push({ key: 'learn', label: 'Still learning you', color: '#E8A238' });
  return chips;
}

export default function RelaxWhy({ rec }) {
  if (!rec || rec.source !== 'service') return null;
  const chips = chipsFor(rec);
  if (!rec.reason && !chips.length) return null;
  return (
    <div style={{ marginTop: 14, padding: 12, border: '1px solid #EAE5DA', borderRadius: 14, background: '#FAF8F3' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: '#544E50', marginBottom: 4 }}>
        Why this technique
      </div>
      {rec.reason && <p className="body" style={{ margin: 0 }}>{rec.reason}</p>}
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {chips.map((c) => (
            <span key={c.key} style={{ border: `1px solid ${c.color}66`, background: `${c.color}1F`, color: c.color, borderRadius: 10, padding: '3px 8px', fontSize: 11, fontWeight: 800 }}>
              {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
