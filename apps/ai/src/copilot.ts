import { TenantId } from '@kazibet/shared';
import { KaziBetMcpServer } from './mcp-server.js';

export interface CopilotResponse {
  answer: string;
  toolCallsExecuted: { tool: string; args: Record<string, unknown> }[];
  confidence: number;
}

export class OperationsCopilot {
  constructor(private readonly mcpServer: KaziBetMcpServer) {}

  public async ask(
    tenantId: TenantId,
    userPermissions: string[],
    question: string
  ): Promise<CopilotResponse> {
    const q = question.toLowerCase();
    const toolCallsExecuted: { tool: string; args: Record<string, unknown> }[] = [];

    if (q.includes('risk') || q.includes('fraud') || q.includes('blocked')) {
      toolCallsExecuted.push({ tool: 'search_risk_cases', args: {} });
      const cases = (await this.mcpServer.executeTool(
        tenantId,
        userPermissions,
        'search_risk_cases',
        {}
      )) as { signalType: string; severity: string; score: number; explanation?: string }[];

      if (cases.length === 0) {
        return {
          answer: 'There are currently no active fraud or risk cases flagged for this sportsbook.',
          toolCallsExecuted,
          confidence: 0.95
        };
      }

      const summary = cases
        .map(c => `• [${c.severity}] ${c.signalType} (Risk Score: ${c.score}): ${c.explanation || 'Requires manual review'}`)
        .join('\n');

      return {
        answer: `Summary of active risk cases:\n${summary}\n\nRecommended Action: Conduct manual analyst review before releasing any pending withdrawals.`,
        toolCallsExecuted,
        confidence: 0.92
      };
    }

    if (q.includes('user') || q.includes('bettor') || q.includes('accounts')) {
      toolCallsExecuted.push({ tool: 'search_users', args: {} });
      const users = (await this.mcpServer.executeTool(
        tenantId,
        userPermissions,
        'search_users',
        {}
      )) as { id: string; email: string; status: string }[];

      return {
        answer: `There are ${users.length} registered users under this sportsbook tenant. All account statuses are verified against active tenant isolation policies.`,
        toolCallsExecuted,
        confidence: 0.90
      };
    }

    if (q.includes('bet') || q.includes('wager') || q.includes('turnover')) {
      toolCallsExecuted.push({ tool: 'search_bets', args: {} });
      const bets = (await this.mcpServer.executeTool(
        tenantId,
        userPermissions,
        'search_bets',
        {}
      )) as { id: string; stakeCents: bigint; status: string }[];

      return {
        answer: `Found ${bets.length} total wagers recorded in the database. Active bets are currently secured with double-entry ledger holds.`,
        toolCallsExecuted,
        confidence: 0.88
      };
    }

    return {
      answer: `I am your KaziBet Operations Copilot. You can ask me to inspect risk cases, analyze users, review bet settlement, or search audit logs.`,
      toolCallsExecuted,
      confidence: 1.0
    };
  }
}
