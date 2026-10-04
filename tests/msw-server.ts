import { setupServer } from 'msw/node';

/** Shared mock server. Tests add Azure handlers with `server.use(...)`. */
export const server = setupServer();
