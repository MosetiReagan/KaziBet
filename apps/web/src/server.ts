import { createServer, Server, request as httpRequest } from 'node:http';
import { URL } from 'node:url';
import { renderSportsbookApp } from './page-template.js';

export function createWebServer(
  brandName = 'KaziBet Sportsbook',
  options?: { apiUrl?: string; realtimeUrl?: string }
): Server {
  const apiUrl = options?.apiUrl || process.env['API_URL'] || 'http://localhost:4000';
  const realtimeUrl = options?.realtimeUrl || process.env['REALTIME_URL'] || 'http://localhost:4002';

  return createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'web' }));
      return;
    }

    // Proxy /api/* to API Gateway
    if (parsedUrl.pathname.startsWith('/api/')) {
      const target = new URL(parsedUrl.pathname + parsedUrl.search, apiUrl);
      const proxyReq = httpRequest(
        target,
        {
          method: req.method,
          headers: { ...req.headers, host: target.host }
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API Gateway unavailable' }));
      });
      req.pipe(proxyReq);
      return;
    }

    // Proxy /events (SSE) to Realtime Gateway
    if (parsedUrl.pathname === '/events') {
      const target = new URL(parsedUrl.pathname + parsedUrl.search, realtimeUrl);
      const proxyReq = httpRequest(
        target,
        {
          method: 'GET',
          headers: { ...req.headers, host: target.host }
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Realtime Gateway unavailable' }));
      });
      req.pipe(proxyReq);
      return;
    }

    // Deliver Public Sportsbook App
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderSportsbookApp(brandName));
  });
}

if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  const server = createWebServer();
  const port = Number(process.env['WEB_PORT'] || 3000);
  server.listen(port, () => {
    console.log(`[KaziBet Web] Public sportsbook running at http://localhost:${port}`);
  });
}
