import { AsyncLocalStorage } from 'node:async_hooks';
import { TenantId, CapabilityStatus, Currency, TenantIsolationError } from '@kazibet/shared';

export interface TenantContext {
  tenantId: TenantId;
  code: string;
  domain: string;
  currency: Currency;
  capabilityStatus: CapabilityStatus;
}

const storage = new AsyncLocalStorage<TenantContext>();

export class TenantContextHolder {
  public static run<R>(ctx: TenantContext, fn: () => R): R {
    return storage.run(ctx, fn);
  }

  public static get(): TenantContext | undefined {
    return storage.getStore();
  }

  public static require(): TenantContext {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new TenantIsolationError('Operation rejected: no tenant context is bound to current execution.');
    }
    return ctx;
  }

  public static assertTenant(targetTenantId: TenantId): void {
    const current = TenantContextHolder.require();
    if (current.tenantId !== targetTenantId) {
      throw new TenantIsolationError(
        `Cross-tenant violation: current context (${current.tenantId}) does not match target (${targetTenantId})`
      );
    }
  }
}
