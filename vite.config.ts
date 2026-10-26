import { miniappManifest } from '@heybox/hb-sdk/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: './',
  // Explicit business-only preview; production always retains the Runtime Gate.
  plugins: command === 'serve' && process.env.VITE_STANDALONE === '1' ? [] : [miniappManifest()],
}));
