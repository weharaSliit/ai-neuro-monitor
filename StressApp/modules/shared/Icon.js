import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// MaterialCommunityIcons over Feather -- this app needs specific semantic
// icons (a literal brain, heart-pulse, meditation figure) that Feather's
// more abstract line-icon set doesn't have. Replaces the emoji used
// throughout the app pre-redesign (see NAMES below for the mapping).
export default function Icon({ name, size = 22, color, style }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} style={style} />;
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
  sparkle:      'sparkles',
  sound:        'volume-high',
  wave:         'waveform',
  heart:        'heart-pulse',
  shield:       'shield-check-outline',
  info:         'information-outline',
  bell:         'bell-outline',
  sparkles:     'creation',
};
