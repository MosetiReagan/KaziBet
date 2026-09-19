export const PERMISSIONS = {
  // Bets
  BETS_READ: 'bets:read',
  BETS_PLACE: 'bets:place',
  BETS_CANCEL: 'bets:cancel',

  // Markets & Odds
  MARKETS_CREATE: 'markets:create',
  MARKETS_SUSPEND: 'markets:suspend',
  MARKETS_UPDATE: 'markets:update',
  ODDS_MANAGE: 'odds:manage',

  // Settlements
  SETTLEMENTS_RUN: 'settlements:run',
  SETTLEMENTS_CORRECT: 'settlements:correct',

  // Wallets & Payments
  WALLETS_READ: 'wallets:read',
  WALLETS_ADJUST: 'wallets:adjust',
  WITHDRAWALS_APPROVE: 'withdrawals:approve',
  PAYMENTS_REFUND: 'payments:refund',

  // KYC & Users
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  USERS_SUSPEND: 'users:suspend',
  KYC_REVIEW: 'kyc:review',
  KYC_OVERRIDE: 'kyc:override',

  // Risk & Compliance
  RISK_READ: 'risk:read',
  RISK_MANAGE: 'risk:manage',
  COMPLIANCE_AUDIT: 'compliance:audit',

  // System & Config
  TENANT_MANAGE: 'tenant:manage',
  CONFIG_WRITE: 'config:write',
  AUDIT_READ: 'audit:read',
  AI_COPILOT_USE: 'ai:copilot'
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionCode[]> = {
  SUPER_ADMIN: Object.values(PERMISSIONS),
  TENANT_ADMIN: [
    PERMISSIONS.BETS_READ,
    PERMISSIONS.BETS_CANCEL,
    PERMISSIONS.MARKETS_CREATE,
    PERMISSIONS.MARKETS_SUSPEND,
    PERMISSIONS.MARKETS_UPDATE,
    PERMISSIONS.ODDS_MANAGE,
    PERMISSIONS.SETTLEMENTS_RUN,
    PERMISSIONS.SETTLEMENTS_CORRECT,
    PERMISSIONS.WALLETS_READ,
    PERMISSIONS.WITHDRAWALS_APPROVE,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.USERS_SUSPEND,
    PERMISSIONS.KYC_REVIEW,
    PERMISSIONS.RISK_READ,
    PERMISSIONS.RISK_MANAGE,
    PERMISSIONS.COMPLIANCE_AUDIT,
    PERMISSIONS.TENANT_MANAGE,
    PERMISSIONS.CONFIG_WRITE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AI_COPILOT_USE
  ],
  TRADING_MANAGER: [
    PERMISSIONS.BETS_READ,
    PERMISSIONS.BETS_CANCEL,
    PERMISSIONS.MARKETS_CREATE,
    PERMISSIONS.MARKETS_SUSPEND,
    PERMISSIONS.MARKETS_UPDATE,
    PERMISSIONS.ODDS_MANAGE,
    PERMISSIONS.SETTLEMENTS_RUN
  ],
  FINANCE_MANAGER: [
    PERMISSIONS.WALLETS_READ,
    PERMISSIONS.WALLETS_ADJUST,
    PERMISSIONS.WITHDRAWALS_APPROVE,
    PERMISSIONS.PAYMENTS_REFUND,
    PERMISSIONS.AUDIT_READ
  ],
  RISK_MANAGER: [
    PERMISSIONS.BETS_READ,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_SUSPEND,
    PERMISSIONS.RISK_READ,
    PERMISSIONS.RISK_MANAGE,
    PERMISSIONS.AI_COPILOT_USE
  ],
  KYC_ANALYST: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.KYC_REVIEW
  ],
  CUSTOMER_SUPPORT: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.BETS_READ,
    PERMISSIONS.WALLETS_READ
  ],
  AUDITOR: [
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.BETS_READ,
    PERMISSIONS.WALLETS_READ,
    PERMISSIONS.COMPLIANCE_AUDIT
  ],
  PLAYER: [
    PERMISSIONS.BETS_READ,
    PERMISSIONS.BETS_PLACE,
    PERMISSIONS.WALLETS_READ
  ]
};

export class RbacEvaluator {
  public static hasPermission(userPermissions: string[], requiredPermission: PermissionCode): boolean {
    return userPermissions.includes(requiredPermission) || userPermissions.includes('*');
  }

  public static assertPermission(userPermissions: string[], requiredPermission: PermissionCode): void {
    if (!this.hasPermission(userPermissions, requiredPermission)) {
      throw new Error(`Forbidden: missing required permission '${requiredPermission}'`);
    }
  }

  public static getPermissionsForRoles(roles: string[]): string[] {
    const permSet = new Set<string>();
    for (const role of roles) {
      const perms = DEFAULT_ROLE_PERMISSIONS[role] || [];
      for (const p of perms) {
        permSet.add(p);
      }
    }
    return Array.from(permSet);
  }
}
