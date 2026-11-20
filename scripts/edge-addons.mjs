// Client for the Microsoft Edge Add-ons Update REST API (v1.1, API key auth):
// https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api
// Upload a package to the draft submission, then optionally publish it.
// It never prints the API key; errors carry only Microsoft's status fields.

export const EDGE_API = 'https://api.addons.microsoftedge.microsoft.com';

export class EdgeApiError extends Error {
  /** `details`: Microsoft's errorCode and errors, or the HTTP status. */
  constructor(message, details = {}) {
    super(message);
    this.name = 'EdgeApiError';
    this.details = details;
  }
}

/** The operation ID from a Location header, which may be a bare ID or a URL path. */
export function operationIdFrom(location) {
  const id = location?.trim().replace(/\/+$/, '').split('/').pop();
  if (!id) throw new EdgeApiError('The response had no Location header with an operation ID.');
  return id;
}

/**
 * @param {object} o
 * @param {string} o.clientId
 * @param {string} o.apiKey
 * @param {string} o.productId Partner Center product ID (a GUID).
 * @param {typeof fetch} [o.fetchImpl]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {number} [o.pollMs] Pause between status checks.
 * @param {number} [o.timeoutMs] Give up waiting for one operation after this long.
 * @param {(line: string) => void} [o.log]
 */
export function createEdgeClient({
  clientId,
  apiKey,
  productId,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  pollMs = 5000,
  timeoutMs = 10 * 60 * 1000,
  log = () => {},
}) {
  for (const [name, value] of Object.entries({ clientId, apiKey, productId })) {
    if (!value) throw new EdgeApiError(`Missing ${name}.`);
  }
  const auth = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
  const product = `/v1/products/${encodeURIComponent(productId)}`;

  /** One call; retries 429 a few times, honouring Retry-After. */
  async function call(method, path, { body, contentType } = {}) {
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(`${EDGE_API}${path}`, {
        method,
        headers: { ...auth, ...(contentType ? { 'Content-Type': contentType } : {}) },
        body,
      });
      if (res.status !== 429 || attempt >= 5) return res;
      const wait = Number(res.headers.get('retry-after')) * 1000 || pollMs * attempt;
      log(`Throttled by the Edge API (429); retrying in ${Math.round(wait / 1000)} s.`);
      await sleep(wait);
    }
  }

  async function failure(res, what) {
    const text = await res.text().catch(() => '');
    const hint =
      res.status === 401
        ? ' Check EDGE_CLIENT_ID and EDGE_API_KEY; API keys expire (see Partner Center > Publish API).'
        : res.status === 404
          ? ' Check EDGE_PRODUCT_ID (Partner Center > the extension > Extension identity > Product ID).'
          : '';
    return new EdgeApiError(`${what} failed: HTTP ${res.status}.${hint}`, {
      status: res.status,
      body: text.slice(0, 500),
    });
  }

  /** Starts an operation (expects 202 + Location) and returns its ID. */
  async function start(method, path, options, what) {
    const res = await call(method, path, options);
    if (res.status !== 202) throw await failure(res, what);
    return operationIdFrom(res.headers.get('location'));
  }

  /** Polls an operation until it leaves InProgress; returns the final status object. */
  async function wait(statusPath, what) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await call('GET', statusPath);
      // The reference lists 200; the official sample checks 202. Accept both.
      if (res.status !== 200 && res.status !== 202) throw await failure(res, `${what} status`);
      const op = await res.json();
      if (op.status === 'Succeeded') {
        log(`${what}: ${op.message ?? 'succeeded'}`);
        return op;
      }
      if (op.status === 'Failed') {
        const errors = (op.errors ?? []).map((e) => e?.message ?? JSON.stringify(e));
        throw new EdgeApiError(
          `${what} failed: ${op.message ?? 'no message'}${op.errorCode ? ` (${op.errorCode})` : ''}${
            errors.length ? `: ${errors.join('; ')}` : ''
          }`,
          { errorCode: op.errorCode, errors: op.errors },
        );
      }
      if (op.status !== 'InProgress') {
        throw new EdgeApiError(`${what}: unexpected status ${JSON.stringify(op.status)}.`, { op });
      }
      if (Date.now() >= deadline) {
        throw new EdgeApiError(`${what} still in progress after ${timeoutMs / 1000} s.`);
      }
      log(`${what}: in progress…`);
      await sleep(pollMs);
    }
  }

  return {
    /** Uploads a zip to the draft submission and waits until Microsoft has processed it. */
    async uploadPackage(zip) {
      const id = await start(
        'POST',
        `${product}/submissions/draft/package`,
        { body: zip, contentType: 'application/zip' },
        'Package upload',
      );
      log(`Package upload accepted (operation ${id}).`);
      return wait(`${product}/submissions/draft/package/operations/${id}`, 'Package upload');
    },

    /** Submits the draft for certification with notes for the testers, and waits for the result. */
    async publish(notes) {
      // The docs say "JSON" with a { notes } sample: send JSON with a notes field.
      const id = await start(
        'POST',
        `${product}/submissions`,
        { body: JSON.stringify({ notes }), contentType: 'application/json' },
        'Publish',
      );
      log(`Publish accepted (operation ${id}).`);
      return wait(`${product}/submissions/operations/${id}`, 'Publish');
    },
  };
}
