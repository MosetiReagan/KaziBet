import { createServer, Server } from 'node:http';
import { renderAdminDashboard } from './admin-dashboard.js';

export function createAdminServer(operatorName = 'KaziBet Operations Center'): Server {
  return createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'admin' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderAdminDashboard(operatorName));
  });
}

if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  const server = createAdminServer();
  const port = Number(process.env['ADMIN_PORT'] || 3001);
  server.listen(port, () => {
    console.log(`[KaziBet Admin] Operator portal running at http://localhost:${port}`);
  });
}
