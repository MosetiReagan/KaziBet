import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeHub, RealtimeMessage } from './realtime-hub.js';

describe('RealtimeHub Pub/Sub', () => {
  test('dispatches messages strictly to matching tenant and channel subscribers', () => {
    const hub = new RealtimeHub();
    const receivedA: RealtimeMessage[] = [];
    const receivedB: RealtimeMessage[] = [];

    // Tenant A subscribes to odds:evt-1
    const unsubA = hub.subscribe('tenant-A', 'odds:evt-1', (msg) => receivedA.push(msg));
    // Tenant B subscribes to odds:evt-1
    hub.subscribe('tenant-B', 'odds:evt-1', (msg) => receivedB.push(msg));

    assert.equal(hub.getSubscriberCount('tenant-A', 'odds:evt-1'), 1);
    assert.equal(hub.getSubscriberCount('tenant-B', 'odds:evt-1'), 1);

    // Broadcast message on Tenant A
    hub.broadcast({
      tenantId: 'tenant-A',
      channel: 'odds:evt-1',
      event: 'OddsUpdated',
      data: { homeOdds: 2.15 },
      timestamp: new Date().toISOString()
    });

    assert.equal(receivedA.length, 1);
    assert.equal(receivedA[0]?.data['homeOdds'], 2.15);
    // Tenant B received nothing!
    assert.equal(receivedB.length, 0);

    // Unsubscribe
    unsubA();
    assert.equal(hub.getSubscriberCount('tenant-A', 'odds:evt-1'), 0);
  });
});
