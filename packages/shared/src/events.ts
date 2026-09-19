import { UUID, TenantId } from './types.js';
import { generateId } from './id.js';

export interface DomainEvent<T = Record<string, unknown>> {
  id: UUID;
  tenantId: TenantId;
  name: string;
  aggregateType: string;
  aggregateId: string;
  payload: T;
  occurredAt: string; // ISO-8601
  correlationId?: string;
  version: number;
}

export function createDomainEvent<T = Record<string, unknown>>(params: {
  tenantId: TenantId;
  name: string;
  aggregateType: string;
  aggregateId: string;
  payload: T;
  correlationId?: string;
  version?: number;
}): DomainEvent<T> {
  return {
    id: generateId(),
    tenantId: params.tenantId,
    name: params.name,
    aggregateType: params.aggregateType,
    aggregateId: params.aggregateId,
    payload: params.payload,
    occurredAt: new Date().toISOString(),
    correlationId: params.correlationId,
    version: params.version ?? 1
  };
}
