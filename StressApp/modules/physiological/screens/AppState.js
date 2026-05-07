// ============================================================
// AppState.js — shared state across all screens
// ============================================================

import { useState, createContext, useContext } from 'react';

export const AppContext = createContext(null);

export function useAppState() {
  return useContext(AppContext);
}