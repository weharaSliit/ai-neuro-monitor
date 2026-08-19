import { createContext, useContext } from 'react';

export const AppContext = createContext(null);

export function useAppState() {
  return useContext(AppContext);
}