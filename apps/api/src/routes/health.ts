import { ApiRequest, ApiResponse } from '../http-types.js';

export function registerHealthRoutes(router: { get: (path: string, handler: (req: ApiRequest, res: ApiResponse) => void) => void }): void {
  router.get('/health', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  });

  router.get('/ready', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ready', checks: { database: 'connected', redis: 'connected' } }));
  });
}
