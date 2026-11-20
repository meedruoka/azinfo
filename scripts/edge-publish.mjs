// Uploads the Edge package to Partner Center and, with --publish, submits it.
// Usage: node scripts/edge-publish.mjs [--publish] [--dry-run] [--zip <file>] [--notes <file>]
// Needs EDGE_CLIENT_ID, EDGE_API_KEY and EDGE_PRODUCT_ID in the environment
// (GitHub: repository secrets and variables). Without --publish the package only
// replaces the draft; nothing reaches users until it's submitted and approved.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createEdgeClient } from './edge-addons.mjs';

const { values: args } = parseArgs({
  options: {
    publish: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    zip: { type: 'string' },
    notes: { type: 'string', default: 'store/certification-notes.txt' },
  },
});

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const zipPath = args.zip ?? `.output/azinfo-${version}-edge.zip`;
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

if (!existsSync(zipPath)) fail(`${zipPath} not found. Run pnpm zip:edge first.`);
if (args.publish && !existsSync(args.notes)) fail(`${args.notes} not found.`);
const notes = args.publish ? readFileSync(args.notes, 'utf8').trim() : '';
if (notes.length >= 2000)
  fail(`Certification notes are ${notes.length} characters; the limit is 2000.`);

const env = {
  clientId: process.env.EDGE_CLIENT_ID,
  apiKey: process.env.EDGE_API_KEY,
  productId: process.env.EDGE_PRODUCT_ID,
};
const kb = Math.round(statSync(zipPath).size / 1024);
console.log(
  `azinfo ${version}: ${zipPath} (${kb} KB) → Edge product ${env.productId ?? '(EDGE_PRODUCT_ID not set)'}, ${
    args.publish ? 'upload and submit for certification' : 'upload to the draft only'
  }.`,
);

if (args['dry-run']) {
  const missing = Object.entries({
    EDGE_CLIENT_ID: env.clientId,
    EDGE_API_KEY: env.apiKey,
    EDGE_PRODUCT_ID: env.productId,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  console.log(
    missing.length ? `Dry run: missing ${missing.join(', ')}.` : 'Dry run: settings complete.',
  );
  process.exit(missing.length ? 1 : 0);
}

try {
  const edge = createEdgeClient({ ...env, log: (line) => console.log(line) });
  await edge.uploadPackage(readFileSync(zipPath));
  if (args.publish) {
    await edge.publish(notes);
    console.log('✓ Submitted for certification. Partner Center emails the result.');
  } else {
    console.log('✓ Uploaded to the draft. Submit it in Partner Center, or rerun with --publish.');
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
