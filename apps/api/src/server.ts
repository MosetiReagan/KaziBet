import { InMemoryDatabase } from '@kazibet/database';
import { TenantService } from '@kazibet/tenant';
import { AuthService } from '@kazibet/identity';
import { loadEnv } from '@kazibet/config';
import { createApp } from './app.js';

export async function startServer(port?: number): Promise<{ close: () => Promise<void>; port: number }> {
  const env = loadEnv();
  const db = new InMemoryDatabase();
  const ctxProvider = () => db.getContext();
  const tenantService = new TenantService(ctxProvider);
  const authService = new AuthService(ctxProvider, env.JWT_SECRET);

  // Seed reference Kenya tenant for sandbox
  await tenantService.provisionTenant({
    code: env.DEFAULT_TENANT_CODE,
    name: 'KaziBet Reference Sportsbook',
    domain: 'localhost',
    defaultCurrency: 'KES'
  });

  const { server } = createApp({ tenantService, authService });
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
