// ============================================================
// tokens.js — spacing, radius, type scale, elevation.
//
// theme.js defines colors only; every screen was independently
// hand-rolling its own fontSize/margin/borderRadius values for
// conceptually identical things (e.g. "card title" declared
// separately, with matching values today, in at least 3 screens --
// already at risk of silently drifting apart). This file is the
// single source of truth for everything color.js doesn't cover.
// Purely additive -- does not touch theme.js's color system.
// ============================================================

export const SPACE = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32,
};

export const RADIUS = {
  sm: 10, md: 14, lg: 20, xl: 24, pill: 28,
};

// Matches Card.js's existing values exactly (borderRadius:20 -> lg,
// its two shadow blocks -> resting/elevated below) -- this file
// codifies what Card.js already does informally, not a new look.
export const TYPE = {
  display:  { fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },  // screen titles / greeting
  title:    { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },  // card titles
  subtitle: { fontSize: 13, fontWeight: '700' },                       // card sub / captions
  body:     { fontSize: 13, fontWeight: '500' },
  caption:  { fontSize: 11, fontWeight: '700' },                       // pills, labels
  micro:    { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
};

export const ELEVATION = {
  resting: {
    shadowColor: '#1E293B', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
  },
  elevated: {
    shadowColor: '#1E293B', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07, shadowRadius: 18, elevation: 4,
  },
};
