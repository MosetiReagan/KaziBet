import { Router } from '../router.js';
import { TenantService } from '@kazibet/tenant';
import { KaziBetError } from '@kazibet/shared';

export function registerTenantRoutes(router: Router, tenantService: TenantService): void {
  router.get('/api/v1/tenant/current', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context could not be resolved.', 404);
    }

    const tenant = await tenantService.resolveByCode(req.tenant.code);
    if (!tenant) {
      throw new KaziBetError('NOT_FOUND', 'Tenant not found.', 404);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tenant }));
  });
}
