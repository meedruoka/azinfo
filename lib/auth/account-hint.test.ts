import { describe, expect, it } from 'vitest';
import { accountHintFromIdToken } from './account-hint';

/** An unsigned JWT with the given claims (the signature isn't checked). */
function idToken(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.sig`;
}

describe('accountHintFromIdToken', () => {
  it("prefers Microsoft's opaque login_hint claim", () => {
    expect(
      accountHintFromIdToken(
        idToken({ login_hint: 'O.opaque-hint', preferred_username: 'someone@example.com' }),
      ),
    ).toBe('O.opaque-hint');
  });

  it('falls back to the sign-in name', () => {
    expect(accountHintFromIdToken(idToken({ preferred_username: 'someone@example.com' }))).toBe(
      'someone@example.com',
    );
    expect(accountHintFromIdToken(idToken({ upn: 'u@example.onmicrosoft.com' }))).toBe(
      'u@example.onmicrosoft.com',
    );
  });

  it('decodes non-ASCII claims', () => {
    expect(accountHintFromIdToken(idToken({ preferred_username: 'józef@example.com' }))).toBe(
      'józef@example.com',
    );
  });

  it('returns nothing for a missing, malformed or hint-less token', () => {
    expect(accountHintFromIdToken(undefined)).toBeUndefined();
    expect(accountHintFromIdToken('not-a-jwt')).toBeUndefined();
    expect(accountHintFromIdToken('a.%%%.c')).toBeUndefined();
    expect(accountHintFromIdToken(idToken({ name: 'Someone' }))).toBeUndefined();
    expect(accountHintFromIdToken(idToken({ login_hint: '   ' }))).toBeUndefined();
  });
});
