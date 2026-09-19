import { LedgerAccountType } from '@kazibet/shared';

export interface StandardAccountDef {
  code: string;
  type: LedgerAccountType;
  description: string;
}

export const STANDARD_ACCOUNTS = {
  PAYMENT_CLEARING: (provider: string): StandardAccountDef => ({
    code: `ASSET:CLEARING:${provider.toUpperCase()}`,
    type: 'ASSET',
    description: `Clearing account for ${provider}`
  }),
  USER_AVAILABLE: (userId: string): StandardAccountDef => ({
    code: `LIABILITY:USER_AVAILABLE:${userId}`,
    type: 'LIABILITY',
    description: `Available wagering balance for user ${userId}`
  }),
  USER_HOLD: (userId: string): StandardAccountDef => ({
    code: `LIABILITY:USER_HOLD:${userId}`,
    type: 'LIABILITY',
    description: `Reserved bet stakes for user ${userId}`
  }),
  USER_BONUS: (userId: string): StandardAccountDef => ({
    code: `LIABILITY:USER_BONUS:${userId}`,
    type: 'LIABILITY',
    description: `Bonus balance for user ${userId}`
  }),
  GGR_REVENUE: {
    code: 'REVENUE:GGR:SPORTS_BETTING',
    type: 'REVENUE' as LedgerAccountType,
    description: 'Gross Gaming Revenue from lost wagers'
  },
  GAMING_PAYOUT: {
    code: 'EXPENSE:GAMING_PAYOUT',
    type: 'EXPENSE' as LedgerAccountType,
    description: 'Gaming payout expenses for winning wagers'
  },
  TAX_WITHHOLDING: (beneficiary: string): StandardAccountDef => ({
    code: `LIABILITY:TAX_WITHHOLDING:${beneficiary.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
    type: 'LIABILITY',
    description: `Withholding tax payable to ${beneficiary}`
  })
};
