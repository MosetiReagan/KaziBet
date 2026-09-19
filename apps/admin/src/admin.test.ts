import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAdminServer } from './server.js';
import { Server } from 'node:http';

describe('Operator Admin Platform', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createAdminServer('BetHub Operations');
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('serves health check', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string };
    assert.equal(body.status, 'ok');
  });

  test('serves operator admin portal with live trading and AI copilot', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('BetHub Operations'));
    assert.ok(html.includes('Live Match Management'));
    assert.ok(html.includes('AI Operations Copilot'));
    assert.ok(html.includes('Emergency Halt'));
  });
});
