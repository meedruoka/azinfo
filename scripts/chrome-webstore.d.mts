// Types for scripts/chrome-webstore.mjs (plain JavaScript so it runs with node, no build step).

export declare const CWS_API: string;
export declare const TOKEN_URL: string;
export declare const CWS_SCOPE: string;

export declare class ChromeApiError extends Error {
  constructor(message: string, details?: Record<string, unknown>);
  details: Record<string, unknown>;
}

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export declare function serviceAccountAssertion(
  key: ServiceAccountKey,
  nowSeconds?: number,
): string;

export interface ChromeClientOptions {
  serviceAccountKey: ServiceAccountKey;
  publisherId: string | undefined;
  itemId: string | undefined;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export declare function createChromeClient(options: ChromeClientOptions): {
  uploadPackage(zip: Uint8Array | Buffer): Promise<Record<string, unknown>>;
  publish(): Promise<Record<string, unknown>>;
};
