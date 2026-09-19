import { IncomingMessage, ServerResponse } from 'node:http';
import { TenantContext } from '@kazibet/tenant';
import { UserId, TenantId } from '@kazibet/shared';

export interface AuthenticatedUser {
  userId: UserId;
  tenantId: TenantId;
  roles: string[];
  permissions: string[];
}

export interface ApiRequest extends IncomingMessage {
  requestId: string;
  tenant?: TenantContext;
  user?: AuthenticatedUser;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  params?: Record<string, string>;
}

export type ApiResponse = ServerResponse;
