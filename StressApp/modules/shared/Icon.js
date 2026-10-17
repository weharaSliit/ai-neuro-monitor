import React from 'react';
import Svg, { Path } from 'react-native-svg';
import ICON_PATHS from './iconPaths';

// Material Design Icons drawn as SVG paths (react-native-svg), so icons never
// depend on downloading a font from the dev server. Same icon names as before;
// paths come from @mdi/js and are listed in iconPaths.js.
// Semantic icons (a literal brain, heart-pulse, meditation figure) replace the
// emoji used throughout the app pre-redesign (see NAMES below for the mapping).
export default function Icon({ name, size = 22, color = '#000000', style }) {
  const d = ICON_PATHS[name] || ICON_PATHS['help-circle-outline'];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d={d} fill={color} />
    </Svg>
  );
}

// Central emoji -> icon-name map, one place to look up/change what each
// concept renders as, instead of re-deciding per screen.
export const NAMES = {
  overview:     'gauge',          // Fusion/landing tab
  my:           'heart-pulse',    // Ring tab
  eeg:          'brain',
  phenotyping:  'cellphone',
  intervention: 'meditation',     // Relaxation Guide tab
  profile:      'account-circle',
  history:      'history',
  calibration:  'target',
  ema:          'chart-line',
  pss4:         'clipboard-text-outline',
  device:       'access-point',
  logout:       'logout',
  back:         'chevron-left',
  chevronRight: 'chevron-right',
  camera:       'camera-outline',
  warning:      'alert-circle-outline',
  check:        'check-circle-outline',
  refresh:      'refresh',
  admin:        'shield-account-outline',
  trendUp:      'trending-up',
  trendDown:    'trending-down',
  trendFlat:    'trending-neutral',
  signal:       'signal-cellular-3',
  wifiOff:      'wifi-off',

  // Normal/Stress state icons -- replaces the emoji faces used
  // pre-redesign. Same 0/1 Normal/Stress vocabulary everywhere.
  moodNormal:   'emoticon-happy-outline',
  moodStress:   'emoticon-sad-outline',
  moodHappy:    'emoticon-happy-outline',
  moodCalm:     'emoticon-outline',
  moodNeutral:  'emoticon-neutral-outline',

  // Wellness & Zen concepts
  breathe:      'weather-windy',
  lotus:        'flower-tulip-outline',
  sparkle:      'creation',
  sound:        'volume-high',
  wave:         'waveform',
  heart:        'heart-pulse',
  shield:       'shield-check-outline',
  info:         'information-outline',
  bell:         'bell-outline',
  sparkles:     'creation',
};
