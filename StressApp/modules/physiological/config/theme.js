// "Calm Mist" — a brand-new light-only palette (dark mode removed
// app-wide). Soft periwinkle-violet primary, warm coral secondary,
// high-lightness/low-saturation status hues. Same key structure as before
// (COLORS.brand/normal/warning/stress/hrv/gsr/acc + a nested palette
// object) so most call sites don't need to change, only values -- the one
// structural change is COLORS.light is now the ONLY palette (COLORS.dark
// removed) since ThemeContext.js no longer branches on isDark.
export const COLORS = {
  brand:         '#8B87C4',
  brandLight:    '#ADA9D9',
  brandDark:     '#6B679F',
  brandGlow:     '#8B87C418',

  secondary:      '#E2A38F',
  secondaryLight: '#EDBFAF',

  normal:        '#82C0A0',
  normalLight:   '#A7D6BC',
  normalGlow:    '#82C0A018',
  warning:       '#E8B368',
  warningLight:  '#F0C88F',
  warningGlow:   '#E8B36818',
  stress:        '#E08585',
  stressLight:   '#EBA9A9',
  stressGlow:    '#E0858518',

  hrv:           '#8B87C4',
  gsr:           '#B490C9',
  acc:           '#E2A38F',
  behav:         '#E2A38F',

  light: {
    bg:               '#FAF9FC',
    bgGradientTop:    '#F3F0FA',
    bgGradientBottom: '#FBF8F4',
    surface:          '#FFFFFF',
    card:             '#FFFFFF',
    cardHover:        '#F5F3FA',
    border:           '#E9E5F2',
    borderSoft:       '#F1EEF8',
    text:             '#332F45',
    textMuted:        '#8B86A3',
    textSub:          '#6F6A87',
  },
};
