import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 5174 so this can run side by side with web/ (5173).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, open: true },
});
