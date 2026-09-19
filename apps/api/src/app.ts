import { createServer, Server } from 'node:http';
import { URL } from 'node:url';
import { generateId, KaziBetError } from '@kazibet/shared';
import { TenantService, TenantContextHolder, TenantContext } from '@kazibet/tenant';
import { AuthService } from '@kazibet/identity';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from '@kazibet/betting-engine';
import { PaymentService } from '@kazibet/payments';
import { CashoutEngine } from '@kazibet/settlement';
import { IDatabase } from '@kazibet/database';
import { ApiRequest, ApiResponse } from './http-types.js';
import { Router } from './router.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTenantRoutes } from './routes/tenant.js';
import { registerSportsAndBettingRoutes } from './routes/betting.js';
import { registerCashierRoutes } from './routes/cashier.js';
import { SlidingWindowRateLimiter, RateLimitRule } from './rate-limiter.js';

export interface AppDependencies {
  tenantService: TenantService;
  authService: AuthService;
  sportsService?: SportsService;
  oddsEngine?: OddsEngine;
  bettingService?: BetPlacementService;
  paymentService?: PaymentService;
  cashoutEngine?: CashoutEngine;
  db?: IDatabase;
  rateLimiter?: SlidingWindowRateLimiter;
}

export function createApp(deps: AppDependencies): { server: Server; router: Router; rateLimiter: SlidingWindowRateLimiter } {
  const router = new Router();
  const rateLimiter = deps.rateLimiter || new SlidingWindowRateLimiter();

  registerHealthRoutes(router);
  registerAuthRoutes(router, deps.authService);
  registerTenantRoutes(router, deps.tenantService);
  if (deps.sportsService && deps.oddsEngine && deps.bettingService) {
    registerSportsAndBettingRoutes(
      router,
      deps.sportsService,
      deps.oddsEngine,
      deps.bettingService,
      deps.db,
      deps.cashoutEngine
    );
  }
  if (deps.paymentService && deps.db) {
    registerCashierRoutes(router, deps.paymentService, deps.db);
  }

  const server = createServer(async (req, res) => {
    const apiReq = req as ApiRequest;
    const apiRes = res as ApiResponse;
    apiReq.requestId = (req.headers['x-request-id'] as string) || generateId();

    // 1. Mandatory Security Headers (Helmet-equivalent)
    apiRes.setHeader('X-Content-Type-Options', 'nosniff');
    apiRes.setHeader('X-Frame-Options', 'DENY');
    apiRes.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    apiRes.setHeader('X-XSS-Protection', '0');
    apiRes.setHeader('Content-Security-Policy', "default-src 'self'");
    apiRes.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    apiRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    apiRes.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Tenant-ID, X-Tenant-Code, Idempotency-Key'
    );

    try {
      // 2. Parse URL & query
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const query: Record<string, string> = {};
      parsedUrl.searchParams.forEach((val, key) => {
        query[key] = val;
      });
      apiReq.query = query;

      // 3. Resolve Tenant
      const tenantCodeHeader = (req.headers['x-tenant-code'] as string) || (req.headers['x-tenant-id'] as string);
      let tenantEntity = null;
      if (tenantCodeHeader) {
        tenantEntity = await deps.tenantService.resolveByCode(tenantCodeHeader);
      } else {
        tenantEntity = await deps.tenantService.resolveByDomain(req.headers.host || '');
      }

      const tenantContext: TenantContext | undefined = tenantEntity
        ? {
            tenantId: tenantEntity.id,
            code: tenantEntity.code,
            domain: tenantEntity.domain,
            currency: tenantEntity.defaultCurrency,
            capabilityStatus: tenantEntity.capabilityStatus
          }
        : undefined;

      apiReq.tenant = tenantContext;

      // 4. CORS with Tenant Domain Validation
      const origin = req.headers['origin'] as string | undefined;
      if (origin) {
        let isAllowed = true;
        try {
          const originUrl = new URL(origin);
          const isLocal = originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1';

          if (tenantEntity && tenantEntity.capabilityStatus !== 'SANDBOX' && !isLocal) {
            const allowedDomain = tenantEntity.domain.toLowerCase();
            const originHost = originUrl.hostname.toLowerCase();
            if (originHost !== allowedDomain && !originHost.endsWith(`.${allowedDomain}`)) {
              isAllowed = false;
            }
          }
        } catch {
          isAllowed = false;
        }

        if (!isAllowed) {
          apiRes.writeHead(403, { 'Content-Type': 'application/json' });
          apiRes.end(JSON.stringify({
            error: {
              code: 'FORBIDDEN_ORIGIN',
              message: `Origin '${origin}' is not authorized for tenant.`,
              requestId: apiReq.requestId
            }
          }));
          return;
        }

        apiRes.setHeader('Access-Control-Allow-Origin', origin);
        apiRes.setHeader('Vary', 'Origin');
      } else {
        apiRes.setHeader('Access-Control-Allow-Origin', '*');
      }

      if (req.method === 'OPTIONS') {
        apiRes.writeHead(204);
        apiRes.end();
        return;
      }

      // 5. Rate Limiting (Sliding Window per IP / user)
      const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
      const pathname = parsedUrl.pathname;

      let rateLimitRule: RateLimitRule | null = null;
      let rateLimitKey = `${rawIp}:${pathname}`;

      if (pathname.includes('/auth/login')) {
        rateLimitRule = SlidingWindowRateLimiter.RULES.LOGIN!;
      } else if (pathname.includes('/auth/register')) {
        rateLimitRule = SlidingWindowRateLimiter.RULES.REGISTER!;
      } else if (pathname.includes('/bets') && req.method === 'POST') {
        rateLimitRule = SlidingWindowRateLimiter.RULES.BETS!;
        rateLimitKey = `${rawIp}:bets`;
      } else if (pathname.includes('/webhook')) {
        rateLimitRule = SlidingWindowRateLimiter.RULES.WEBHOOKS!;
      }

      if (rateLimitRule) {
        const rlStatus = rateLimiter.check(rateLimitKey, rateLimitRule);
        if (!rlStatus.allowed) {
          apiRes.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(rlStatus.retryAfterSeconds)
          });
          apiRes.end(JSON.stringify({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: `Too many requests. Please retry after ${rlStatus.retryAfterSeconds} seconds.`,
              requestId: apiReq.requestId
            }
          }));
          return;
        }
      }

      // 6. Request Body Size Limits & Streaming (1MB general, 10MB statement uploads)
      if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
        const isStatementUpload = pathname.includes('/statement') || pathname.includes('/upload');
        const maxBodyBytes = isStatementUpload ? 10 * 1024 * 1024 : 1024 * 1024;

        const buffers: Buffer[] = [];
        let totalBytes = 0;

        for await (const chunk of req) {
          const buf = chunk as Buffer;
          totalBytes += buf.length;
          if (totalBytes > maxBodyBytes) {
            throw new KaziBetError('PAYLOAD_TOO_LARGE', `Request entity exceeds maximum allowable size of ${maxBodyBytes} bytes.`, 413);
          }
          buffers.push(buf);
        }

        const rawBody = Buffer.concat(buffers).toString('utf-8');
        apiReq.body = rawBody ? JSON.parse(rawBody) : {};
      }

      // 7. Resolve Auth Token if present
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
          const verified = deps.authService.verifyToken(token);
          if (tenantContext && verified.tenantId !== tenantContext.tenantId) {
            throw new KaziBetError('TENANT_MISMATCH', 'Token tenant does not match request tenant.', 403);
          }
          apiReq.user = verified;
        } catch (tokenErr) {
          if (tokenErr instanceof KaziBetError) throw tokenErr;
          throw new KaziBetError('UNAUTHORIZED', 'Invalid or expired authentication token.', 401);
        }
      }

      // 8. Route dispatch
      const match = router.match(req.method || 'GET', parsedUrl.pathname);
      if (!match) {
        apiRes.writeHead(404, { 'Content-Type': 'application/json' });
        apiRes.end(JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${parsedUrl.pathname} not found.`,
            requestId: apiReq.requestId
          }
        }));
        return;
      }

      apiReq.params = match.params;

      if (tenantContext) {
        await TenantContextHolder.run(tenantContext, async () => {
          await match.handler(apiReq, apiRes);
        });
      } else {
        await match.handler(apiReq, apiRes);
      }
    } catch (err: unknown) {
      if (err instanceof KaziBetError) {
        err.requestId = apiReq.requestId;
        apiRes.writeHead(err.statusCode, { 'Content-Type': 'application/json' });
        apiRes.end(JSON.stringify(err.toJSON()));
      } else {
        const message = err instanceof Error ? err.message : 'Internal Server Error';
        apiRes.writeHead(500, { 'Content-Type': 'application/json' });
        apiRes.end(JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message,
            requestId: apiReq.requestId
          }
        }));
      }
    }
  });

  return { server, router, rateLimiter };
}
