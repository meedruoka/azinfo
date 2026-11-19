// Captures the store screenshots: starts the sample page (Vite) and takes a
// 1280×800 shot of each scene in light and dark with headless Edge or Chrome.
// Usage: pnpm store:shots   (set BROWSER_BIN to override the browser path)
// Output: store/screenshots/<n>-<scene>-<theme>.png
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'vite';

// Async on purpose: a sync call would block this process, and with it the
// Vite server the browser is loading the page from.
const run = promisify(execFile);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** Edge's launcher can exit before its browser process has written the shot. */
async function waitForFile(file, ms = 30_000) {
  for (let waited = 0; waited < ms; waited += 250) {
    if (existsSync(file)) {
      await pause(500); // let the PNG finish writing
      return true;
    }
    await pause(250);
  }
  return false;
}

const CANDIDATES = [
  process.env.BROWSER_BIN,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) throw new Error('No Edge or Chrome found; set BROWSER_BIN.');

/** Order matches docs/store-listing.md "Screenshot checklist". */
const SCENES = ['resource', 'spike', 'group', 'popup', 'pill', 'options'];
const THEMES = ['light', 'dark'];
const OUT = resolve('store/screenshots');

const server = await createServer({ configFile: resolve('scripts/store-shots/vite.config.mts') });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
mkdirSync(OUT, { recursive: true });

try {
  for (const [i, scene] of SCENES.entries()) {
    for (const theme of THEMES) {
      const file = join(OUT, `${i + 1}-${scene}-${theme}.png`);
      // A fresh profile per shot: no extensions, cookies or saved state.
      const profile = mkdtempSync(join(tmpdir(), 'azinfo-shots-'));
      rmSync(file, { force: true });
      let stderr = '';
      try {
        ({ stderr } = await run(
          browser,
          [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--no-first-run',
            '--lang=en-US',
            '--force-device-scale-factor=1',
            '--window-size=1280,800',
            `--user-data-dir=${profile}`,
            `--blink-settings=preferredColorScheme=${theme === 'dark' ? 0 : 1}`,
            ...(theme === 'dark' ? ['--force-dark-mode'] : []),
            '--virtual-time-budget=4000',
            `--screenshot=${file}`,
            `${base}?scene=${scene}`,
          ],
          { timeout: 60_000 },
        ));
        await waitForFile(file);
      } catch (e) {
        stderr = String(e);
      } finally {
        // Edge may hold the profile for a moment after exiting; a leftover temp folder is harmless.
        try {
          rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        } catch {}
      }
      if (existsSync(file)) console.log(`✓ ${file}`);
      else console.log(`✗ ${file} not written\n${stderr.split('\n').slice(-4).join('\n')}`);
    }
  }
} finally {
  await server.close();
}
