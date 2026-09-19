import { InMemoryDatabase, PrismaDatabase, PrismaClient, IDatabase } from '@kazibet/database';
import { TenantService } from '@kazibet/tenant';
import { AuthService } from '@kazibet/identity';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from '@kazibet/betting-engine';
import { loadEnv } from '@kazibet/config';
import { createApp } from './app.js';

export async function startServer(port?: number): Promise<{ close: () => Promise<void>; port: number }> {
  const env = loadEnv();
  const usePrisma = process.env['USE_PRISMA'] === 'true';
  const prismaClient = usePrisma ? new PrismaClient() : null;
  const db: IDatabase = prismaClient ? new PrismaDatabase(prismaClient) : new InMemoryDatabase();
  const ctxProvider = () => db.getContext();
  const tenantService = new TenantService(ctxProvider);
  const authService = new AuthService(ctxProvider, env.JWT_SECRET);
  const sportsService = new SportsService(ctxProvider);
  const oddsEngine = new OddsEngine(ctxProvider);
  const bettingService = new BetPlacementService(db, oddsEngine);

  // Seed reference Kenya tenant for sandbox
  await tenantService.provisionTenant({
    code: env.DEFAULT_TENANT_CODE,
    name: 'KaziBet Reference Sportsbook',
    domain: 'localhost',
    defaultCurrency: 'KES'
  });

  const { server } = createApp({ tenantService, authService, sportsService, oddsEngine, bettingService });
  const listenPort = port || env.API_PORT;

  return new Promise((resolve) => {
    server.listen(listenPort, () => {
      console.log(`[KaziBet API] Server running on port ${listenPort} (Env: ${env.KAZIBET_ENVIRONMENT})`);
      resolve({
        port: listenPort,
        close: () => new Promise<void>((r) => server.close(() => r()))
      });
    });
  });
}

if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  void startServer();
}
