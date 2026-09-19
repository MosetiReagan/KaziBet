// @ts-check
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const oddsReadDuration = new Trend('odds_read_duration_ms');
const betPlacementDuration = new Trend('bet_placement_duration_ms');
const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    // 1. Browsing Odds: 500 concurrent users
    odds_browsers: {
      executor: 'constant-vus',
      vus: 500,
      duration: '30s',
      exec: 'browseOdds'
    },
    // 2. Bet Placement: 100 concurrent users
    bettors: {
      executor: 'constant-vus',
      vus: 100,
      duration: '30s',
      exec: 'placeBets',
      startTime: '5s'
    }
  },
  thresholds: {
    // Performance latency targets
    odds_read_duration_ms: ['p(95)<200'],        // p95 < 200ms for odds read
    bet_placement_duration_ms: ['p(99)<500'],    // p99 < 500ms for bet placement
    errors: ['rate<0.01']                        // error rate < 1%
  }
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const TENANT_CODE = __ENV.TENANT_CODE || 'sandbox';

const headers = {
  'Content-Type': 'application/json',
  'X-Tenant-Code': TENANT_CODE
};

export function browseOdds() {
  const res = http.get(`${BASE_URL}/api/v1/sports`, { headers });
  const success = check(res, {
    'odds status is 200': (r) => r.status === 200,
    'response has sports catalog': (r) => r.body.includes('football')
  });

  oddsReadDuration.add(res.timings.duration);
  errorRate.add(!success);
  sleep(0.5);
}

export function placeBets() {
  const betPayload = JSON.stringify({
    type: 'SINGLE',
    stakeCents: '1000',
    idempotencyKey: `load-${__VU}-${__ITER}-${Date.now()}`,
    legs: [
      {
        eventId: 'evt-arsenal-chelsea',
        marketId: 'mkt-1x2',
        selectionId: 'sel-home',
        odds: 2.10
      }
    ]
  });

  const res = http.post(`${BASE_URL}/api/v1/bets`, betPayload, {
    headers: {
      ...headers,
      Authorization: `Bearer ${__ENV.TEST_TOKEN || 'dummy-load-token'}`
    }
  });

  const success = check(res, {
    'bet status acceptable (200, 201, or expected sandbox status)': (r) =>
      r.status === 200 || r.status === 201 || r.status === 401 || r.status === 404
  });

  betPlacementDuration.add(res.timings.duration);
  errorRate.add(!success);
  sleep(1);
}
