import { TenantId, KaziBetError } from '@kazibet/shared';
import { DatabaseTransactionContext, InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';

export interface McpToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiredPermission: string;
}

export class KaziBetMcpServer {
  constructor(private readonly db: InMemoryDatabase) {}

  public getTools(): McpToolDefinition[] {
    return [
      {
        name: 'search_users',
        description: 'Search sportsbook users by email, phone, or status.',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
        requiredPermission: 'users:read'
      },
      {
        name: 'get_user',
        description: 'Get full user account profile including KYC tier and status.',
        parameters: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
        requiredPermission: 'users:read'
      },
      {
        name: 'search_bets',
        description: 'List recent wagers filtered by status.',
        parameters: { type: 'object', properties: { status: { type: 'string' } } },
        requiredPermission: 'bets:read'
      },
      {
        name: 'get_wallet',
        description: 'Get user wallet balances (available, held, bonus).',
        parameters: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
        requiredPermission: 'wallets:read'
      },
      {
        name: 'search_risk_cases',
        description: 'Find flagged fraud and risk cases requiring review.',
        parameters: { type: 'object', properties: { status: { type: 'string' } } },
        requiredPermission: 'risk:read'
      },
      {
        name: 'get_audit_log',
        description: 'Inspect immutable system and operator audit logs.',
        parameters: { type: 'object', properties: { resourceType: { type: 'string' } } },
        requiredPermission: 'audit:read'
      }
    ];
  }

  public async executeTool(
    tenantId: TenantId,
    userPermissions: string[],
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    TenantContextHolder.assertTenant(tenantId);
    const tool = this.getTools().find(t => t.name === toolName);
    if (!tool) {
      throw new KaziBetError('NOT_FOUND', `MCP tool '${toolName}' not found.`);
    }

    // RBAC check
    if (!userPermissions.includes(tool.requiredPermission) && !userPermissions.includes('*')) {
      throw new KaziBetError('FORBIDDEN', `Missing permission '${tool.requiredPermission}' to execute AI tool '${toolName}'.`, 403);
    }

    const ctx = this.db.getContext();

    switch (toolName) {
      case 'search_users': {
        const users = await ctx.users.findMany(tenantId);
        return users.map(u => ({ id: u.id, email: u.email, status: u.status, kycTier: u.kycTier }));
      }
      case 'get_user': {
        const userId = args['userId'] as string;
        const user = await ctx.users.findById(tenantId, userId);
        return user;
      }
      case 'search_bets': {
        const status = args['status'] as string | undefined;
        const bets = await ctx.bets.findMany(tenantId, status ? { status: status as 'PLACED' } : undefined);
        return bets;
      }
      case 'get_wallet': {
        const userId = args['userId'] as string;
        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        return wallet ? {
          availableCents: wallet.availableCents.toString(),
          heldCents: wallet.heldCents.toString(),
          bonusCents: wallet.bonusCents.toString(),
          currency: wallet.currency
        } : null;
      }
      case 'search_risk_cases': {
        const cases = await ctx.riskCases.findMany(tenantId);
        return cases;
      }
      case 'get_audit_log': {
        const logs = await ctx.auditLogs.findMany(tenantId);
        return logs;
      }
      default:
        throw new KaziBetError('NOT_FOUND', `Tool ${toolName} execution not implemented.`);
    }
  }
}
