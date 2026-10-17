import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` makes the built site work from any folder, including
// GitHub Pages project sites (https://user.github.io/repo/).
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    globals: true,
    environment: 'node',
    // Some tests run whole simulations, which take a few seconds and slow down when files run side by side.
    testTimeout: 20000
  }
});
