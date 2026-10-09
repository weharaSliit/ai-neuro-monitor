import { memo } from 'react';
import { COLORS } from '../lib/levels';

// Web twin of StressApp/modules/shared/BalanceRing.js.
function BalanceRing({ title, value, word, color = COLORS.brand, size = 120, stroke = 11 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const has = value != null && !Number.isNaN(value);
  const pct = has ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="ring">
      <span className="micro">{title}</span>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.borderSoft} strokeWidth={stroke} />
          <circle
            className="val"
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={has ? color : 'transparent'} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="ring-center">
          <b style={{ color: has ? COLORS.text : COLORS.textMuted }}>{has ? `${Math.round(pct)}%` : '—'}</b>
        </div>
      </div>
      <span className="ring-word" style={{ color: has ? color : COLORS.textMuted }}>{has ? word : 'No reading'}</span>
    </div>
  );
}

export default memo(BalanceRing);
