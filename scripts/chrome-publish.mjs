// Uploads the Chrome package to the Chrome Web Store and, with --publish, submits it for review.
// Usage: node scripts/chrome-publish.mjs [--publish] [--dry-run] [--zip <file>]
// Needs CHROME_SERVICE_ACCOUNT_KEY (the JSON key), CHROME_PUBLISHER_ID and CHROME_ITEM_ID
// (GitHub: repository secrets and variables). Without --publish the package is only
// uploaded; nothing reaches users until it's submitted and approved.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createChromeClient } from './chrome-webstore.mjs';

const { values: args } = parseArgs({
  options: {
    publish: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    zip: { type: 'string' },
  },
});

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const zipPath = args.zip ?? `.output/azinfo-${version}-chrome.zip`;
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

if (!existsSync(zipPath)) fail(`${zipPath} not found. Run pnpm zip first.`);

const publisherId = process.env.CHROME_PUBLISHER_ID;
const itemId = process.env.CHROME_ITEM_ID;
let serviceAccountKey;
const missing = [];
if (!process.env.CHROME_SERVICE_ACCOUNT_KEY) missing.push('CHROME_SERVICE_ACCOUNT_KEY');
else {
  try {
    serviceAccountKey = JSON.parse(process.env.CHROME_SERVICE_ACCOUNT_KEY);
  } catch {
    fail('CHROME_SERVICE_ACCOUNT_KEY is not valid JSON (paste the whole key file).');
  }
}
if (!publisherId) missing.push('CHROME_PUBLISHER_ID');
if (!itemId) missing.push('CHROME_ITEM_ID');

const kb = Math.round(statSync(zipPath).size / 1024);
console.log(
  `azinfo ${version}: ${zipPath} (${kb} KB) → Chrome item ${itemId ?? '(CHROME_ITEM_ID not set)'}, ${
    args.publish ? 'upload and submit for review' : 'upload only'
  }.`,
);
if (serviceAccountKey?.client_email)
  console.log(`Service account: ${serviceAccountKey.client_email}`);

if (args['dry-run']) {
  console.log(
    missing.length ? `Dry run: missing ${missing.join(', ')}.` : 'Dry run: settings complete.',
  );
  process.exit(missing.length ? 1 : 0);
}
if (missing.length) fail(`Missing ${missing.join(', ')}.`);

try {
  const chrome = createChromeClient({
    serviceAccountKey,
    publisherId,
    itemId,
    log: (line) => console.log(line),
  });
  await chrome.uploadPackage(readFileSync(zipPath));
  if (args.publish) {
    await chrome.publish();
    console.log('✓ Submitted for review. Google emails the result.');
  } else {
    console.log('✓ Uploaded. Submit it in the Developer Dashboard, or rerun with --publish.');
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
