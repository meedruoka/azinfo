// Serves the store-screenshot page: the real UI components with sample data.
// `wxt/utils/storage` is swapped for an in-memory stand-in; `browser` is left
// undefined, so text falls back to the bundled English (see lib/i18n.ts).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: here,
  logLevel: 'warn',
  resolve: {
    alias: [
      { find: 'wxt/utils/storage', replacement: `${here}storage-shim.ts` },
      { find: /^@\//, replacement: `${root}` },
    ],
  },
  // Never read the project's .env files: no client ID or tenant reaches the page.
  envDir: here,
  envPrefix: 'STORE_SHOTS_',
  server: { port: 5199, strictPort: true, fs: { allow: [root] } },
});
