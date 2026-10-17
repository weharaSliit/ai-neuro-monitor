// Hand-drawn style mood faces (inline SVG, so they look the same on every
// OS, unlike emoji). Shape carries the meaning as well as colour: the
// mouth and eyes change per mood.
const FILL = {
  very_relaxed: '#B9E3A0', relaxed: '#FFD86E', focused: '#AFD5F7', busy: '#FFBE8A', overloaded: '#F59A9A', unknown: '#E4E1DA',
};
const INK = '#4A3F3A';

function Eyes({ mood }) {
  if (mood === 'very_relaxed') {
    // closed, content
    return (
      <g fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round">
        <path d="M14 22 q4 -4 8 0" /><path d="M28 22 q4 -4 8 0" />
      </g>
    );
  }
  if (mood === 'overloaded') {
    return (
      <g>
        <g stroke={INK} strokeWidth="2.6" strokeLinecap="round">
          <path d="M13 16 l8 3" /><path d="M37 16 l-8 3" />
        </g>
        <circle cx="18" cy="23" r="2.6" fill={INK} /><circle cx="32" cy="23" r="2.6" fill={INK} />
      </g>
    );
  }
  if (mood === 'busy') {
    return (
      <g>
        <g stroke={INK} strokeWidth="2.4" strokeLinecap="round"><path d="M14 17 l7 -1" /><path d="M36 17 l-7 -1" /></g>
        <circle cx="18" cy="23" r="2.6" fill={INK} /><circle cx="32" cy="23" r="2.6" fill={INK} />
      </g>
    );
  }
  return <g><circle cx="18" cy="22" r="2.7" fill={INK} /><circle cx="32" cy="22" r="2.7" fill={INK} /></g>;
}

const MOUTH = {
  very_relaxed: 'M15 30 q10 10 20 0',
  relaxed: 'M16 30 q9 7 18 0',
  focused: 'M18 32 h14',
  busy: 'M17 34 q8 -4 16 0',
  overloaded: 'M16 36 q9 -8 18 0',
  unknown: 'M19 32 h12',
};

export default function Face({ mood = 'unknown', size = 44, title, ring = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 50 50" role="img" aria-label={title || mood.replace('_', ' ')} className="face">
      {ring && <circle cx="25" cy="25" r="24" fill="var(--card)" />}
      <circle cx="25" cy="25" r={ring ? 21 : 23} fill={FILL[mood] || FILL.unknown} />
      {(mood === 'relaxed' || mood === 'very_relaxed') && (
        <g fill="#F7A3A3" opacity="0.55"><ellipse cx="12" cy="29" rx="3.5" ry="2.2" /><ellipse cx="38" cy="29" rx="3.5" ry="2.2" /></g>
      )}
      <Eyes mood={mood} />
      <path d={MOUTH[mood] || MOUTH.unknown} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      {mood === 'overloaded' && <path d="M40 9 q3 5 0 7 q-3 -2 0 -7z" fill="#7FC4F2" />}
    </svg>
  );
}
