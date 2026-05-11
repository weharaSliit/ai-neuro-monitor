export const COLORS = {
  brand:         '#6366f1',
  brandLight:    '#818cf8',
  brandDark:     '#4f46e5',
  brandGlow:     '#6366f118',

  normal:        '#10b981',
  normalLight:   '#34d399',
  normalGlow:    '#10b98118',
  prestress:     '#f59e0b',
  prestressLight:'#fbbf24',
  prestressGlow: '#f59e0b18',
  stress:        '#ef4444',
  stressLight:   '#f87171',
  stressGlow:    '#ef444418',

  hrv:           '#06b6d4',
  gsr:           '#8b5cf6',
  acc:           '#ec4899',

  dark: {
    bg:          '#040d1c',
    surface:     '#0a1628',
    card:        '#0f1e32',
    cardHover:   '#142240',
    border:      '#1a3352',
    borderSoft:  '#152844',
    text:        '#e8f4fd',
    textMuted:   '#5a7a9a',
    textSub:     '#8aacc8',
  },

  light: {
    bg:          '#f0f7ff',
    surface:     '#ffffff',
    card:        '#ffffff',
    cardHover:   '#f8fbff',
    border:      '#dceaf7',
    borderSoft:  '#eaf3fc',
    text:        '#0a1628',
    textMuted:   '#5a7a9a',
    textSub:     '#4a6a8a',
  },
};

export const STRESS_COLORS = { 0: COLORS.normal, 1: COLORS.prestress, 2: COLORS.stress };
export const STRESS_LABELS = { 0: 'Normal', 1: 'Pre-Stress', 2: 'Stress' };
export const STRESS_EMOJI  = { 0: '😌', 1: '😰', 2: '😨' };