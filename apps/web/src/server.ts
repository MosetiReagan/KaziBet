import { createServer, Server } from 'node:http';
import { renderSportsbookApp } from './page-template.js';

export function createWebServer(brandName = 'KaziBet Sportsbook'): Server {
  return createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'web' }));
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
