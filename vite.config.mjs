import { defineConfig } from 'vite';

// Keep local development at / while allowing repository-scoped GitHub Pages builds.
export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE || '/',
});
