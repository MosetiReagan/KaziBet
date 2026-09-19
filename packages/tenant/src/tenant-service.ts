import {
  generateId,
  TenantId,
  CapabilityStatus,
  Currency,
  KaziBetError
} from '@kazibet/shared';
import { CapabilityValidator, TenantConfig } from '@kazibet/config';
import { DatabaseTransactionContext, TenantEntity } from '@kazibet/database';

export class TenantService {
  constructor(private readonly getContext: () => DatabaseTransactionContext) {}

  public async provisionTenant(params: {
    code: string;
    name: string;
    domain: string;
    defaultCurrency?: Currency;
    config?: Partial<TenantConfig>;
  }): Promise<TenantEntity> {
    const ctx = this.getContext();

    // Check unique code & domain
    const existingCode = await ctx.tenants.findMany({ code: params.code });
    if (existingCode.length > 0) {
      throw new KaziBetError('VALIDATION_FAILED', `Tenant with code '${params.code}' already exists.`);
    }

    const existingDomain = await ctx.tenants.findMany({ domain: params.domain });
    if (existingDomain.length > 0) {
      throw new KaziBetError('VALIDATION_FAILED', `Tenant with domain '${params.domain}' already exists.`);
    }

    const id = generateId();
    const currency = params.defaultCurrency || 'KES';

    const tenant: TenantEntity = {
      id,
      code: params.code,
      name: params.name,
      domain: params.domain,
      defaultCurrency: currency,
      capabilityStatus: 'SANDBOX',
      config: (params.config as Record<string, unknown>) || {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return await ctx.tenants.create(tenant);
  }

  public async resolveByDomain(domain: string): Promise<TenantEntity | null> {
    const ctx = this.getContext();
    const cleanDomain = domain.toLowerCase().split(':')[0] || '';
    const tenants = await ctx.tenants.findMany({ domain: cleanDomain });
    return tenants[0] ?? null;
  }

  public async resolveByCode(code: string): Promise<TenantEntity | null> {
    const ctx = this.getContext();
    const tenants = await ctx.tenants.findMany({ code: code.toLowerCase() });
    return tenants[0] ?? null;
  }

  public async transitionCapability(
    tenantId: TenantId,
    targetStatus: CapabilityStatus,
    reason: string
  ): Promise<TenantEntity> {
    const ctx = this.getContext();
    const tenant = await ctx.tenants.findById(tenantId);
    if (!tenant) {
      throw new KaziBetError('NOT_FOUND', `Tenant ${tenantId} not found.`);
    }

    // If activating production, execute strict compliance validation
    if (targetStatus === 'PRODUCTION_ACTIVE' || targetStatus === 'PRODUCTION_APPROVED') {
      const fullConfig = {
        tenantId: tenant.id,
        code: tenant.code,
        domain: tenant.domain,
        capabilityStatus: targetStatus,
        ...tenant.config
      } as TenantConfig;

      const validation = CapabilityValidator.validateForProduction(fullConfig);
      if (!validation.valid) {
        throw new KaziBetError(
          'CAPABILITY_RESTRICTION',
          `Cannot transition tenant ${tenant.code} to ${targetStatus}: compliance check failed.`,
          400,
          { issues: validation.issues, reason }
        );
      }
    }

    const updated = await ctx.tenants.update(tenantId, {
      capabilityStatus: targetStatus,
      updatedAt: new Date()
    });

    return updated;
  }
}
