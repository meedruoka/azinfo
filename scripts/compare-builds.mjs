// Compares a release package with the extension your browser installed from a store.
// Usage: node scripts/compare-builds.mjs <unzipped release folder> <installed extension folder>
// Exit code 0 when every file matches, 1 otherwise. See README "Compare with your installed copy".
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Added by the stores, not part of the package: their signatures and hashes. */
const STORE_FOLDERS = ['_metadata'];

/** Manifest fields the stores add when they publish (the update address and the store key). */
export const STORE_MANIFEST_FIELDS = ['update_url', 'key'];

/** Every file under `dir`, as forward-slash paths relative to it, sorted. */
export function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.filter((p) => !STORE_FOLDERS.some((f) => p === f || p.startsWith(`${f}/`))).sort();
}

/** The manifest without the fields the stores add, with keys sorted, as text. */
export function normaliseManifest(text) {
  const manifest = JSON.parse(text);
  for (const field of STORE_MANIFEST_FIELDS) delete manifest[field];
  const sortKeys = (v) =>
    Array.isArray(v)
      ? v.map(sortKeys)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sortKeys(v[k])]),
          )
        : v;
  return JSON.stringify(sortKeys(manifest));
}

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * Differences between two extension folders: files only in one of them, and
 * files whose contents differ. `manifest.json` is compared without the fields
 * the stores add.
 */
export function compareBuilds(releaseDir, installedDir) {
  const release = listFiles(releaseDir);
  const installed = listFiles(installedDir);
  const inInstalled = new Set(installed);
  const inRelease = new Set(release);
  const onlyInRelease = release.filter((p) => !inInstalled.has(p));
  const onlyInstalled = installed.filter((p) => !inRelease.has(p));
  const different = release.filter((p) => {
    if (!inInstalled.has(p)) return false;
    const a = readFileSync(join(releaseDir, p));
    const b = readFileSync(join(installedDir, p));
    if (p === 'manifest.json') {
      return normaliseManifest(a.toString('utf8')) !== normaliseManifest(b.toString('utf8'));
    }
    return hash(a) !== hash(b);
  });
  return { compared: release.length, onlyInRelease, onlyInstalled, different };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [releaseDir, installedDir] = process.argv.slice(2);
  if (!releaseDir || !installedDir) {
    console.error(
      'Usage: node scripts/compare-builds.mjs <unzipped release folder> <installed extension folder>',
    );
    process.exit(2);
  }
  const result = compareBuilds(releaseDir, installedDir);
  const problems = [
    ...result.onlyInRelease.map((p) => `missing from the installed copy: ${p}`),
    ...result.onlyInstalled.map((p) => `only in the installed copy: ${p}`),
    ...result.different.map((p) => `different: ${p}`),
  ];
  if (problems.length === 0) {
    console.log(
      `Identical: ${result.compared} files match (store signatures and update fields left out).`,
    );
  } else {
    console.log(problems.join('\n'));
  }
  process.exit(problems.length === 0 ? 0 : 1);
}
