// Renders assets-src/icon.svg to the PNG sizes the extension and stores need,
// using headless Edge (or Chrome) so no image library is required.
// Usage: pnpm render:icons   (set BROWSER_BIN to override the browser path)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  process.env.BROWSER_BIN,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) throw new Error('No Edge or Chrome found; set BROWSER_BIN.');

const svg = readFileSync('assets-src/icon.svg', 'utf8');
const targets = [
  ...[16, 32, 48, 96, 128].map((size) => ({ size, out: `public/icon/${size}.png` })),
  // Edge Add-ons store logo (300×300).
  { size: 300, out: 'store/logo-300.png' },
];

const work = mkdtempSync(join(tmpdir(), 'azinfo-icons-'));
try {
  for (const { size, out } of targets) {
    const html = join(work, `${size}.html`);
    writeFileSync(
      html,
      `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace(
        '<svg ',
        `<svg width="${size}" height="${size}" style="display:block" `,
      )}</body></html>`,
    );
    mkdirSync(resolve(out, '..'), { recursive: true });
    execFileSync(
      browser,
      [
        // Throwaway profile: never touch the user's real browser profile or sync.
        `--user-data-dir=${join(work, 'profile')}`,
        '--no-first-run',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--window-size=${size},${size}`,
        `--screenshot=${resolve(out)}`,
        pathToFileURL(html).href,
      ],
      // Fail clearly instead of hanging if the browser stalls on startup.
      { timeout: 90_000, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const png = readFileSync(out);
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    if (w !== size || h !== size) throw new Error(`${out} is ${w}×${h}, expected ${size}×${size}`);
    console.log(`✓ ${out} ${w}×${h}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
