// Client for the Chrome Web Store API v2 (current since October 2025):
// https://developer.chrome.com/docs/webstore/using-api
// Signs in with a service account (JSON key, JWT bearer grant), uploads a
// package to an existing item, waits until Google has processed it, and
// optionally submits it for review. It never prints the key or the token.
import { createSign } from 'node:crypto';

export const CWS_API = 'https://chromewebstore.googleapis.com';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const CWS_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

export class ChromeApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ChromeApiError';
    this.details = details;
  }
}

const base64url = (input) => Buffer.from(input).toString('base64url');

/** A signed JWT asking Google for a Chrome Web Store access token (valid 1 hour). */
export function serviceAccountAssertion(key, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!key?.client_email || !key?.private_key) {
    throw new ChromeApiError('The service account key needs client_email and private_key.');
  }
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: CWS_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(key.private_key, 'base64url');
  return `${header}.${claims}.${signature}`;
}

/** Google's error message from an API response, without echoing request data. */
async function describe(res) {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text);
    const e = body.error;
    if (typeof e === 'string')
      return `${e}${body.error_description ? `: ${body.error_description}` : ''}`;
    if (e?.message) return `${e.status ?? e.code ?? ''} ${e.message}`.trim();
  } catch {
    // Not JSON: fall through.
  }
  return text.slice(0, 300);
}

const IN_PROGRESS = new Set(['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']);

/**
 * @param {object} o
 * @param {object} o.serviceAccountKey Parsed JSON key of the service account.
 * @param {string} o.publisherId Developer Dashboard > Publisher > Settings.
 * @param {string} o.itemId The 32-letter extension ID.
 */
export function createChromeClient({
  serviceAccountKey,
  publisherId,
  itemId,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  now = () => Math.floor(Date.now() / 1000),
  pollMs = 5000,
  timeoutMs = 10 * 60 * 1000,
  log = () => {},
}) {
  if (!publisherId) throw new ChromeApiError('Missing publisherId.');
  if (!itemId) throw new ChromeApiError('Missing itemId.');
  const item = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(itemId)}`;
  let token;

  async function accessToken() {
    if (token && token.expires > now() + 60) return token.value;
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: serviceAccountAssertion(serviceAccountKey, now()),
      }),
    });
    if (!res.ok) {
      throw new ChromeApiError(
        `Google sign-in failed: HTTP ${res.status} ${await describe(res)}. Check the service account key and that the Chrome Web Store API is enabled in its Google Cloud project.`,
        { status: res.status },
      );
    }
    const body = await res.json();
    token = { value: body.access_token, expires: now() + (body.expires_in ?? 3600) };
    return token.value;
  }

  async function call(method, url, { body, contentType } = {}, what) {
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
      body,
    });
    if (!res.ok) {
      const hint =
        res.status === 403
          ? ' Add the service account under Account in the Chrome Developer Dashboard.'
          : res.status === 404
            ? ' Check CHROME_PUBLISHER_ID and CHROME_ITEM_ID.'
            : '';
      throw new ChromeApiError(
        `${what} failed: HTTP ${res.status} ${await describe(res)}.${hint}`,
        {
          status: res.status,
        },
      );
    }
    return res.json();
  }

  async function waitForUpload() {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await sleep(pollMs);
      const status = await call('GET', `${CWS_API}/v2/${item}:fetchStatus`, {}, 'Upload status');
      const state = status.lastAsyncUploadState;
      if (state === 'SUCCEEDED') return status;
      if (!IN_PROGRESS.has(state)) {
        throw new ChromeApiError(`Upload ended as ${JSON.stringify(state)}.`, { status });
      }
      if (Date.now() >= deadline) {
        throw new ChromeApiError(`Upload still in progress after ${timeoutMs / 1000} s.`);
      }
      log('Package upload: in progress…');
    }
  }

  return {
    /** Uploads a zip as the item's next version and waits until Google has processed it. */
    async uploadPackage(zip) {
      const result = await call(
        'POST',
        `${CWS_API}/upload/v2/${item}:upload`,
        { body: zip, contentType: 'application/zip' },
        'Package upload',
      );
      if (result.uploadState === 'SUCCEEDED') {
        log(`Package upload: succeeded (version ${result.crxVersion ?? '?'}).`);
        return result;
      }
      if (!IN_PROGRESS.has(result.uploadState)) {
        throw new ChromeApiError(`Package upload ended as ${JSON.stringify(result.uploadState)}.`, {
          result,
        });
      }
      log('Package upload accepted; waiting for Google to process it.');
      const status = await waitForUpload();
      log('Package upload: succeeded.');
      return status;
    },

    /** Submits the uploaded version for review (default publish, full rollout after approval). */
    async publish() {
      const result = await call(
        'POST',
        `${CWS_API}/v2/${item}:publish`,
        {
          body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
          contentType: 'application/json',
        },
        'Publish',
      );
      for (const w of result.warningInfo?.warnings ?? []) {
        log(`Warning from Google: ${w.reason ?? ''} ${w.description ?? ''}`.trim());
      }
      log(`Publish: item state ${result.state ?? 'unknown'}.`);
      return result;
    },
  };
}
