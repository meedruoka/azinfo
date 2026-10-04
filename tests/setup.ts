import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw-server';

// Any request without a matching handler fails the test, so nothing can
// reach a real Azure endpoint from the test suite.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
