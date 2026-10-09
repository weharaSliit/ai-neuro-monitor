// ============================================================
// layout.js — responsive sizing shared by every screen.
//
// Phones use the full width. On tablets / large screens / landscape the
// content column is capped and centred (ScreenBackground applies this to
// every screen), so cards and charts keep phone-like proportions instead
// of stretching edge to edge. Charts must size from contentWidth, not the
// raw window width, or they overflow the capped column on a tablet.
// ============================================================
import { Dimensions, useWindowDimensions } from 'react-native';

export const MAX_CONTENT_WIDTH = 720;

export function contentWidthFor(windowWidth) {
  return Math.min(windowWidth, MAX_CONTENT_WIDTH);
}

// One-off (module-level) reads -- for constants computed at import time.
export function getContentWidth() {
  return contentWidthFor(Dimensions.get('window').width);
}

// Live version -- re-renders on rotation / split-screen / window resize.
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const contentWidth = contentWidthFor(width);
  return {
    width,
    height,
    contentWidth,
    isTablet: Math.min(width, height) >= 600,
  };
}
