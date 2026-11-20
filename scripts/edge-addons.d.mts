// Types for scripts/edge-addons.mjs (plain JavaScript so it runs with node, no build step).

export declare const EDGE_API: string;

export declare class EdgeApiError extends Error {
  constructor(message: string, details?: Record<string, unknown>);
  details: Record<string, unknown>;
}

export declare function operationIdFrom(location: string | null | undefined): string;

export interface EdgeOperation {
  id?: string;
  status: 'InProgress' | 'Succeeded' | 'Failed';
  message?: string | null;
  errorCode?: string | null;
  errors?: unknown[] | null;
}

export interface EdgeClientOptions {
  clientId: string | undefined;
  apiKey: string | undefined;
  productId: string | undefined;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export declare function createEdgeClient(options: EdgeClientOptions): {
  uploadPackage(zip: Uint8Array | Buffer): Promise<EdgeOperation>;
  publish(notes: string): Promise<EdgeOperation>;
};
