import type { Subscription } from './azure/subscriptions';

/** Requests from popup/content script to the background worker. */
export type Request =
  | { type: 'getAuthState' }
  | { type: 'signIn' }
  | { type: 'signOut' }
  | { type: 'listSubscriptions' };

/** Error kinds the UI can show a specific message for. */
export type ErrorKind = 'notSignedIn' | 'auth' | 'azure' | 'unknown';

export type Result<T> = { ok: true; data: T } | { ok: false; kind: ErrorKind; message: string };

export interface ResponseMap {
  getAuthState: { signedIn: boolean };
  signIn: { signedIn: boolean };
  signOut: { signedIn: boolean };
  listSubscriptions: Subscription[];
}

export async function sendRequest<R extends Request>(
  request: R,
): Promise<Result<ResponseMap[R['type']]>> {
  return browser.runtime.sendMessage(request);
}
