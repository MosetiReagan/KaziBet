import { InMemoryDatabase, PrismaDatabase, PrismaClient, IDatabase } from '@kazibet/database';
import { TenantService } from '@kazibet/tenant';
import { AuthService } from '@kazibet/identity';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from '@kazibet/betting-engine';
import { LedgerEngine } from '@kazibet/ledger';
import { PaymentService, MpesaPaymentAdapter } from '@kazibet/payments';
import { CashoutEngine } from '@kazibet/settlement';
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
  const ledger = new LedgerEngine(db);

  const mpesaAdapter = new MpesaPaymentAdapter({
    baseUrl: process.env['MPESA_BASE_URL'] || 'https://sandbox.safaricom.co.ke',
    consumerKey: process.env['MPESA_CONSUMER_KEY'] || 'mock_consumer_key',
    consumerSecret: process.env['MPESA_CONSUMER_SECRET'] || 'mock_consumer_secret',
    passKey: process.env['MPESA_PASSKEY'] || 'mock_pass_key',
    shortCode: process.env['MPESA_SHORTCODE'] || '174379',
    callbackBaseUrl: process.env['MPESA_CALLBACK_URL'] || 'http://localhost:4000'
  });
  const paymentProviders = new Map();
  paymentProviders.set(mpesaAdapter.name, mpesaAdapter);
  const paymentService = new PaymentService(db, ledger, paymentProviders);
  const cashoutEngine = new CashoutEngine(db as any, ledger);

  // Seed reference Kenya tenant for sandbox
  await tenantService.provisionTenant({
    code: env.DEFAULT_TENANT_CODE,
    name: 'KaziBet Reference Sportsbook',
    domain: 'localhost',
    defaultCurrency: 'KES'
  });

  const { server } = createApp({
    tenantService,
    authService,
    sportsService,
    oddsEngine,
    bettingService,
    paymentService,
    cashoutEngine,
    db
  });
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
