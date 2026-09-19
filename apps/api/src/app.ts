import { createServer, Server } from 'node:http';
import { URL } from 'node:url';
import { generateId, KaziBetError } from '@kazibet/shared';
import { TenantService, TenantContextHolder, TenantContext } from '@kazibet/tenant';
import { AuthService } from '@kazibet/identity';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from '@kazibet/betting-engine';
import { ApiRequest, ApiResponse } from './http-types.js';
import { Router } from './router.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTenantRoutes } from './routes/tenant.js';
import { registerSportsAndBettingRoutes } from './routes/betting.js';

export interface AppDependencies {
  tenantService: TenantService;
  authService: AuthService;
  sportsService?: SportsService;
  oddsEngine?: OddsEngine;
  bettingService?: BetPlacementService;
}

export function createApp(deps: AppDependencies): { server: Server; router: Router } {
  const router = new Router();

  registerHealthRoutes(router);
  registerAuthRoutes(router, deps.authService);
  registerTenantRoutes(router, deps.tenantService);
  if (deps.sportsService && deps.oddsEngine && deps.bettingService) {
    registerSportsAndBettingRoutes(router, deps.sportsService, deps.oddsEngine, deps.bettingService);
  }

  const server = createServer(async (req, res) => {
    const apiReq = req as ApiRequest;
    const apiRes = res as ApiResponse;
    apiReq.requestId = (req.headers['x-request-id'] as string) || generateId();

    // CORS headers
    apiRes.setHeader('Access-Control-Allow-Origin', '*');
    apiRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    apiRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-ID, X-Tenant-Code, Idempotency-Key');

    if (req.method === 'OPTIONS') {
      apiRes.writeHead(204);
      apiRes.end();
      return;
    }

    try {
      // Parse URL & query
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const query: Record<string, string> = {};
      parsedUrl.searchParams.forEach((val, key) => {
        query[key] = val;
      });
      apiReq.query = query;

      // Parse JSON body
      if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
        const buffers: Buffer[] = [];
        for await (const chunk of req) {
          buffers.push(chunk as Buffer);
        }
        const rawBody = Buffer.concat(buffers).toString('utf-8');
        apiReq.body = rawBody ? JSON.parse(rawBody) : {};
      }

      // Resolve Tenant
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

      // Resolve Auth Token if present
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
          const verified = deps.authService.verifyToken(token);
          // Assert token belongs to the resolved tenant
          if (tenantContext && verified.tenantId !== tenantContext.tenantId) {
            throw new KaziBetError('TENANT_MISMATCH', 'Token tenant does not match request tenant.', 403);
          }
          apiReq.user = verified;
        } catch (tokenErr) {
          if (tokenErr instanceof KaziBetError) throw tokenErr;
          throw new KaziBetError('UNAUTHORIZED', 'Invalid or expired authentication token.', 401);
        }
      }

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

  return { server, router };
}
