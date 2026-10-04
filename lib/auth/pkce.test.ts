import { describe, expect, it } from 'vitest';
import { base64UrlEncode, createPkcePair, randomUrlSafe, s256Challenge } from './pkce';

describe('pkce', () => {
  it('matches the RFC 7636 Appendix B S256 example', async () => {
    expect(await s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('base64url-encodes without padding or unsafe characters', () => {
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(base64UrlEncode(new Uint8Array([1]))).toBe('AQ');
  });

  it('creates a 43-character verifier within the RFC length bounds', async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(await s256Challenge(verifier));
  });

  it('produces different random values each call', () => {
    expect(randomUrlSafe()).not.toBe(randomUrlSafe());
  });
});
