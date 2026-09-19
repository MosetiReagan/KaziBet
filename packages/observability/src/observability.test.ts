import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from './logger.js';
import { MetricCollector } from './metrics.js';

describe('Observability Suite', () => {
  test('formats structured log entries with metadata', () => {
    const entry = Logger.info('Bet placed successfully', {
      tenantId: 'tenant-123',
      correlationId: 'corr-999',
      requestId: 'req-456'
    });

    assert.equal(entry.level, 'INFO');
    assert.equal(entry.tenantId, 'tenant-123');
    assert.equal(entry.correlationId, 'corr-999');
    assert.ok(entry.timestamp);
  });

  test('records metrics and computes latency p95 and average', () => {
    const metrics = new MetricCollector();
    metrics.increment('bet_placement_total', 1);
    metrics.increment('bet_placement_total', 1);

    assert.equal(metrics.getCounter('bet_placement_total'), 2);

    // Record latencies in ms
    metrics.recordLatency('bet_placement_latency', 12);
    metrics.recordLatency('bet_placement_latency', 15);
    metrics.recordLatency('bet_placement_latency', 20);
    metrics.recordLatency('bet_placement_latency', 50);

    const stats = metrics.getLatencyStats('bet_placement_latency');
    assert.equal(stats.count, 4);
    assert.ok(stats.avgMs > 0);
    assert.ok(stats.p95Ms >= 20);

    const prom = metrics.exportPrometheusFormat();
    assert.ok(prom.includes('bet_placement_total 2'));
    assert.ok(prom.includes('bet_placement_latency_ms'));
  });
});
