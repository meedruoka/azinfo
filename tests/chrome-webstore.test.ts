import { createVerify, generateKeyPairSync } from 'node:crypto';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  ChromeApiError,
  CWS_API,
  CWS_SCOPE,
  createChromeClient,
  serviceAccountAssertion,
  TOKEN_URL,
} from '../scripts/chrome-webstore.mjs';
import { server } from './msw-server';

// Throwaway key pair made for the test: never a real credential.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const KEY = { client_email: 'publisher@example.iam.gserviceaccount.com', private_key: privateKey };
const PUBLISHER = 'pub-1';
const ITEM = 'agbbplllbldedlebmjoplcjilocgphia';
const ITEM_PATH = `publishers/${PUBLISHER}/items/${ITEM}`;
const NOW = 1_800_000_000;
const TOKEN = 'ya29.test-access-token';

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

function client() {
  const lines: string[] = [];
  const chrome = createChromeClient({
    serviceAccountKey: KEY,
    publisherId: PUBLISHER,
    itemId: ITEM,
    sleep: async () => {},
    now: () => NOW,
    pollMs: 1,
    log: (l: string) => lines.push(l),
  });
  return { chrome, lines };
}

function tokenEndpoint(onRequest: (body: URLSearchParams) => void = () => {}) {
  return http.post(TOKEN_URL, async ({ request }) => {
    onRequest(new URLSearchParams(await request.text()));
    return HttpResponse.json({ access_token: TOKEN, expires_in: 3600, token_type: 'Bearer' });
  });
}

describe('serviceAccountAssertion', () => {
  it('is a JWT signed with the key, for the Chrome Web Store scope, valid one hour', () => {
    const jwt = serviceAccountAssertion(KEY, NOW);
    const [header = '', claims = '', signature = ''] = jwt.split('.');
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(claims)).toEqual({
      iss: KEY.client_email,
      scope: CWS_SCOPE,
      aud: TOKEN_URL,
      iat: NOW,
      exp: NOW + 3600,
    });
    const valid = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, signature, 'base64url');
    expect(valid).toBe(true);
  });

  it('refuses a key without client_email or private_key', () => {
    expect(() => serviceAccountAssertion({ client_email: '', private_key: '' })).toThrow(
      ChromeApiError,
    );
  });
});

describe('Chrome Web Store client', () => {
  it('signs in with the JWT bearer grant, uploads the zip and waits for processing', async () => {
    let grant: URLSearchParams | undefined;
    const seen: { auth?: string | null; type?: string | null; size?: number } = {};
    let polls = 0;
    server.use(
      tokenEndpoint((body) => {
        grant = body;
      }),
      http.post(`${CWS_API}/upload/v2/${ITEM_PATH}:upload`, async ({ request }) => {
        seen.auth = request.headers.get('authorization');
        seen.type = request.headers.get('content-type');
        seen.size = (await request.arrayBuffer()).byteLength;
        return HttpResponse.json({ name: ITEM_PATH, itemId: ITEM, uploadState: 'IN_PROGRESS' });
      }),
      http.get(`${CWS_API}/v2/${ITEM_PATH}:fetchStatus`, () =>
        HttpResponse.json({
          lastAsyncUploadState: ++polls < 2 ? 'UPLOAD_IN_PROGRESS' : 'SUCCEEDED',
        }),
      ),
    );
    const { chrome } = client();
    await chrome.uploadPackage(new Uint8Array([1, 2, 3, 4]));
    expect(grant?.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(grant?.get('assertion')?.split('.')).toHaveLength(3);
    expect(seen).toEqual({ auth: `Bearer ${TOKEN}`, type: 'application/zip', size: 4 });
    expect(polls).toBe(2);
  });

  it('finishes at once when Google processes the upload synchronously', async () => {
    let polled = false;
    server.use(
      tokenEndpoint(),
      http.post(`${CWS_API}/upload/v2/${ITEM_PATH}:upload`, () =>
        HttpResponse.json({ uploadState: 'SUCCEEDED', crxVersion: '0.1.1' }),
      ),
      http.get(`${CWS_API}/v2/${ITEM_PATH}:fetchStatus`, () => {
        polled = true;
        return HttpResponse.json({});
      }),
    );
    const { chrome, lines } = client();
    await chrome.uploadPackage(new Uint8Array([1]));
    expect(polled).toBe(false);
    expect(lines.join(' ')).toContain('0.1.1');
  });

  it('reports a failed upload', async () => {
    server.use(
      tokenEndpoint(),
      http.post(`${CWS_API}/upload/v2/${ITEM_PATH}:upload`, () =>
        HttpResponse.json({ uploadState: 'FAILED' }),
      ),
    );
    const { chrome } = client();
    await expect(chrome.uploadPackage(new Uint8Array([1]))).rejects.toThrow(/FAILED/);
  });

  it('publishes with the default publish type, reusing the access token, and logs warnings', async () => {
    let tokenCalls = 0;
    let body: unknown;
    server.use(
      tokenEndpoint(() => tokenCalls++),
      http.post(`${CWS_API}/upload/v2/${ITEM_PATH}:upload`, () =>
        HttpResponse.json({ uploadState: 'SUCCEEDED' }),
      ),
      http.post(`${CWS_API}/v2/${ITEM_PATH}:publish`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          state: 'PENDING_REVIEW',
          warningInfo: { warnings: [{ reason: 'SAMPLE', description: 'A warning' }] },
        });
      }),
    );
    const { chrome, lines } = client();
    await chrome.uploadPackage(new Uint8Array([1]));
    await chrome.publish();
    expect(body).toEqual({ publishType: 'DEFAULT_PUBLISH' });
    expect(tokenCalls).toBe(1);
    expect(lines.some((l) => l.includes('A warning'))).toBe(true);
    expect(lines.some((l) => l.includes('PENDING_REVIEW'))).toBe(true);
  });

  it('explains a 403 (service account not added in the dashboard)', async () => {
    server.use(
      tokenEndpoint(),
      http.post(`${CWS_API}/upload/v2/${ITEM_PATH}:upload`, () =>
        HttpResponse.json(
          {
            error: {
              code: 403,
              status: 'PERMISSION_DENIED',
              message: 'The caller does not have permission',
            },
          },
          { status: 403 },
        ),
      ),
    );
    const { chrome } = client();
    await expect(chrome.uploadPackage(new Uint8Array([1]))).rejects.toThrow(
      /HTTP 403 PERMISSION_DENIED.*Developer Dashboard/,
    );
  });

  it('explains a failed sign-in without printing the key or token', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json(
          { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' },
          { status: 400 },
        ),
      ),
    );
    const { chrome, lines } = client();
    const err = await chrome.uploadPackage(new Uint8Array([1])).catch((e: Error) => e);
    expect(err.message).toMatch(/sign-in failed: HTTP 400 invalid_grant: Invalid JWT Signature/);
    expect(`${err.message} ${lines.join(' ')}`).not.toContain('PRIVATE KEY');
  });
});
