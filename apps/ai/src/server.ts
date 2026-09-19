import { createServer, Server } from 'node:http';
import { InMemoryDatabase } from '@kazibet/database';
import { KaziBetMcpServer } from './mcp-server.js';
import { OperationsCopilot } from './copilot.js';

export function createAiServer(db: InMemoryDatabase): Server {
  const mcp = new KaziBetMcpServer(db);
  const copilot = new OperationsCopilot(mcp);

  return createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'ai' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/v1/ai/query') {
      const buffers: Buffer[] = [];
      for await (const chunk of req) {
        buffers.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(buffers).toString('utf-8')) as {
        tenantId: string;
        permissions: string[];
        question: string;
      };

      const result = await copilot.ask(body.tenantId, body.permissions || ['*'], body.question);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404);
    res.end();
  });
}
