// ============================================================
// theme.js — MindPulse Design System
// HRV + GSR + Stress detection aesthetic
// ============================================================

export const COLORS = {
  // Brand
  brand:        '#6366f1',  // indigo
  brandLight:   '#818cf8',
  brandDark:    '#4f46e5',
  brandGlow:    '#6366f120',

  // Stress states
  normal:       '#10b981',  // emerald
  normalLight:  '#34d399',
  normalGlow:   '#10b98120',
  prestress:    '#f59e0b',  // amber
  prestressLight:'#fbbf24',
  prestressGlow:'#f59e0b20',
  stress:       '#ef4444',  // red
  stressLight:  '#f87171',
  stressGlow:   '#ef444420',

  // Signal colors
  hrv:          '#06b6d4',  // cyan — HRV
  gsr:          '#8b5cf6',  // violet — GSR
  acc:          '#ec4899',  // pink — ACC

  // Dark theme
  dark: {
    bg:         '#060d1a',
    surface:    '#0f1f35',
    card:       '#162033',
    border:     '#1e3a5f',
    text:       '#f0f9ff',
    textMuted:  '#64748b',
    textSub:    '#94a3b8',
  },

  // Light theme
  light: {
    bg:         '#f0f9ff',
    surface:    '#ffffff',
    card:       '#f8fafc',
    border:     '#e2e8f0',
    text:       '#0f172a',
    textMuted:  '#64748b',
    textSub:    '#475569',
  },
};

export const STRESS_COLORS = {
  0: COLORS.normal,
  1: COLORS.prestress,
  2: COLORS.stress,
};

export const STRESS_LABELS = {
  0: 'Normal',
  1: 'Pre-Stress',
  2: 'Stress',
};

export const STRESS_EMOJI = {
  0: '😌',
  1: '😰',
  2: '😨',
};

export const GRADIENTS = {
  brand:    ['#6366f1', '#8b5cf6'],
  normal:   ['#10b981', '#06b6d4'],
  prestress:['#f59e0b', '#ef4444'],
  stress:   ['#ef4444', '#dc2626'],
  dark:     ['#060d1a', '#0f1f35'],
  card:     ['#0f1f35', '#162033'],
};