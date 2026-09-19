import { createServer, Server } from 'node:http';
import { URL } from 'node:url';
import { RealtimeHub } from './realtime-hub.js';

export function createRealtimeServer(hub: RealtimeHub): Server {
  return createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'realtime' }));
      return;
    }

    if (parsedUrl.pathname === '/events') {
      // Server-Sent Events (SSE) Endpoint
      const tenantId = (req.headers['x-tenant-id'] as string) || parsedUrl.searchParams.get('tenantId') || 'kazi-sports';
      const channel = parsedUrl.searchParams.get('channel') || 'global';

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      res.write(`data: ${JSON.stringify({ type: 'CONNECTED', channel })}\n\n`);

      const unsubscribe = hub.subscribe(tenantId, channel, (msg) => {
        res.write(`event: ${msg.event}\ndata: ${JSON.stringify(msg.data)}\n\n`);
      });

      req.on('close', () => {
        unsubscribe();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });
}
