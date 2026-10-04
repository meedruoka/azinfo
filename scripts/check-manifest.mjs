// Checks the built production manifests against the permissions the spec allows.
// Run after `pnpm build && pnpm build:edge`: `pnpm check:manifest`.
import { readFileSync } from 'node:fs';

const EXPECTED = {
  permissions: ['identity', 'storage'],
  host_permissions: [
    'https://login.microsoftonline.com/*',
    'https://management.azure.com/*',
    'https://portal.azure.com/*',
  ],
  contentScriptMatches: ['https://portal.azure.com/*'],
};

/** Manifest keys that would widen access beyond the spec. */
const FORBIDDEN_KEYS = [
  'key',
  'optional_permissions',
  'optional_host_permissions',
  'web_accessible_resources',
  'externally_connectable',
  'content_security_policy',
  'oauth2',
];

const sorted = (list = []) => [...list].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

let failed = false;
for (const target of ['chrome-mv3', 'edge-mv3']) {
  const path = `.output/${target}/manifest.json`;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.error(`✗ ${path} missing. Run pnpm build && pnpm build:edge first.`);
    failed = true;
    continue;
  }

  const problems = [];
  if (manifest.manifest_version !== 3) problems.push('manifest_version is not 3');
  if (!same(manifest.permissions, EXPECTED.permissions)) {
    problems.push(`permissions ${JSON.stringify(manifest.permissions)}`);
  }
  if (!same(manifest.host_permissions, EXPECTED.host_permissions)) {
    problems.push(`host_permissions ${JSON.stringify(manifest.host_permissions)}`);
  }
  const matches = (manifest.content_scripts ?? []).flatMap((cs) => cs.matches ?? []);
  if (!same([...new Set(matches)], EXPECTED.contentScriptMatches)) {
    problems.push(`content script matches ${JSON.stringify(matches)}`);
  }
  for (const key of FORBIDDEN_KEYS) {
    if (key in manifest) problems.push(`unexpected "${key}"`);
  }

  if (problems.length) {
    failed = true;
    console.error(`✗ ${target}: ${problems.join('; ')}`);
  } else {
    console.log(
      `✓ ${target} ${manifest.version}: permissions ${manifest.permissions.join(', ')}; hosts ${manifest.host_permissions.length}; content script on portal.azure.com only`,
    );
  }
}
process.exit(failed ? 1 : 0);
