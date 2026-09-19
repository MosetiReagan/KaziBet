import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from './server.js';
import { Server } from 'node:http';

describe('Public Sportsbook Web App', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createWebServer('Alpha Bet');
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

  test('serves public sportsbook web interface with branding and bet slip', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Alpha Bet'));
    assert.ok(html.includes('Bet Slip'));
    assert.ok(html.includes('Gor Mahia'));
    assert.ok(html.includes('Responsible Gaming'));
  });
});
