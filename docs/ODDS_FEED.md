# Real Sports Odds & Results Feed Provider

KaziBet supports production sports odds, live score ingestion, deterministic replay testing, and fallback simulator feeds via the unified `FeedProvider` interface in `@kazibet/sports`.

---

## 1. Supported Providers

| Provider | Implementation | Modes Supported | Primary Use Case |
|---|---|---|---|
| **The Odds API** | `TheOddsApiFeedProvider` | Live, Replay | Production real-world bookmaker odds (Pinnacle, Bet365, SportPesa), live scores |
| **Match Simulator** | `SimulatorFeedProvider` | Standalone, Fallback | Offline development, load testing, synthetic chaos testing |

---

## 2. Obtaining a Free "The Odds API" Key

[The Odds API](https://the-odds-api.com/) offers a generous **Free Tier** with 500 requests/month without requiring a credit card:

1. Visit [https://the-odds-api.com/#get-access](https://the-odds-api.com/#get-access).
2. Enter your email address to register.
3. Check your inbox for the API key.
4. Set the environment variable in your `.env` or deployment secrets:
   ```bash
   THE_ODDS_API_KEY=your_api_key_here
   FEED_MODE=live
   ```

---

## 3. Operating Modes

### A. Replay Mode (`FEED_MODE=replay`)
- Used by default in CI, automated tests, and offline development.
- Loads recorded fixtures, odds, and scores deterministically from `test/fixtures/feed/`:
  - `the-odds-api-fixtures.json`
  - `the-odds-api-odds.json`
  - `the-odds-api-scores.json`
- Zero external HTTP requests, eliminating test flakiness and API quota consumption.

### B. Live Mode (`FEED_MODE=live`)
- Active when `THE_ODDS_API_KEY` is provided or `FEED_MODE=live` is configured.
- Polls The Odds API v4 REST endpoints:
  - `GET /v4/sports/{sport}/odds/?regions=eu,uk&markets=h2h,totals&oddsFormat=decimal`
  - `GET /v4/sports/{sport}/scores/?daysFrom=1`
- Automatically tracks latency, error rates, and updates provider health status (`HEALTHY`, `DEGRADED`, `UNHEALTHY`).

### C. Simulator Fallback Mode (`FEED_MODE=simulator`)
- When external APIs are unavailable or degraded, `SimulatorFeedProvider` serves as an active fallback.
- Emulates realistic match progression, score changes, and continuous odds adjustments.

---

## 4. Market Suspension on Stale Feed

To protect the sportsbook operator from taking bets on outdated lines when external feeds experience network partitions or outages, the platform runs an automated stale feed detector (`StaleFeedDetector`):

- **In-Play (Live) Events**:
  - Maximum stale threshold: **60 seconds** (`inPlayThresholdMs: 60000`).
  - If no odds or score update arrives within 60s for an active in-play event, all active markets on that event are immediately **SUSPENDED** with `suspensionReason: 'FEED_UNAVAILABLE'`.
- **Pre-Match (Scheduled) Events**:
  - Maximum stale threshold: **15 minutes** (`preMatchThresholdMs: 900000`).
  - If no updates arrive within 15 minutes, markets are marked **SUSPENDED**.
- **Automatic Recovery**:
  - As soon as fresh odds arrive for a suspended market, `FeedIngestionService` restores the market status back to **ACTIVE**.

---

## 5. Real-Time Price Broadcasts

`FeedIngestionService` integrates directly with the Realtime Hub (`apps/realtime`):

- Whenever odds change or a market is created/updated, a message is broadcast to channel:
  ```
  odds:{eventId}
  ```
  Event payload:
  ```json
  {
    "event": "ODDS_UPDATED",
    "tenantId": "tenant-xyz",
    "channel": "odds:ev-12345",
    "data": {
      "eventId": "ev-12345",
      "marketId": "m-67890",
      "marketType": "1X2",
      "status": "ACTIVE",
      "selections": [
        { "id": "sel-1", "name": "Arsenal", "odds": 2.15, "version": 2 },
        { "id": "sel-2", "name": "Draw", "odds": 3.45, "version": 2 },
        { "id": "sel-3", "name": "Chelsea", "odds": 3.55, "version": 2 }
      ]
    }
  }
  ```
- Whenever a market is suspended due to stale data:
  - Event: `MARKET_SUSPENDED` with `reason: 'FEED_UNAVAILABLE'`.
