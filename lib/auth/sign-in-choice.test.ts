import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { authorityItem } from '../settings';
import { defaultAuthority, signInAuthority } from './config';
import { personalTenant, planSignIn, signInAuthorityItem } from './sign-in-choice';

describe('personalTenant', () => {
  it.each([
    ['meedakourgmail.onmicrosoft.com', 'meedakourgmail.onmicrosoft.com'],
    ['  Contoso.OnMicrosoft.com ', 'contoso.onmicrosoft.com'],
    ['eeeeeeee-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000000'],
    ['organizations', null],
    ['common', null],
    ['consumers', null],
    ['not a tenant', null],
    ['', null],
  ])('%j → %j', (input, expected) => {
    expect(personalTenant(input)).toBe(expected);
  });
});

describe('planSignIn', () => {
  const PERSONAL = 'meedakourgmail.onmicrosoft.com';

  it('lets the options-page tenant win over any choice', () => {
    expect(planSignIn('contoso.com', null, PERSONAL)).toEqual({ kind: 'keep' });
    expect(planSignIn('contoso.com', PERSONAL, undefined)).toEqual({ kind: 'keep' });
  });

  it('switches to a personal tenant from the default', () => {
    expect(planSignIn(null, null, PERSONAL)).toEqual({ kind: 'switch', tenant: PERSONAL });
  });

  it('keeps the same personal tenant without signing out', () => {
    expect(planSignIn(null, PERSONAL, PERSONAL.toUpperCase())).toEqual({ kind: 'keep' });
  });

  it('forgets the personal tenant for a work or school sign-in', () => {
    expect(planSignIn(null, PERSONAL, undefined)).toEqual({ kind: 'switch', tenant: null });
  });

  it('keeps the default for a work sign-in when nothing was remembered', () => {
    expect(planSignIn(null, null, undefined)).toEqual({ kind: 'keep' });
  });

  it('refuses organizations, common and nonsense as a personal tenant', () => {
    for (const input of ['organizations', 'common', 'x']) {
      expect(planSignIn(null, null, input)).toEqual({ kind: 'invalid', input });
    }
  });
});

describe('signInAuthority', () => {
  beforeEach(() => fakeBrowser.reset());

  it('uses the build default when nothing is set', async () => {
    // .env.local may set a dev tenant locally; CI has none (organizations).
    expect(await signInAuthority()).toBe(defaultAuthority());
  });

  it('uses the personal tenant over the default', async () => {
    await signInAuthorityItem.setValue('meedakourgmail.onmicrosoft.com');
    expect(await signInAuthority()).toBe('meedakourgmail.onmicrosoft.com');
  });

  it('uses the options-page tenant over everything', async () => {
    await signInAuthorityItem.setValue('meedakourgmail.onmicrosoft.com');
    await authorityItem.setValue('contoso.com');
    expect(await signInAuthority()).toBe('contoso.com');
  });
});
