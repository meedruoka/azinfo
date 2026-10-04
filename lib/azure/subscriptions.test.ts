import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/tests/msw-server';
import { ArmError } from './arm-client';
import { listSubscriptions } from './subscriptions';

const LIST_URL = 'https://management.azure.com/subscriptions';

const sub = (n: number) => ({
  id: `/subscriptions/0000000${n}-0000-0000-0000-000000000000`,
  subscriptionId: `0000000${n}-0000-0000-0000-000000000000`,
  displayName: `Sub ${n}`,
  state: 'Enabled',
  tenantId: 'tenant',
  authorizationSource: 'RoleBased',
});

describe('listSubscriptions', () => {
  it('sends the bearer token and pinned api-version', async () => {
    let auth: string | null = null;
    let version: string | null = null;
    server.use(
      http.get(LIST_URL, ({ request }) => {
        auth = request.headers.get('authorization');
        version = new URL(request.url).searchParams.get('api-version');
        return HttpResponse.json({ value: [sub(1)] });
      }),
    );
    const subs = await listSubscriptions('AT');
    expect(auth).toBe('Bearer AT');
    expect(version).toBe('2022-12-01');
    expect(subs).toEqual([
      {
        subscriptionId: sub(1).subscriptionId,
        displayName: 'Sub 1',
        state: 'Enabled',
        tenantId: 'tenant',
      },
    ]);
  });

  it('follows nextLink across pages', async () => {
    server.use(
      http.get(LIST_URL, ({ request }) => {
        const page = new URL(request.url).searchParams.get('page');
        return page === '2'
          ? HttpResponse.json({ value: [sub(3)], nextLink: null })
          : HttpResponse.json({
              value: [sub(1), sub(2)],
              nextLink: `${LIST_URL}?api-version=2022-12-01&page=2`,
            });
      }),
    );
    const subs = await listSubscriptions('AT');
    expect(subs.map((s) => s.displayName)).toEqual(['Sub 1', 'Sub 2', 'Sub 3']);
  });

  it('refuses a nextLink pointing outside ARM', async () => {
    server.use(
      http.get(LIST_URL, () =>
        HttpResponse.json({ value: [sub(1)], nextLink: 'https://evil.example/steal' }),
      ),
    );
    await expect(listSubscriptions('AT')).rejects.toThrow('Refusing non-ARM URL');
  });

  it('turns ARM error bodies into ArmError', async () => {
    server.use(
      http.get(LIST_URL, () =>
        HttpResponse.json(
          {
            error: { code: 'InvalidAuthenticationToken', message: 'The access token is invalid.' },
          },
          { status: 401 },
        ),
      ),
    );
    const err = await listSubscriptions('AT').catch((e) => e);
    expect(err).toBeInstanceOf(ArmError);
    expect(err).toMatchObject({ status: 401, code: 'InvalidAuthenticationToken' });
  });

  it('rejects a response that does not match the schema', async () => {
    server.use(http.get(LIST_URL, () => HttpResponse.json({ value: [{ displayName: 1 }] })));
    await expect(listSubscriptions('AT')).rejects.toThrow();
  });
});
