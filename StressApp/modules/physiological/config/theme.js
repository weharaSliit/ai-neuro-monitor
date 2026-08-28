// "Freud & Practice Yoga" — vibrant organic wellness palette
// inspired by Freud Score, Practice Yoga, Sensate, and Mindful Hours.
// Rich sage greens, warm terracotta corals, golden ochre, crisp white cards, and warm oat canvas.
export const COLORS = {
  // Brand / Primary Accent (Deep Periwinkle Iris)
  brand:         '#6E68B2',
  brandLight:    '#918BC4',
  brandDark:     '#4F4994',
  brandGlow:     '#6E68B225',
  brandSoft:     '#EFEFFB',
  primary:       '#6E68B2',

  // Secondary Warmth (Warm Terracotta)
  secondary:      '#E56B4E',
  secondaryLight: '#F08B73',
  secondaryGlow:  '#E56B4E22',
  secondarySoft:  '#FDECE8',

  // Health / Normal / Calming (Vibrant Sage Bamboo)
  normal:        '#5E935A',
  normalLight:   '#7CB878',
  normalDark:    '#416E3D',
  normalGlow:    '#5E935A25',
  normalSoft:    '#E7F5E5',
  success:       '#5E935A',

  // Attention / Warning / Moderate Load (Golden Honey Ochre)
  warning:       '#E8A238',
  warningLight:  '#F3BE67',
  warningDark:   '#BA7A1C',
  warningGlow:   '#E8A23825',
  warningSoft:   '#FEF5E7',

  // Stress / Alert (Warm Terracotta Coral)
  stress:        '#E56B4E',
  stressLight:   '#F08B73',
  stressDark:    '#BD472C',
  stressGlow:    '#E56B4E25',
  stressSoft:    '#FDECE8',
  danger:        '#E56B4E',

  // Sensor & Telemetry Semantic Hues
  hrv:           '#5E935A',
  gsr:           '#6E68B2',
  acc:           '#E56B4E',
  behav:         '#E8A238',
  eeg:           '#E8A238',

  light: {
    bg:               '#F8F6F0',
    background:       '#F8F6F0',
    bgGradientTop:    '#F2EFE8',
    bgGradientBottom: '#FAF8F4',
    surface:          '#FFFFFF',
    card:             '#FFFFFF',
    cardHover:        '#F6F3EC',
    cardGlass:        '#FFFFFFFA',
    border:           '#EAE5DA',
    borderSoft:       '#F2EEE4',
    text:             '#231F20',
    textSub:          '#544E50',
    textMuted:        '#989294',
    pillBg:           '#F0ECE4',
  },
};

// Aliases ensuring no undefined property access crashes anywhere
COLORS.colors = { ...COLORS, ...COLORS.light };
COLORS.light.colors = COLORS.colors;
COLORS.dark = COLORS.light;
COLORS.theme = COLORS.light;

export const colors = COLORS;
export default COLORS;
