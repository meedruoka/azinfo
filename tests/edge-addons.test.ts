import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  createEdgeClient,
  EDGE_API,
  EdgeApiError,
  operationIdFrom,
} from '../scripts/edge-addons.mjs';
import { server } from './msw-server';

const PRODUCT = '00000000-0000-0000-0000-00000000cafe';
const BASE = `${EDGE_API}/v1/products/${PRODUCT}`;
const KEY = 'secret-api-key-value';

function client() {
  const lines: string[] = [];
  const edge = createEdgeClient({
    clientId: 'client-1',
    apiKey: KEY,
    productId: PRODUCT,
    sleep: async () => {},
    pollMs: 1,
    log: (l: string) => lines.push(l),
  });
  return { edge, lines };
}

describe('operationIdFrom', () => {
  it.each([
    ['op-123', 'op-123'],
    ['/v1/products/p/submissions/draft/package/operations/op-123', 'op-123'],
    ['https://x.example/operations/op-123/', 'op-123'],
  ])('%s → %s', (location, id) => {
    expect(operationIdFrom(location)).toBe(id);
  });

  it('fails without a Location header', () => {
    expect(() => operationIdFrom(null)).toThrow(EdgeApiError);
  });
});

describe('Edge Add-ons client', () => {
  it('uploads the zip with API key auth and waits until processing succeeds', async () => {
    const seen: {
      auth?: string | null;
      clientId?: string | null;
      type?: string | null;
      size?: number;
    } = {};
    let polls = 0;
    server.use(
      http.post(`${BASE}/submissions/draft/package`, async ({ request }) => {
        seen.auth = request.headers.get('authorization');
        seen.clientId = request.headers.get('x-clientid');
        seen.type = request.headers.get('content-type');
        seen.size = (await request.arrayBuffer()).byteLength;
        return new HttpResponse(null, { status: 202, headers: { Location: 'op-1' } });
      }),
      http.get(`${BASE}/submissions/draft/package/operations/op-1`, () =>
        HttpResponse.json(
          ++polls < 3
            ? { status: 'InProgress' }
            : { status: 'Succeeded', message: 'Successfully updated package to x.zip' },
        ),
      ),
    );
    const { edge } = client();
    const op = await edge.uploadPackage(new Uint8Array([1, 2, 3]));
    expect(op.status).toBe('Succeeded');
    expect(seen).toEqual({
      auth: `ApiKey ${KEY}`,
      clientId: 'client-1',
      type: 'application/zip',
      size: 3,
    });
    expect(polls).toBe(3);
  });

  it('publishes with the notes as JSON and waits for the submission', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}/submissions`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 202, headers: { Location: 'pub-9' } });
      }),
      http.get(`${BASE}/submissions/operations/pub-9`, () =>
        HttpResponse.json({
          status: 'Succeeded',
          message: 'Successfully created submission with ID 1',
        }),
      ),
    );
    const { edge } = client();
    await edge.publish('How to test: sign in.');
    expect(body).toEqual({ notes: 'How to test: sign in.' });
  });

  it('reports a failed publish with Microsoft’s error code and messages', async () => {
    server.use(
      http.post(
        `${BASE}/submissions`,
        () => new HttpResponse(null, { status: 202, headers: { Location: 'pub-2' } }),
      ),
      http.get(`${BASE}/submissions/operations/pub-2`, () =>
        HttpResponse.json({
          status: 'Failed',
          message: "Can't publish extension as your extension submission is in progress.",
          errorCode: 'InProgressSubmission',
          errors: null,
        }),
      ),
    );
    const { edge } = client();
    await expect(edge.publish('notes')).rejects.toThrow(/InProgressSubmission/);
  });

  it('explains a 401 without ever printing the API key', async () => {
    server.use(
      http.post(`${BASE}/submissions/draft/package`, () =>
        HttpResponse.text('Unauthorized', { status: 401 }),
      ),
    );
    const { edge, lines } = client();
    const err = await edge.uploadPackage(new Uint8Array([1])).catch((e: Error) => e);
    expect(err).toBeInstanceOf(EdgeApiError);
    expect(err.message).toMatch(/HTTP 401.*API keys expire/);
    expect(
      `${err.message} ${JSON.stringify((err as EdgeApiError).details)} ${lines.join(' ')}`,
    ).not.toContain(KEY);
  });

  it('retries when throttled (429), then continues', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/submissions/draft/package`, () =>
        ++calls === 1
          ? new HttpResponse(null, { status: 429, headers: { 'Retry-After': '1' } })
          : new HttpResponse(null, { status: 202, headers: { Location: 'op-2' } }),
      ),
      http.get(`${BASE}/submissions/draft/package/operations/op-2`, () =>
        HttpResponse.json({ status: 'Succeeded' }),
      ),
    );
    const { edge, lines } = client();
    await edge.uploadPackage(new Uint8Array([1]));
    expect(calls).toBe(2);
    expect(lines.some((l) => l.includes('429'))).toBe(true);
  });

  it('refuses to start without credentials', () => {
    expect(() => createEdgeClient({ clientId: '', apiKey: KEY, productId: PRODUCT })).toThrow(
      /clientId/,
    );
  });
});
