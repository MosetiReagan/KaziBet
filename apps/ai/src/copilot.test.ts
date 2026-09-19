import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { KaziBetMcpServer } from './mcp-server.js';
import { OperationsCopilot } from './copilot.js';
import { KaziBetError } from '@kazibet/shared';

describe('KaziBet AI & MCP Operations Copilot', () => {
  const tenantId = 'tenant-ai-test';

  async function setup() {
    const db = new InMemoryDatabase();
    const ctx = db.getContext();
    const mcp = new KaziBetMcpServer(db);
    const copilot = new OperationsCopilot(mcp);

    await ctx.tenants.create({
      id: tenantId,
      code: 'ai-test',
      name: 'AI Test Book',
      domain: 'ai.local',
      defaultCurrency: 'KES',
      capabilityStatus: 'SANDBOX',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return { db, ctx, mcp, copilot };
  }

  test('executes MCP tool search_users with valid permissions and enforces RBAC', async () => {
    const { ctx, mcp } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'ai-test',
        domain: 'ai.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        await ctx.users.create(tenantId, {
          id: 'u-ai-1',
          tenantId,
          email: 'aiuser@test.com',
          passwordHash: 'hash',
          status: 'ACTIVE',
          kycTier: 1,
          mfaEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // 1. Authorized call
        const users = (await mcp.executeTool(
          tenantId,
          ['users:read'],
          'search_users',
          {}
        )) as { email: string }[];

        assert.equal(users.length, 1);
        assert.equal(users[0]?.email, 'aiuser@test.com');

        // 2. Unauthorized call (missing users:read) -> throws 403
        await assert.rejects(
          async () => await mcp.executeTool(tenantId, ['bets:read'], 'search_users', {}),
          KaziBetError
        );
      }
    );
  });

  test('OperationsCopilot answers question about risk cases', async () => {
    const { ctx, copilot } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'ai-test',
        domain: 'ai.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // Seed risk case
        await ctx.riskCases.create(tenantId, {
          id: 'case-1',
          tenantId,
          userId: 'u-bad-1',
          signalType: 'RAPID_BET_VELOCITY',
          severity: 'HIGH',
          score: 0.88,
          status: 'OPEN',
          explanation: '10 bets in 15 seconds detected',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const res = await copilot.ask(tenantId, ['risk:read'], 'Summarize today risk cases');
        assert.ok(res.answer.includes('RAPID_BET_VELOCITY'));
        assert.ok(res.answer.includes('0.88'));
        assert.equal(res.toolCallsExecuted[0]?.tool, 'search_risk_cases');
      }
    );
  });
});
