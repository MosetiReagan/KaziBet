import { InMemoryDatabase } from '@kazibet/database';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { TenantContextHolder } from '@kazibet/tenant';
import { MatchSimulator } from './match-simulator.js';

export async function runSimulator(): Promise<void> {
  const db = new InMemoryDatabase();
  const sports = new SportsService(() => db.getContext());
  const odds = new OddsEngine(() => db.getContext());
  const sim = new MatchSimulator(db, sports, odds);

  const tenantId = '00000000-0000-0000-0000-000000000001';

  await TenantContextHolder.run(
    {
      tenantId,
      code: 'kazi-sports',
      domain: 'localhost',
      currency: 'KES',
      capabilityStatus: 'SANDBOX'
    },
    async () => {
      console.log('[Simulator] Seeding sports fixtures and odds...');
      const matches = await sim.seedDefaultFixtures(tenantId);
      console.log(`[Simulator] Seeded ${matches.length} active match fixtures with full market books.`);
    }
  );
}

if (process.argv[1]?.endsWith('standalone.js') || process.argv[1]?.endsWith('standalone.ts')) {
  void runSimulator();
}
